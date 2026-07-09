const crypto = require('crypto');
const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastOrderUpdate, broadcastToStation } = require('../websocket/hub');
const { getStationsForOrder, STATION_ROUTES } = require('../services/stations');
const { printOrderTicket } = require('../services/printer');

// Rotas usadas pelo cliente direto (sem login): resolve/orders/close ficam públicas —
// o code da comanda (aleatório e imprevisível quando gerado automaticamente) é o que
// protege o acesso. Cadastro, listagem, remoção de item e reabertura continuam exigindo
// login de equipe (aplicado rota a rota abaixo, não mais globalmente).

// Resolve e valida os adicionais escolhidos para um item de comanda, recalculando
// o preço no servidor. Espelha resolveAddons() de routes/orders.js — duplicada aqui
// de propósito para não mexer no arquivo de produção do delivery.
async function resolveAddons(productId, addons) {
  if (!addons || !Array.isArray(addons) || addons.length === 0) return [];

  const optionIds = addons.map((a) => a.addon_option_id).filter(Boolean);
  if (!optionIds.length) return [];

  const placeholders = optionIds.map((_, i) => `$${i + 1}`).join(',');
  const result = await pool.query(
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

async function insertItemAddons(comandaItemId, addons) {
  for (const a of addons || []) {
    await pool.query(
      `INSERT INTO comanda_item_addons (comanda_item_id, addon_option_id, name, price, quantity)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [comandaItemId, a.addon_option_id, a.name, a.price, a.quantity]
    );
  }
}

async function loadComandaItems(comandaId) {
  const items = await pool.query(
    `SELECT ci.id, ci.product_id, p.name AS product_name, p.print_target, ci.quantity,
            ci.unit_price, ci.subtotal, ci.notes, ci.created_at
     FROM comanda_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.comanda_id = $1
     ORDER BY ci.created_at ASC`,
    [comandaId]
  );

  for (const item of items.rows) {
    const addons = await pool.query(
      `SELECT id, addon_option_id, name, price, quantity FROM comanda_item_addons WHERE comanda_item_id = $1`,
      [item.id]
    );
    item.addons = addons.rows;
  }
  return items.rows;
}

// GET /api/comandas — lista todas as comandas (admin)
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, label, status, subtotal, total, payment_method, opened_at, closed_at
       FROM comandas ORDER BY opened_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[comandas/list]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/comandas — cadastra um cartão físico (admin)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { code, label } = req.body;
  const finalCode = code?.trim() || crypto.randomBytes(8).toString('hex');

  try {
    const result = await pool.query(
      `INSERT INTO comandas (code, label, opened_by) VALUES ($1,$2,$3) RETURNING *`,
      [finalCode, label || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código já cadastrado' });
    console.error('[comandas/create]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/comandas/resolve/:code — tablet escaneia o QR e identifica a comanda
router.get('/resolve/:code', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM comandas WHERE code = $1`, [req.params.code.trim()]);
    const comanda = result.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });

    const items = await loadComandaItems(comanda.id);
    res.json({ ...comanda, items });
  } catch (err) {
    console.error('[comandas/resolve]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/comandas/:id/orders — registra pedido na comanda (soma ao total corrente)
router.post('/:id/orders', async (req, res) => {
  const { items, notes } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Itens vazios' });

  try {
    const comandaResult = await pool.query(`SELECT * FROM comandas WHERE id = $1`, [req.params.id]);
    const comanda = comandaResult.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'aberta') return res.status(400).json({ error: 'Comanda não está aberta' });

    let addedTotal = 0;
    const resolvedItems = [];
    for (const item of items) {
      const prod = await pool.query(
        `SELECT id, name, price, promo_price, available, print_target FROM products WHERE id = $1`,
        [item.product_id]
      );
      if (!prod.rows[0]) throw { status: 400, message: 'Produto não encontrado' };
      if (!prod.rows[0].available) throw { status: 400, message: `"${prod.rows[0].name}" indisponível` };
      const unitPrice = prod.rows[0].promo_price !== null ? parseFloat(prod.rows[0].promo_price) : parseFloat(prod.rows[0].price);

      const resolvedAddons = await resolveAddons(item.product_id, item.addons);
      const addonsUnitTotal = resolvedAddons.reduce((s, a) => s + a.price * a.quantity, 0);

      const itemSub = (unitPrice + addonsUnitTotal) * item.quantity;
      addedTotal += itemSub;
      resolvedItems.push({
        ...item, unit_price: unitPrice, subtotal: itemSub,
        product_name: prod.rows[0].name, print_target: prod.rows[0].print_target, addons: resolvedAddons,
      });
    }

    for (const item of resolvedItems) {
      const itemResult = await pool.query(
        `INSERT INTO comanda_items (comanda_id, product_id, quantity, unit_price, subtotal, notes, added_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [comanda.id, item.product_id, item.quantity, item.unit_price, item.subtotal, item.notes || null, req.user?.id || null]
      );
      await insertItemAddons(itemResult.rows[0].id, item.addons);
    }

    const updateResult = await pool.query(
      `UPDATE comandas SET subtotal = subtotal + $1, total = total + $1 WHERE id = $2 RETURNING *`,
      [addedTotal, comanda.id]
    );
    const updatedComanda = updateResult.rows[0];

    // Envia para cozinha/balcão em tempo real e imprime, reaproveitando o mesmo
    // pipeline usado em routes/orders.js (getStationsForOrder + printOrderTicket).
    const pseudoOrder = { id: comanda.id, customer_name: comanda.label || comanda.code, notes: notes || null };
    broadcastOrderUpdate({ event: 'new_comanda_order', comanda: updatedComanda, items: resolvedItems });
    try {
      const stationMap = getStationsForOrder(resolvedItems);
      for (const [stationKey, stationItems] of Object.entries(stationMap)) {
        const stationCfg = STATION_ROUTES[stationKey];
        broadcastToStation(stationKey, { event: 'new_comanda_order', comanda: updatedComanda, items: stationItems });
        printOrderTicket(stationCfg.printer, {
          stationName: stationCfg.name,
          emoji: stationCfg.emoji,
          fullReceipt: false,
          order: pseudoOrder,
          items: stationItems,
        }).catch((e) => console.error(`[print/comanda/${stationKey}]`, e.message));
      }
    } catch (e) { console.error('[print/comanda]', e.message); }

    res.status(201).json({ ...updatedComanda, items: resolvedItems });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[comandas/orders]', err.message);
    res.status(500).json({ error: 'Erro ao registrar pedido na comanda' });
  }
});

// DELETE /api/comandas/:id/items/:itemId — remove um item lançado por engano (equipe)
router.delete('/:id/items/:itemId', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
  try {
    const comandaResult = await pool.query(`SELECT * FROM comandas WHERE id = $1`, [req.params.id]);
    const comanda = comandaResult.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'aberta') return res.status(400).json({ error: 'Comanda não está aberta' });

    const itemResult = await pool.query(
      `SELECT * FROM comanda_items WHERE id = $1 AND comanda_id = $2`,
      [req.params.itemId, comanda.id]
    );
    const item = itemResult.rows[0];
    if (!item) return res.status(404).json({ error: 'Item não encontrado nesta comanda' });

    await pool.query(`DELETE FROM comanda_items WHERE id = $1 RETURNING id`, [item.id]);

    const updateResult = await pool.query(
      `UPDATE comandas SET subtotal = subtotal - $1, total = total - $1 WHERE id = $2 RETURNING *`,
      [item.subtotal, comanda.id]
    );

    const items = await loadComandaItems(comanda.id);
    res.json({ ...updateResult.rows[0], items });
  } catch (err) {
    console.error('[comandas/items/delete]', err.message);
    res.status(500).json({ error: 'Erro ao remover item' });
  }
});

// POST /api/comandas/:id/close — fecha a conta (uma ou mais formas de pagamento)
router.post('/:id/close', async (req, res) => {
  const { payments } = req.body;
  const validMethods = ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro'];

  if (!Array.isArray(payments) || !payments.length) {
    return res.status(400).json({ error: 'Informe ao menos uma forma de pagamento' });
  }
  for (const p of payments) {
    if (!validMethods.includes(p.method)) return res.status(400).json({ error: 'Forma de pagamento inválida' });
    if (!(parseFloat(p.amount) > 0)) return res.status(400).json({ error: 'Valor de pagamento inválido' });
  }

  try {
    const comandaResult = await pool.query(`SELECT * FROM comandas WHERE id = $1`, [req.params.id]);
    const comanda = comandaResult.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'aberta') return res.status(400).json({ error: 'Comanda já está fechada' });

    const paidTotal = payments.reduce((s, p) => s + parseFloat(p.amount), 0);
    if (Math.abs(paidTotal - parseFloat(comanda.total)) > 0.01) {
      return res.status(400).json({ error: `Soma dos pagamentos (${paidTotal.toFixed(2)}) não bate com o total (${parseFloat(comanda.total).toFixed(2)})` });
    }

    const summaryMethod = payments.length === 1 ? payments[0].method : 'misto';

    const updateResult = await pool.query(
      `UPDATE comandas SET status = 'fechada', payment_method = $1, closed_at = NOW(), closed_by = $2
       WHERE id = $3 RETURNING *`,
      [summaryMethod, req.user?.id || null, comanda.id]
    );
    const closedComanda = updateResult.rows[0];

    for (const p of payments) {
      await pool.query(
        `INSERT INTO comanda_payments (comanda_id, method, amount) VALUES ($1,$2,$3) RETURNING id`,
        [comanda.id, p.method, parseFloat(p.amount)]
      );
    }

    const items = await loadComandaItems(comanda.id);

    const caixaCfg = STATION_ROUTES.caixa;
    printOrderTicket(caixaCfg.printer, {
      stationName: caixaCfg.name,
      emoji: caixaCfg.emoji,
      fullReceipt: true,
      order: {
        id: closedComanda.id,
        customer_name: closedComanda.label || closedComanda.code,
        total_amount: closedComanda.total,
        payment_method: summaryMethod,
        notes: closedComanda.notes,
      },
      items,
    }).catch((e) => console.error('[print/comanda/close]', e.message));

    broadcastOrderUpdate({ event: 'comanda_closed', comanda: closedComanda });

    res.json({ ...closedComanda, items, payments });
  } catch (err) {
    console.error('[comandas/close]', err.message);
    res.status(500).json({ error: 'Erro ao fechar comanda' });
  }
});

// POST /api/comandas/:id/reopen — desfaz um fechamento feito por engano (admin only)
router.post('/:id/reopen', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const comandaResult = await pool.query(`SELECT * FROM comandas WHERE id = $1`, [req.params.id]);
    const comanda = comandaResult.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'fechada') return res.status(400).json({ error: 'Comanda não está fechada' });

    await pool.query(`DELETE FROM comanda_payments WHERE comanda_id = $1 RETURNING id`, [comanda.id]);

    const updateResult = await pool.query(
      `UPDATE comandas SET status = 'aberta', payment_method = NULL, closed_at = NULL, closed_by = NULL
       WHERE id = $1 RETURNING *`,
      [comanda.id]
    );

    const items = await loadComandaItems(comanda.id);
    res.json({ ...updateResult.rows[0], items });
  } catch (err) {
    console.error('[comandas/reopen]', err.message);
    res.status(500).json({ error: 'Erro ao reabrir comanda' });
  }
});

module.exports = router;
