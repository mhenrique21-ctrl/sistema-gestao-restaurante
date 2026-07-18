const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastOrderUpdate, broadcastToStation } = require('../websocket/hub');
const stripeService = require('../services/stripe');
const asaasService = require('../services/asaas');
const { getStationsForOrder, STATION_ROUTES } = require('../services/stations');
const { printOrderTicket } = require('../services/printer');
const https = require('https');
const http = require('http');

async function applyPromotion(subtotal, deliveryFee, neighborhoodName) {
  const nowDay = new Date().getDay();
  // Busca zona do bairro se informado
  let zone = null;
  if (neighborhoodName) {
    const nb = await pool.query(`SELECT zone FROM neighborhoods WHERE name = $1 LIMIT 1`, [neighborhoodName]);
    zone = nb.rows[0]?.zone?.toUpperCase() || null;
  }
  const result = await pool.query(`SELECT * FROM promotions WHERE active = true ORDER BY created_at`);
  let discount = 0, appliedPromo = null;
  for (const promo of result.rows) {
    if (promo.day_of_week?.length && !promo.day_of_week.includes(nowDay)) continue;
    if (subtotal < parseFloat(promo.min_order_value)) continue;
    if (promo.zones?.length && zone && !promo.zones.includes(zone)) continue;
    let d = 0;
    if (promo.discount_type === 'free_delivery') d = deliveryFee;
    else if (promo.discount_type === 'percent') d = subtotal * (parseFloat(promo.discount_value) / 100);
    else if (promo.discount_type === 'fixed') d = parseFloat(promo.discount_value);
    if (d > discount) { discount = d; appliedPromo = promo; }
  }
  return { discount: Math.round(discount * 100) / 100, promo: appliedPromo };
}

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
          payment_method, notes, delivery_fee = 0, items, coupon_code, coupon_subtotal, stripe_payment_intent_id, cpf } = req.body;

  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  if (!items?.length) return res.status(400).json({ error: 'Carrinho vazio' });
  if (!payment_method) return res.status(400).json({ error: 'Forma de pagamento é obrigatória' });
  if (payment_method === 'pix' && !cpf) return res.status(400).json({ error: 'Informe o CPF para pagar via PIX' });

  try {
    // Bloqueia forma de pagamento desativada pelo admin (aba Pagamentos)
    const pmCheck = await pool.query(`SELECT active FROM payment_methods WHERE code = $1`, [payment_method]);
    if (pmCheck.rows[0] && pmCheck.rows[0].active === false) {
      return res.status(400).json({ error: 'Forma de pagamento indisponível no momento' });
    }

    const custResult = await pool.query(
      `INSERT INTO customers (name, phone, active) VALUES ($1, $2, true)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, active = true
       RETURNING id, name, phone, blocked`,
      [name, phone.replace(/\D/g, '')]
    );
    const customer = custResult.rows[0];
    if (customer.blocked) return res.status(403).json({ error: 'Não foi possível realizar o pedido.' });

    const adminResult = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = adminResult.rows[0]?.id;

    let subtotal = 0;
    const resolvedItems = [];
    for (const item of items) {
      const prod = await pool.query(
        `SELECT id, name, price, promo_price, promo_max_qty, available, print_target FROM products WHERE id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: 'Produto não encontrado' };
      if (!prod.rows[0].available) throw { status: 400, message: `"${prod.rows[0].name}" indisponível` };
      if (prod.rows[0].promo_price !== null && prod.rows[0].promo_max_qty && item.quantity > prod.rows[0].promo_max_qty) {
        throw { status: 400, message: `"${prod.rows[0].name}": máximo ${prod.rows[0].promo_max_qty} unidade(s) na promoção` };
      }
      const unitPrice = prod.rows[0].promo_price !== null ? parseFloat(prod.rows[0].promo_price) : parseFloat(prod.rows[0].price);

      const resolvedAddons = await resolveAddons(item.product_id, item.addons);
      const addonsUnitTotal = resolvedAddons.reduce((s, a) => s + a.price * a.quantity, 0);

      const itemSub = (unitPrice + addonsUnitTotal) * item.quantity;
      subtotal += itemSub;
      resolvedItems.push({ ...item, unit_price: unitPrice, subtotal: itemSub, product_name: prod.rows[0].name, print_target: prod.rows[0].print_target, addons: resolvedAddons });
    }

    const fee = parseFloat(delivery_fee);
    const neighborhoodName = delivery_address?.neighborhood || null;
    const { discount: promoDiscount, promo: appliedPromo } = await applyPromotion(subtotal, fee, neighborhoodName);

    // Validar cupom no servidor
    let couponDiscount = 0;
    let appliedCoupon = null;
    if (coupon_code) {
      const cRes = await pool.query(
        `SELECT * FROM coupons WHERE code = $1 AND active = true`,
        [coupon_code.trim().toUpperCase()]
      );
      const c = cRes.rows[0];
      // base para desconto: apenas itens sem promo_price (enviado pelo frontend)
      const couponBase = coupon_subtotal != null ? parseFloat(coupon_subtotal) : subtotal;
      if (c && !(c.expires_at && new Date(c.expires_at) < new Date())
             && !(c.max_uses !== null && c.uses_count >= c.max_uses)
             && couponBase >= parseFloat(c.min_order_value)) {
        if (c.discount_type === 'percent')      couponDiscount = couponBase * (parseFloat(c.discount_value) / 100);
        else if (c.discount_type === 'fixed')   couponDiscount = parseFloat(c.discount_value);
        else if (c.discount_type === 'free_delivery') couponDiscount = fee;
        couponDiscount = Math.round(Math.min(couponDiscount, subtotal + fee) * 100) / 100;
        appliedCoupon = c;
      }
    }

    // Usa o maior desconto entre promoção e cupom
    const finalDiscount = Math.max(promoDiscount, couponDiscount);
    const discountLabel = couponDiscount >= promoDiscount ? (appliedCoupon?.description || coupon_code) : appliedPromo?.name;
    const total = subtotal + fee - finalDiscount;

    // Verifica no servidor (nunca confia no cliente) que o pagamento por cartão/Apple Pay foi realmente aprovado
    if (payment_method === 'apple_pay' && !stripe_payment_intent_id) {
      throw { status: 400, message: 'Pagamento não confirmado' };
    }
    let cardVerified = false;
    if (stripe_payment_intent_id) {
      try {
        const pi = await stripeService.stripe.paymentIntents.retrieve(stripe_payment_intent_id);
        cardVerified = pi.status === 'succeeded' && Math.abs(pi.amount - Math.round(total * 100)) < 2;
      } catch (e) {
        console.error('[orders/guest/card-verify]', e.message);
      }
      if (!cardVerified) throw { status: 400, message: 'Pagamento não confirmado' };
    }
    const paymentStatus = cardVerified ? 'pago' : 'pendente';
    const piSql = cardVerified ? `'${stripe_payment_intent_id.replace(/'/g,"''")}'` : 'NULL';

    const orderResult = await pool.query(
      `INSERT INTO orders (customer_id, user_id, delivery_type, delivery_address, subtotal,
        delivery_fee, discount, total, payment_method, notes, coupon_code, status, stripe_payment_intent_id, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,${finalDiscount},$7,$8,$9,${appliedCoupon ? `'${appliedCoupon.code.replace(/'/g,"''")}'` : 'NULL'},'aguardando_pagamento',${piSql},'${paymentStatus}') RETURNING *`,
      [customer.id, adminId, delivery_type || 'delivery',
       delivery_address ? JSON.stringify(delivery_address) : null,
       subtotal, fee, total, payment_method, notes || null]
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

    // Pagamento PIX via Asaas — pedido fica "aguardando_pagamento" até o webhook confirmar
    let pixData = null;
    if (payment_method === 'pix') {
      try {
        const asaasPix = await asaasService.createPixCharge({
          name, cpfCnpj: cpf, phone, value: total,
          description: `Pedido #${order.order_number} — Confraria Café`,
          externalReference: order.id,
        });
        pixData = { qrCode: asaasPix.qrCode, qrCodeUrl: asaasPix.qrCodeUrl };
        await pool.query(
          `UPDATE orders SET asaas_payment_id=$1 WHERE id=$2 RETURNING id`,
          [asaasPix.paymentId, order.id]
        );
      } catch (asaasErr) {
        console.error('[asaas/pix/guest]', asaasErr.message);
      }
    }

    // Para os demais métodos (dinheiro, maquininha na entrega, cartão/Apple Pay já
    // confirmados de forma síncrona antes de criar o pedido), confirma e avisa na hora.
    // PIX só passa por aqui quando o webhook da Asaas confirmar o pagamento.
    if (payment_method !== 'pix') {
      try {
        await pool.query(`UPDATE orders SET status = 'confirmado' WHERE id = $1 RETURNING id`, [order.id]);
        await pool.query(
          `INSERT INTO order_status_history (order_id, status, user_id) VALUES ($1,'confirmado',$2) RETURNING id`,
          [order.id, adminId]
        );
        order.status = 'confirmado';
      } catch(e) { console.error('[auto-confirm]', e.message); }

      try {
        const customerPhone = customer.phone.replace(/\D/g, '');
        if (customerPhone) {
          const nome = customer.name.split(' ')[0];
          const itemsList = resolvedItems.map(i => {
            const sub = (i.unit_price * i.quantity).toFixed(2).replace('.', ',');
            const addonsLines = (i.addons || []).map(a => {
              const addonTotal = (parseFloat(a.price || 0) * (a.quantity || 1)).toFixed(2).replace('.', ',');
              return parseFloat(a.price || 0) > 0 ? `   ➕ ${a.name} — R$ ${addonTotal}` : `   ➕ ${a.name}`;
            }).join('\n');
            const obsItem = i.notes ? `\n   📝 ${i.notes}` : '';
            return `• ${i.quantity}x ${i.product_name} — R$ ${sub}${addonsLines ? '\n' + addonsLines : ''}${obsItem}`;
          }).join('\n');
          const addr = delivery_address
            ? (typeof delivery_address === 'string' ? delivery_address
              : `${delivery_address.street || ''}, ${delivery_address.number || ''} - ${delivery_address.neighborhood || ''}`)
            : '';
          const tipo = delivery_type === 'retirada' ? '🏪 Retirada na loja' : `🛵 Entrega${addr ? '\n📍 ' + addr : ''}`;
          const promoLine = finalDiscount > 0 ? `\n🎉 Desconto (${discountLabel}): -R$ ${finalDiscount.toFixed(2).replace('.', ',')}` : '';
          const taxaLine = fee > 0 ? `\nTaxa entrega: R$ ${fee.toFixed(2).replace('.', ',')}${(appliedCoupon?.discount_type === 'free_delivery' || appliedPromo?.discount_type === 'free_delivery') ? ' ✅ Grátis!' : ''}` : '';
          const subtotalLine = parseFloat(delivery_fee) > 0 ? `\nSubtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}` : '';
          const obsGeral = notes ? `\n\n📝 *Obs:* ${notes}` : '';
          const msgCliente =
            `☕ *Confraria Café*\n` +
            `📍 Av Almirante Barroso, 746 - Centro\n` +
            `📞 96 97400-7410\n` +
            `─────────────────\n` +
            `✅ *Pedido #${order.order_number} confirmado!*\n\n` +
            `Olá ${nome}! Seu pedido foi recebido e já estamos preparando ☕\n\n` +
            `*🛒 Itens:*\n${itemsList}${obsGeral}\n\n` +
            `${tipo}${subtotalLine}${taxaLine}${promoLine}\n` +
            `─────────────────\n` +
            `💰 *Total: R$ ${total.toFixed(2).replace('.', ',')}*\n` +
            `💳 Pagamento: ${payment_method}\n\n` +
            `Em breve ficará pronto! 🎉`;
          sendWhatsApp(customerPhone, msgCliente).then(code => console.log('[whatsapp/confirm_cliente] status:', code));
        }
      } catch(e) { console.error('[whatsapp/confirm_cliente]', e.message); }

      broadcastOrderUpdate({ event: 'new_order', order: { ...order, customer_name: customer.name, item_count: resolvedItems.length }, items: resolvedItems });

      // Impressão automática em todas as impressoras
      try {
        const stationMap = getStationsForOrder(resolvedItems);
        for (const [stationKey, stationItems] of Object.entries(stationMap)) {
          const stationCfg = STATION_ROUTES[stationKey];
          printOrderTicket(stationCfg.printer, {
            stationName: stationCfg.name,
            emoji: stationCfg.emoji,
            fullReceipt: stationCfg.fullReceipt || false,
            order: { ...order, customer_name: customer.name },
            items: stationItems,
          }).catch((e) => console.error(`[print/${stationKey}]`, e.message));
        }
      } catch(e) { console.error('[print/guest]', e.message); }
    }

    res.status(201).json({ ...order, customer_name: customer.name, items: resolvedItems, pix: pixData });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[orders/guest]', err.message);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
});

// POST /api/orders/create-card-intent — cria PaymentIntent pra cobrança de cartão no checkout
router.post('/create-card-intent', async (req, res) => {
  const amount = parseFloat(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
  try {
    const paymentIntent = await stripeService.stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'brl',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });
    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
    console.error('[orders/create-card-intent]', err.message);
    res.status(500).json({ error: 'Não foi possível iniciar o pagamento' });
  }
});

// GET /api/orders/customer/:phone — histórico público por telefone (app cliente)
router.get('/customer/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Telefone inválido' });
  try {
    const result = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.total, o.created_at, o.delivery_type,
              COUNT(oi.id)::int AS item_count
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE c.phone = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [phone]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[orders/customer]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/orders/public/:id — consulta pública de pedido para o cliente acompanhar
router.get('/public/:id', async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.total, o.delivery_type, o.created_at
       FROM orders o WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    const items = await pool.query(
      `SELECT oi.id, oi.quantity, oi.subtotal, oi.product_id, p.name AS product_name
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );

    res.json({ ...order.rows[0], items: items.rows });
  } catch (err) {
    console.error('[orders/public]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/orders/webhook/asaas — webhook Asaas (confirmação de pagamento PIX)
// Rota pública (Asaas chama direto, sem JWT de usuário) — por isso fica ANTES do
// router.use(authMiddleware) abaixo. Só aqui a venda PIX é considerada confirmada
// de fato: avisa cozinha/impressora e cliente.
router.post('/webhook/asaas', async (req, res) => {
  try {
    const token = req.headers['asaas-access-token'];
    const envToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (envToken && token !== envToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const { event, payment } = req.body || {};
    if ((event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') && payment?.id) {
      const result = await pool.query(
        `UPDATE orders SET payment_status='pago', status='confirmado'
         WHERE asaas_payment_id=$1 AND status != 'confirmado' RETURNING id`,
        [payment.id]
      );
      if (result.rows[0]) {
        const orderId = result.rows[0].id;
        await pool.query(
          `INSERT INTO order_status_history (order_id, status) VALUES ($1,'confirmado') RETURNING id`,
          [orderId]
        );

        const orderRes = await pool.query(
          `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
           FROM orders o JOIN customers c ON c.id = o.customer_id
           WHERE o.id = $1`,
          [orderId]
        );
        const order = orderRes.rows[0];

        const itemsRes = await pool.query(
          `SELECT oi.*, p.name AS product_name, p.print_target
           FROM order_items oi JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1`,
          [orderId]
        );
        const itemAddons = await pool.query(
          `SELECT a.* FROM order_item_addons a
           JOIN order_items oi ON oi.id = a.order_item_id
           WHERE oi.order_id = $1`,
          [orderId]
        );
        const resolvedItems = itemsRes.rows.map((item) => ({
          ...item,
          addons: itemAddons.rows.filter((a) => a.order_item_id === item.id),
        }));

        // "Pagamento: PIX Online" só na impressão/mensagem — o campo payment_method no
        // banco continua 'pix' pra não quebrar filtros/telas que comparam por esse valor.
        broadcastOrderUpdate({
          event: 'new_order',
          order: { ...order, customer_name: order.customer_name, item_count: resolvedItems.length, payment_method: 'PIX Online' },
          items: resolvedItems,
        });

        try {
          const customerPhone = (order.customer_phone || '').replace(/\D/g, '');
          if (customerPhone) {
            const nome = order.customer_name.split(' ')[0];
            const itemsList = resolvedItems.map(i => {
              const sub = (parseFloat(i.unit_price) * i.quantity).toFixed(2).replace('.', ',');
              const addonsLines = (i.addons || []).map(a => {
                const addonTotal = (parseFloat(a.price || 0) * (a.quantity || 1)).toFixed(2).replace('.', ',');
                return parseFloat(a.price || 0) > 0 ? `   ➕ ${a.name} — R$ ${addonTotal}` : `   ➕ ${a.name}`;
              }).join('\n');
              const obsItem = i.notes ? `\n   📝 ${i.notes}` : '';
              return `• ${i.quantity}x ${i.product_name} — R$ ${sub}${addonsLines ? '\n' + addonsLines : ''}${obsItem}`;
            }).join('\n');
            const addr = order.delivery_address
              ? (typeof order.delivery_address === 'string' ? order.delivery_address
                : `${order.delivery_address.street || ''}, ${order.delivery_address.number || ''} - ${order.delivery_address.neighborhood || ''}`)
              : '';
            const tipo = order.delivery_type === 'retirada' ? '🏪 Retirada na loja' : `🛵 Entrega${addr ? '\n📍 ' + addr : ''}`;
            const msgCliente =
              `☕ *Confraria Café*\n` +
              `📍 Av Almirante Barroso, 746 - Centro\n` +
              `📞 96 97400-7410\n` +
              `─────────────────\n` +
              `✅ *Pagamento PIX confirmado! Pedido #${order.order_number}*\n\n` +
              `Olá ${nome}! Recebemos seu pagamento e já estamos preparando ☕\n\n` +
              `*🛒 Itens:*\n${itemsList}\n\n` +
              `${tipo}\n` +
              `─────────────────\n` +
              `💰 *Total: R$ ${parseFloat(order.total).toFixed(2).replace('.', ',')}*\n` +
              `💳 Pagamento: PIX Online\n\n` +
              `Em breve ficará pronto! 🎉`;
            sendWhatsApp(customerPhone, msgCliente).then(code => console.log('[whatsapp/asaas_confirm] status:', code));
          }
        } catch (e) { console.error('[whatsapp/asaas_confirm]', e.message); }
      }
    }

    if (event === 'PAYMENT_OVERDUE' && payment?.id) {
      await pool.query(
        `UPDATE orders SET payment_status='falhou' WHERE asaas_payment_id=$1 RETURNING id`,
        [payment.id]
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[webhook/asaas]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.use(authMiddleware);

// GET /api/orders — listar pedidos (com filtros)
router.get('/', async (req, res) => {
  const { status, date, page = 1, limit = 30, archived } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const values = [];
  const conditions = [];
  let idx = 1;

  if (status) { conditions.push(`o.status = $${idx++}`); values.push(status); }
  if (date) {
    conditions.push(`DATE(o.created_at) = $${idx++}`);
    values.push(date);
  }
  conditions.push(archived === 'true' ? `o.archived_at IS NOT NULL` : `o.archived_at IS NULL`);

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

// POST /api/orders/close-register — arquiva TODAS as vendas ainda não fechadas (somem do
// painel de Pedidos, ficam disponíveis em ARQUIVO) e manda o resumo pra impressão térmica
router.post('/close-register', requireRole('admin'), async (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const totals = await pool.query(
      `SELECT
         COUNT(*) AS total_pedidos,
         SUM(CASE WHEN status != 'cancelado' THEN total ELSE 0 END) AS receita,
         SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS cancelados,
         SUM(COALESCE(discount, 0)) AS total_descontos,
         SUM(COALESCE(delivery_fee, 0)) AS total_entregas
       FROM orders
       WHERE archived_at IS NULL`
    );
    const byPayment = await pool.query(
      `SELECT COALESCE(payment_method, 'Não informado') AS payment_method, COUNT(*) AS qty, SUM(total) AS total
       FROM orders
       WHERE archived_at IS NULL AND status NOT IN ('cancelado')
       GROUP BY payment_method
       ORDER BY total DESC`
    );
    const archived = await pool.query(
      `UPDATE orders SET archived_at = NOW() WHERE archived_at IS NULL RETURNING id`
    );

    const summary = { date, totals: totals.rows[0], by_payment: byPayment.rows };
    broadcastToStation('caixa', { event: 'close_register', summary });
    broadcastOrderUpdate({ event: 'register_closed', date });

    res.json({ ok: true, archived_count: archived.rows.length, summary });
  } catch (e) {
    console.error('[orders/close-register]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orders/:id/finalize — marca o pedido como finalizado (esmaece o card, some do
// fluxo de ação) e imprime o recibo de conferência (resumo + valor)
router.post('/:id/finalize', requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE orders SET finalized_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    const order = await pool.query(
      `SELECT order_number, payment_method, subtotal, delivery_fee, discount, total, created_at,
              (SELECT name FROM customers c WHERE c.id = orders.customer_id) AS customer_name
       FROM orders WHERE id = $1`,
      [req.params.id]
    );
    broadcastToStation('caixa', { event: 'finalize_order', order: order.rows[0] });
    broadcastOrderUpdate({ event: 'order_finalized', order_id: req.params.id });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orders/:id/unfinalize — reabre um pedido finalizado (some o esmaecido)
router.post('/:id/unfinalize', requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE orders SET finalized_at = NULL WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });
    broadcastOrderUpdate({ event: 'order_unfinalized', order_id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
      `SELECT oi.*, p.name AS product_name, p.image_url, p.available AS product_available
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
        `SELECT p.id, p.name, p.price, p.promo_price, p.promo_max_qty, p.available, p.print_target, c.name AS category_name
         FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: `Produto ${item.product_id} não encontrado` };
      if (!prod.rows[0].available) throw { status: 400, message: `Produto "${prod.rows[0].name}" indisponível` };
      if (prod.rows[0].promo_price !== null && prod.rows[0].promo_max_qty && item.quantity > prod.rows[0].promo_max_qty) {
        throw { status: 400, message: `"${prod.rows[0].name}": máximo ${prod.rows[0].promo_max_qty} unidade(s) na promoção` };
      }

      const unitPrice = prod.rows[0].promo_price !== null ? parseFloat(prod.rows[0].promo_price) : parseFloat(prod.rows[0].price);
      const resolvedAddons = await resolveAddons(item.product_id, item.addons, client);
      const addonsUnitTotal = resolvedAddons.reduce((s, a) => s + a.price * a.quantity, 0);
      const itemSubtotal = (unitPrice + addonsUnitTotal) * item.quantity;
      subtotal += itemSubtotal;
      resolvedItems.push({ ...item, unit_price: unitPrice, subtotal: itemSubtotal, product_name: prod.rows[0].name, category_name: prod.rows[0].category_name, print_target: prod.rows[0].print_target, addons: resolvedAddons });
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
        fullReceipt: stationCfg.fullReceipt || false,
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

// POST /api/orders/from-admin — cria pedido via admin (novo ou substituto)
router.post('/from-admin', async (req, res) => {
  const { customer_id, customer_phone, customer_name, items, delivery_type, delivery_address, payment_method, delivery_fee, troco } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items são obrigatórios' });
  }

  // Resolve customer_id por telefone se não fornecido
  let cust_id = customer_id;
  if (!cust_id && customer_phone) {
    const phone = customer_phone.replace(/\D/g, '');
    const existing = await pool.query(`SELECT id FROM customers WHERE phone = $1`, [phone]);
    if (existing.rows[0]) {
      cust_id = existing.rows[0].id;
      if (customer_name) {
        await pool.query(`UPDATE customers SET name = $1 WHERE id = $2 RETURNING id`, [customer_name, cust_id]);
      }
    } else {
      const created = await pool.query(
        `INSERT INTO customers (name, phone, active) VALUES ($1, $2, true) RETURNING id`,
        [customer_name || phone, phone]
      );
      cust_id = created.rows[0].id;
    }
  }
  if (!cust_id) return res.status(400).json({ error: 'customer_id ou customer_phone são obrigatórios' });
  try {
    let subtotal = 0;
    for (const i of items) {
      subtotal += (parseFloat(i.unit_price) || 0) * (parseInt(i.quantity) || 1);
    }
    const fee = parseFloat(delivery_fee) || 0;
    const total = subtotal + fee;
    const orderRes = await pool.query(
      `INSERT INTO orders (customer_id, status, delivery_type, delivery_address, payment_method, subtotal, delivery_fee, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cust_id, 'confirmado', delivery_type || 'retirada',
       delivery_address ? JSON.stringify(delivery_address) : null,
       payment_method || 'dinheiro', subtotal, fee, total]
    );
    const order = orderRes.rows[0];
    for (const i of items) {
      const qty = parseInt(i.quantity) || 1;
      const price = parseFloat(i.unit_price) || 0;
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [order.id, i.product_id, qty, price, qty * price]
      );
    }
    // Busca telefone e nome do cliente para enviar WhatsApp
    const cust = await pool.query(
      `SELECT name, phone FROM customers WHERE id = $1`,
      [cust_id]
    );
    if (cust.rows[0]) {
      const phone = (cust.rows[0].phone || '').replace(/\D/g, '');
      const firstName = cust.rows[0].name?.split(' ')[0] || '';
      if (phone) {
        const itemsList = items.map(i => `• ${i.quantity}× ${i.product_name}`).join('\n');
        const feeText = fee > 0 ? `\n🛵 Taxa de entrega: R$ ${fee.toFixed(2)}` : '';
        const isRetirada = (delivery_type || 'retirada') === 'retirada';
        const deliveryLine = isRetirada ? '\n🏪 Retirada no local' : `\n🛵 Entrega${feeText}`;
        const trocoLine = troco && parseFloat(troco) > 0 ? `\n💵 Troco para: R$ ${parseFloat(troco).toFixed(2)}` : '';
        const msg = `✅ *Pedido #${order.order_number} confirmado!*\n\nOlá ${firstName}! Recebemos seu pedido:\n\n${itemsList}${deliveryLine}\n\n💰 *Total: R$ ${total.toFixed(2)}* (${payment_method || 'dinheiro'})${trocoLine}\n\nObrigado pela preferência! ☕`;
        sendWhatsApp(phone, msg).then(code => console.log('[whatsapp/from-admin] status:', code));
      }
    }
    const customerName = cust.rows[0]?.name || '';
    const printItems = items.map(i => ({
      product_name: i.product_name,
      quantity: parseInt(i.quantity) || 1,
      unit_price: parseFloat(i.unit_price) || 0,
      subtotal: (parseInt(i.quantity) || 1) * (parseFloat(i.unit_price) || 0),
    }));
    broadcastOrderUpdate({
      event: 'new_order',
      order: { ...order, customer_name: customerName, item_count: items.length },
      items: printItems,
    });
    res.status(201).json({ id: order.id, order_number: order.order_number });
  } catch (err) {
    console.error('[orders/from-admin]', err.message, '| code:', err.code, '| detail:', err.detail);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// PATCH /api/orders/:id/status — atualizar status
router.patch('/:id/status', async (req, res) => {
  const { status, notes, faltantes, reason } = req.body;
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

    // Cupom: registra uso definitivo apenas quando pedido fica PRONTO
    if (status === 'pronto' && result.rows[0].coupon_code) {
      await pool.query(
        `UPDATE coupons SET uses_count = uses_count + 1 WHERE code = $1 RETURNING id`,
        [result.rows[0].coupon_code]
      );
    }

    const order = result.rows[0];
    let whatsapp_link = null;

    const NOTIFY_STATUSES = ['confirmado', 'em_preparo', 'pronto', 'saiu_para_entrega', 'cancelado'];
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
        } else if (status === 'pronto') {
          const isRetirada = order.delivery_type === 'retirada';
          if (isRetirada) {
            msg = `🎉 *Pedido #${orderNum} pronto!*\n\nOlá ${firstName}! Seu pedido está pronto para retirada. Pode vir buscar! 🏪☕`;
          } else {
            msg = `🎉 *Pedido #${orderNum} pronto!*\n\nOlá ${firstName}! Seu pedido está pronto e logo sairá para entrega. Aguarde! ☕`;
          }
        } else if (status === 'saiu_para_entrega') {
          const isRetirada = order.delivery_type === 'retirada';
          if (isRetirada) {
            msg = `✅ *Pedido #${orderNum} pronto para retirada!*\n\nOlá ${firstName}! Seu pedido está pronto, pode vir buscar! 🏪`;
          } else {
            msg = `🛵 *Pedido #${orderNum} saiu para entrega!*\n\nOlá ${firstName}! Seu pedido saiu e está a caminho. Logo chegará aí! 🎉`;
          }
        } else if (status === 'cancelado') {
          const faltantesList = Array.isArray(faltantes) ? faltantes.filter(f => f.product_id) : [];
          let extra = '';
          if (faltantesList.length) {
            extra += '\n\n🚫 *Itens indisponíveis:*\n' + faltantesList.map(f => `• ${f.quantity || 1}× ${f.name}`).join('\n');
          }
          if (reason) extra += `\n\n📝 *Motivo:* ${reason}`;
          msg = `❌ *Pedido #${orderNum} cancelado*\n\nOlá ${firstName}! Infelizmente precisamos cancelar seu pedido.${extra}\n\nEntre em contato conosco para mais informações. 😔`;
          // Desabilita produtos faltantes
          for (const f of faltantesList) {
            await pool.query(`UPDATE products SET available = false WHERE id = $1 RETURNING id`, [f.product_id]);
          }
        }
        if (msg) {
          whatsapp_link = `https://wa.me/55${customerPhone}?text=${encodeURIComponent(msg)}`;
          // Envio automático para pronto, saiu_para_entrega e cancelado
          if (status === 'pronto' || status === 'saiu_para_entrega' || status === 'cancelado') {
            sendWhatsApp(customerPhone, msg).then(code => console.log(`[whatsapp/${status}] status:`, code));
          }
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

// DELETE /api/orders/:id — excluir pedido com registro de exclusão
router.delete('/:id', async (req, res) => {
  const { reason, faltantes } = req.body || {};
  try {
    // Salva snapshot do pedido antes de excluir
    const snap = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    const o = snap.rows[0];
    if (o) {
      const itemsSnap = await pool.query(
        `SELECT oi.quantity, oi.unit_price, oi.subtotal, p.name AS product_name
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [req.params.id]
      );
      const safeItems   = JSON.stringify(itemsSnap.rows).replace(/'/g, "''");
      const safeFalt    = faltantes ? JSON.stringify(faltantes).replace(/'/g, "''") : null;
      const safeReason  = reason ? reason.replace(/'/g, "''") : null;
      const safeOrderId = req.params.id.replace(/'/g, "''");
      const safeDelType = (o.delivery_type || '').replace(/'/g, "''");
      const safeCreated = o.created_at ? `'${new Date(o.created_at).toISOString()}'` : 'NULL';
      const safeUser    = req.user?.id ? `'${req.user.id}'` : 'NULL';
      await pool.query(
        `INSERT INTO order_deletions
           (order_id, order_number, customer_name, customer_phone, total, subtotal,
            delivery_fee, discount, payment_method, delivery_type, items, faltantes,
            reason, deleted_by, order_created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 '${safeDelType}',
                 '${safeItems}'::jsonb,
                 ${safeFalt ? `'${safeFalt}'::jsonb` : 'NULL'},
                 ${safeReason ? `'${safeReason}'` : 'NULL'},
                 ${safeUser},
                 ${safeCreated}) RETURNING id`,
        [req.params.id, o.order_number, o.customer_name || null, o.customer_phone || null,
         o.total, o.subtotal, o.delivery_fee || 0, o.discount || 0, o.payment_method || null]
      );
    }
    // Desabilitar produtos faltantes no cardápio
    const faltantesIds = Array.isArray(faltantes) ? faltantes.filter(f => f.product_id).map(f => f.product_id) : [];
    for (const pid of faltantesIds) {
      await pool.query(`UPDATE products SET available = false WHERE id = $1 RETURNING id`, [pid]);
    }

    // WhatsApp automático para o cliente
    if (o && o.customer_phone) {
      const phone = o.customer_phone.replace(/\D/g, '');
      const firstName = (o.customer_name || '').split(' ')[0] || 'Cliente';
      const num = o.order_number;
      const faltantesNomes = Array.isArray(faltantes) && faltantes.length
        ? faltantes.map(f => `🚫 ${f.quantity ? f.quantity + '× ' : ''}${f.name}`).join('\n')
        : null;
      let msg = `❌ *Pedido #${num} cancelado*\n\nOlá ${firstName}! `;
      if (faltantesNomes) {
        msg += `Infelizmente precisamos cancelar seu pedido pois alguns itens estavam em falta:\n\n${faltantesNomes}\n\n`;
      } else if (reason) {
        msg += `Seu pedido foi cancelado. Motivo: ${reason}\n\n`;
      } else {
        msg += `Infelizmente seu pedido foi cancelado.\n\n`;
      }
      msg += `Pedimos desculpas pelo transtorno. Entre em contato para reagendar ou escolher outro item ☕\n📞 96 97400-7410`;
      // WhatsApp não é enviado ao excluir — apenas ao cancelar
    }

    await pool.query(`DELETE FROM order_item_addons WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1) RETURNING id`, [req.params.id]);
    await pool.query(`DELETE FROM order_items WHERE order_id = $1 RETURNING id`, [req.params.id]);
    await pool.query(`DELETE FROM order_status_history WHERE order_id = $1 RETURNING id`, [req.params.id]);
    await pool.query(`DELETE FROM orders WHERE id = $1 RETURNING id`, [req.params.id]);
    res.json({ ok: true, disabled_products: faltantesIds.length });
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
