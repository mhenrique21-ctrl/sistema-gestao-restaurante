const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastOrderUpdate, broadcastToStation } = require('../websocket/hub');
const stripeService = require('../services/stripe');
const { getStationsForOrder, STATION_ROUTES } = require('../services/stations');
const { printOrderTicket } = require('../services/printer');

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
        `SELECT id, name, price, available FROM products WHERE id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: 'Produto não encontrado' };
      if (!prod.rows[0].available) throw { status: 400, message: `"${prod.rows[0].name}" indisponível` };
      const unitPrice = parseFloat(prod.rows[0].price);
      const itemSub = unitPrice * item.quantity;
      subtotal += itemSub;
      resolvedItems.push({ ...item, unit_price: unitPrice, subtotal: itemSub, product_name: prod.rows[0].name });
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
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.product_id, item.quantity, item.unit_price, item.subtotal, item.notes || null]
      );
    }

    await pool.query(
      `INSERT INTO order_status_history (order_id, status, user_id) VALUES ($1,'aguardando_pagamento',$2)`,
      [order.id, adminId]
    );

    broadcastOrderUpdate({ event: 'new_order', order: { ...order, customer_name: customer.name, item_count: resolvedItems.length } });

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
        `SELECT p.id, p.name, p.price, p.available, c.name AS category_name
         FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: `Produto ${item.product_id} não encontrado` };
      if (!prod.rows[0].available) throw { status: 400, message: `Produto "${prod.rows[0].name}" indisponível` };

      const unitPrice = parseFloat(prod.rows[0].price);
      const itemSubtotal = unitPrice * item.quantity;
      subtotal += itemSubtotal;
      resolvedItems.push({ ...item, unit_price: unitPrice, subtotal: itemSubtotal, product_name: prod.rows[0].name, category_name: prod.rows[0].category_name });
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
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.product_id, item.quantity, item.unit_price, item.subtotal, item.notes || null]
      );
    }

    // Histórico inicial
    await client.query(
      `INSERT INTO order_status_history (order_id, status, user_id) VALUES ($1,$2,$3)`,
      [order.id, 'aguardando_pagamento', req.user.id]
    );

    await client.query('COMMIT');

    // Pagamento PIX via Stripe
    let pixData = null;
    if (payment_method === 'pix') {
      try {
        pixData = await stripeService.createPixPayment(order.id, total);
        await pool.query(
          `UPDATE orders SET stripe_payment_intent_id=$1, stripe_pix_qr_code=$2, stripe_pix_qr_code_url=$3 WHERE id=$4`,
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
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    await pool.query(
      `INSERT INTO order_status_history (order_id, status, user_id, notes) VALUES ($1,$2,$3,$4)`,
      [req.params.id, status, req.user.id, notes || null]
    );

    broadcastOrderUpdate({ event: 'status_update', order_id: req.params.id, status });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[orders/:id/status]', err.message);
    res.status(500).json({ error: 'Erro interno' });
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
          `INSERT INTO order_status_history (order_id, status) VALUES ($1,'pago')`,
          [result.rows[0].id]
        );
        broadcastOrderUpdate({ event: 'payment_confirmed', order_id: result.rows[0].id });
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      await pool.query(
        `UPDATE orders SET payment_status='falhou' WHERE stripe_payment_intent_id=$1`,
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
