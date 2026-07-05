const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastOrderUpdate, broadcastToStation } = require('../websocket/hub');
const stripeService = require('../services/stripe');
const { getStationsForOrder, STATION_ROUTES } = require('../services/stations');
const { printOrderTicket } = require('../services/printer');
const https = require('https');
const http = require('http');

async function sendWhatsApp(phone, message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ number: `55${phone}`, text: message });
    const req = http.request({
      hostname: 'localhost',
      port: 8081,
      path: '/message/sendText/confraria',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': 'confraria2024', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', (e) => { console.error('[whatsapp]', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Valida e resolve os adicionais escolhidos para um item, recalculando o preço no servidor
// (nunca confia no preço enviado pelo cliente). Retorna [{ addon_option_id, name, price, quantity }]
async function resolveAddons(productId, addons, client = pool) {
  if (!addons || !Array.isArray(addons) || addons.length === 0) return [];

  const optionIds = addons.map((a) => a.addon_option_id).filter(Boolean);
  if (!optionIds.length) return [];

  const placeholders = optionIds.map((_, i) => `$${i + 1}`).join(',');
  const result = await client.query(
    `SELECT o.id, o.name, o.price, g.product_id
     FROM addon_options o
     JOIN addon_groups g ON g.id = o.group_id
     WHERE o.id IN (${placeholders}) AND o.active = true`,
    optionIds
  );

  const byId = {};
  for (const row of result.rows) byId[row.id] = row;

  const resolved = [];
  for (const a of addons) {
    const option = byId[a.addon_option_id];
    if (!option) throw { status: 400, message: 'Adicional inválido' };
    if (option.product_id !== productId) throw { status: 400, message: 'Adicional não pertence a este produto' };
    resolved.push({
      addon_option_id: option.id,
      name: option.name,
      price: parseFloat(option.price),
      quantity: a.quantity && a.quantity > 0 ? a.quantity : 1,
    });
  }
  return resolved;
}

async function insertItemAddons(orderItemId, addons, client = pool) {
  for (const a of addons || []) {
    await client.query(
      `INSERT INTO order_item_addons (order_item_id, addon_option_id, name, price, quantity)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [orderItemId, a.addon_option_id, a.name, a.price, a.quantity]
    );
  }
}

// POST /api/orders/guest — pedido sem autenticação (app cliente)
router.post('/guest', async (req, res) => {
  const { name, phone, delivery_type, delivery_address,
          payment_method, notes, delivery_fee = 0, items } = req.body;

  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  if (!items?.length) return res.status(400).json({ error: 'Carrinho vazio' });
  if (!payment_method) return res.status(400).json({ error: 'Forma de pagamento é obrigatória' });

  try {
    const custResult = await pool.query(
      `INSERT INTO customers (name, phone) VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, phone`,
      [name, phone.replace(/\D/g, '')]
    );
    const customer = custResult.rows[0];

    const adminResult = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = adminResult.rows[0]?.id;

    let subtotal = 0;
    const resolvedItems = [];
    for (const item of items) {
      const prod = await pool.query(
        `SELECT id, name, price, promo_price, available FROM products WHERE id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: 'Produto não encontrado' };
      if (!prod.rows[0].available) throw { status: 400, message: `"${prod.rows[0].name}" indisponível` };
      const unitPrice = prod.rows[0].promo_price !== null ? parseFloat(prod.rows[0].promo_price) : parseFloat(prod.rows[0].price);

      const resolvedAddons = await resolveAddons(item.product_id, item.addons);
      const addonsUnitTotal = resolvedAddons.reduce((s, a) => s + a.price * a.quantity, 0);

      const itemSub = (unitPrice + addonsUnitTotal) * item.quantity;
      subtotal += itemSub;
      resolvedItems.push({ ...item, unit_price: unitPrice, subtotal: itemSub, product_name: prod.rows[0].name, addons: resolvedAddons });
    }

    const total = subtotal + parseFloat(delivery_fee);

    const orderResult = await pool.query(
      `INSERT INTO orders (customer_id, user_id, delivery_type, delivery_address, subtotal,
        delivery_fee, discount, total, payment_method, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,'aguardando_pagamento') RETURNING *`,
      [customer.id, adminId, delivery_type || 'delivery',
       delivery_address ? JSON.stringify(delivery_address) : null,
       subtotal, parseFloat(delivery_fee), total, payment_method, notes || null]
    );
    const order = orderResult.rows[0];

    for (const item of resolvedItems) {
      const itemResult = await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [order.id, item.product_id, item.quantity, item.unit_price, item.subtotal, item.notes || null]
      );
      await insertItemAddons(itemResult.rows[0].id, item.addons);
    }

    await pool.query(
      `INSERT INTO order_status_history (order_id, status, user_id) VALUES ($1,'aguardando_pagamento',$2) RETURNING id`,
      [order.id, adminId]
    );

    // Gera link WhatsApp manual para o admin confirmar o pedido com o cliente
    let whatsapp_link = null;
    try {
      if (phone) {
        const itemsList = resolvedItems.map(i => `• ${i.quantity}x ${i.product_name}`).join('\n');
        const totalFmt = `R$ ${total.toFixed(2).replace('.', ',')}`;
        const tipo = (delivery_type === 'retirada') ? '🏪 Retirada' : '🛵 Entrega';
        const msg = `🔔 *Novo Pedido #${order.order_number}*\n\n👤 ${customer.name}\n📱 ${phone}\n${tipo}\n\n${itemsList}\n\n💰 Total: ${totalFmt}\n💳 Pagamento: ${payment_method}`;
        whatsapp_link = `https://wa.me/55${phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
      }
    } catch(e) {}

    broadcastOrderUpdate({ event: 'new_order', order: { ...order, customer_name: customer.name, item_count: resolvedItems.length }, whatsapp_link });

    res.status(201).json({ ...order, customer_name: customer.name, items: resolvedItems });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[orders/guest]', err.message);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
});

router.use(authMiddleware);

// GET /api/orders — listar pedidos (com filtros)
router.get('/', async (req, res) => {
  const { status, date, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const values = [];
  const conditions = [];
  let idx = 1;

  if (status) { conditions.push(`o.status = $${idx++}`); values.push(status); }
  if (date) {
    conditions.push(`DATE(o.created_at) = $${idx++}`);
    values.push(date);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  values.push(parseInt(limit), offset);

  try {
    const result = await pool.query(
      `SELECT
         o.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         COUNT(oi.id) AS item_count
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id, c.name, c.phone
       ORDER BY o.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[orders/GET]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/orders/:id — pedido completo com itens
router.get('/:id', async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
              c.email AS customer_email
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    const items = await pool.query(
      `SELECT oi.*, p.name AS product_name, p.image_url
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );

    const itemAddons = await pool.query(
      `SELECT a.* FROM order_item_addons a
       JOIN order_items oi ON oi.id = a.order_item_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );
    for (const item of items.rows) {
      item.addons = itemAddons.rows.filter((a) => a.order_item_id === item.id);
    }

    const history = await pool.query(
      `SELECT h.*, u.name AS user_name
       FROM order_status_history h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.order_id = $1 ORDER BY h.created_at`,
      [req.params.id]
    );

    res.json({ ...order.rows[0], items: items.rows, history: history.rows });
  } catch (err) {
    console.error('[orders/:id]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/orders — criar pedido
router.post('/', async (req, res) => {
  const { customer_id, items, delivery_type, delivery_address,
          payment_method, notes, delivery_fee = 0, discount = 0 } = req.body;

  if (!customer_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer_id e items são obrigatórios' });
  }
  if (!payment_method) {
    return res.status(400).json({ error: 'payment_method é obrigatório' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Valida e calcula itens
    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity < 1) {
        throw { status: 400, message: 'Cada item precisa de product_id e quantity > 0' };
      }
      const prod = await client.query(
        `SELECT p.id, p.name, p.price, p.promo_price, p.available, c.name AS category_name
         FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: `Produto ${item.product_id} não encontrado` };
      if (!prod.rows[0].available) throw { status: 400, message: `Produto "${prod.rows[0].name}" indisponível` };

      const unitPrice = prod.rows[0].promo_price !== null ? parseFloat(prod.rows[0].promo_price) : parseFloat(prod.rows[0].price);
      const resolvedAddons = await resolveAddons(item.product_id, item.addons, client);
      const addonsUnitTotal = resolvedAddons.reduce((s, a) => s + a.price * a.quantity, 0);
      const itemSubtotal = (unitPrice + addonsUnitTotal) * item.quantity;
      subtotal += itemSubtotal;
      resolvedItems.push({ ...item, unit_price: unitPrice, subtotal: itemSubtotal, product_name: prod.rows[0].name, category_name: prod.rows[0].category_name, addons: resolvedAddons });
    }

    const total = Math.max(0, subtotal + parseFloat(delivery_fee) - parseFloat(discount));

    // Cria pedido
    const orderResult = await client.query(
      `INSERT INTO orders
         (customer_id, user_id, delivery_type, delivery_address, subtotal,
          delivery_fee, discount, total, payment_method, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [customer_id, req.user.id, delivery_type || 'delivery',
       delivery_address ? JSON.stringify(delivery_address) : null,
       subtotal, delivery_fee, discount, total, payment_method, notes]
    );
    const order = orderResult.rows[0];

    // Insere itens
    for (const item of resolvedItems) {
      const itemResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [order.id, item.product_id, item.quantity, item.unit_price, item.subtotal, item.notes || null]
      );
      await insertItemAddons(itemResult.rows[0].id, item.addons, client);
    }

    // Histórico inicial
    await client.query(
      `INSERT INTO order_status_history (order_id, status, user_id) VALUES ($1,$2,$3) RETURNING id`,
      [order.id, 'aguardando_pagamento', req.user.id]
    );

    await client.query('COMMIT');

    // Pagamento PIX via Stripe
    let pixData = null;
    if (payment_method === 'pix') {
      try {
        pixData = await stripeService.createPixPayment(order.id, total);
        await pool.query(
          `UPDATE orders SET stripe_payment_intent_id=$1, stripe_pix_qr_code=$2, stripe_pix_qr_code_url=$3 WHERE id=$4 RETURNING id`,
          [pixData.paymentIntentId, pixData.qrCode, pixData.qrCodeUrl, order.id]
        );
      } catch (stripeErr) {
        console.error('[stripe/pix]', stripeErr.message);
      }
    }

    // Roteia para estações e imprime
    const stationMap = getStationsForOrder(resolvedItems);
    for (const [stationKey, stationItems] of Object.entries(stationMap)) {
      const stationCfg = STATION_ROUTES[stationKey];
      // Broadcast WebSocket para a estação
      broadcastToStation(stationKey, {
        event: 'new_order',
        order: { id: order.id, delivery_type: order.delivery_type, notes: order.notes, customer_name: order.customer_name },
        items: stationItems,
      });
      // Impressão automática (não-bloqueante)
      printOrderTicket(stationCfg.printer, {
        stationName: stationCfg.name,
        emoji: stationCfg.emoji,
        order,
        items: stationItems,
      }).catch((e) => console.error('[print]', e.message));
    }

    // Notifica retaguarda (pedido completo)
    broadcastOrderUpdate({ event: 'new_order', order: { ...order, item_count: resolvedItems.length } });

    res.status(201).json({ ...order, items: resolvedItems, pix: pixData });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[orders/POST]', err.message);
    res.status(500).json({ error: 'Erro interno ao criar pedido' });
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:id/status — atualizar status
router.patch('/:id/status', async (req, res) => {
  const { status, notes } = req.body;
  const validStatuses = [
    'aguardando_pagamento','pago','confirmado','em_preparo',
    'pronto','saiu_para_entrega','entregue','cancelado'
  ];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Status inválido', valid: validStatuses });
  }

  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2
       RETURNING *, (SELECT name FROM customers WHERE id = customer_id) AS customer_name,
                    (SELECT phone FROM customers WHERE id = customer_id) AS customer_phone`,
      [status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    await pool.query(
      `INSERT INTO order_status_history (order_id, status, user_id, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.params.id, status, req.user.id, notes || null]
    );

    broadcastOrderUpdate({ event: 'status_update', order_id: req.params.id, status });

    const order = result.rows[0];
    let whatsapp_link = null;

    const NOTIFY_STATUSES = ['confirmado', 'em_preparo', 'saiu_para_entrega', 'cancelado'];
    if (NOTIFY_STATUSES.includes(status)) {
      const customerPhone = (order.customer_phone || '').replace(/\D/g, '');
      const orderNum = order.order_number;
      const firstName = order.customer_name?.split(' ')[0] || '';

      if (customerPhone) {
        let msg = '';
        if (status === 'confirmado') {
          msg = `✅ *Pedido #${orderNum} confirmado!*\n\nOlá ${firstName}! Recebemos seu pedido e já estamos cuidando de tudo. Logo logo estará pronto! ☕🎉`;
        } else if (status === 'em_preparo') {
          msg = `👨‍🍳 *Pedido #${orderNum} em preparo!*\n\nOlá ${firstName}! Seu pedido está sendo preparado com carinho. Em breve estará pronto! ☕`;
        } else if (status === 'saiu_para_entrega') {
          const isRetirada = order.delivery_type === 'retirada';
          if (isRetirada) {
            msg = `✅ *Pedido #${orderNum} pronto para retirada!*\n\nOlá ${firstName}! Seu pedido está pronto, pode vir buscar! 🏪`;
          } else {
            msg = `🛵 *Pedido #${orderNum} saiu para entrega!*\n\nOlá ${firstName}! Seu pedido saiu e está a caminho. Logo chegará aí! 🎉`;
          }
        } else if (status === 'cancelado') {
          msg = `❌ *Pedido #${orderNum} cancelado*\n\nOlá ${firstName}! Infelizmente seu pedido foi cancelado. Entre em contato conosco para mais informações. 😔`;
        }
        if (msg) {
          whatsapp_link = `https://wa.me/55${customerPhone}?text=${encodeURIComponent(msg)}`;
        }
      }
    }

    res.json({ ...order, whatsapp_link });
  } catch (err) {
    console.error('[orders/:id/status]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/orders/:id — editar endereço e telefone do pedido
router.patch('/:id', async (req, res) => {
  const { phone, delivery_address } = req.body;
  try {
    const order = await pool.query(`SELECT customer_id FROM orders WHERE id = $1`, [req.params.id]);
    if (!order.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    if (phone) {
      await pool.query(`UPDATE customers SET phone = $1 WHERE id = $2`, [phone.replace(/\D/g, ''), order.rows[0].customer_id]);
    }
    if (delivery_address !== undefined) {
      await pool.query(`UPDATE orders SET delivery_address = $1 WHERE id = $2`, [delivery_address ? JSON.stringify(delivery_address) : null, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[orders/PATCH]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/orders/:id — excluir pedido (requer senha admin)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM order_items WHERE order_id = $1 RETURNING id`, [req.params.id]);
    await pool.query(`DELETE FROM order_status_history WHERE order_id = $1 RETURNING id`, [req.params.id]);
    await pool.query(`DELETE FROM orders WHERE id = $1 RETURNING id`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[orders/DELETE]', err.message);
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

// POST /api/orders/webhook/stripe — webhook Stripe
router.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripeService.constructWebhookEvent(req.rawBody, sig);

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const result = await pool.query(
        `UPDATE orders SET payment_status='pago', status='pago'
         WHERE stripe_payment_intent_id=$1 RETURNING id`,
        [pi.id]
      );
      if (result.rows[0]) {
        await pool.query(
          `INSERT INTO order_status_history (order_id, status) VALUES ($1,'pago') RETURNING id`,
          [result.rows[0].id]
        );
        broadcastOrderUpdate({ event: 'payment_confirmed', order_id: result.rows[0].id });
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      await pool.query(
        `UPDATE orders SET payment_status='falhou' WHERE stripe_payment_intent_id=$1 RETURNING id`,
        [pi.id]
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[webhook/stripe]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
