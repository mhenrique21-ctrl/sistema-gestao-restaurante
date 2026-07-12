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
            ci.unit_price, ci.subtotal, ci.notes, ci.mesa, ci.created_at
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

// GET /api/comandas/pending-close — comandas abertas com pedido em andamento (equipe).
// Mostra toda comanda aberta que já tem itens lançados, não só as que o cliente
// pediu a conta — a equipe pode abrir e fechar qualquer uma a qualquer momento.
router.get('/pending-close', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.code, c.label, c.total, c.closing_requested_at, c.opened_at,
              (SELECT ci.mesa FROM comanda_items ci
               WHERE ci.comanda_id = c.id AND ci.mesa IS NOT NULL
               ORDER BY ci.created_at DESC LIMIT 1) AS mesa
       FROM comandas c WHERE c.status = 'aberta' AND c.total > 0
       ORDER BY COALESCE(c.closing_requested_at, c.opened_at) DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[comandas/pending-close]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/comandas/balcao — abre uma venda avulsa de balcão (equipe), sem cartão físico.
// Diferente do cadastro de cartão (admin only): qualquer atendente pode abrir, pra vender
// direto no balcão e fechar na hora, sem passar pela fila de fechamento.
router.post('/balcao', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
  try {
    const code = `balcao_${crypto.randomBytes(6).toString('hex')}`;
    const label = `Balcão ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const result = await pool.query(
      `INSERT INTO comandas (code, label, opened_by) VALUES ($1,$2,$3) RETURNING *`,
      [code, label, req.user.id]
    );
    res.status(201).json({ ...result.rows[0], items: [] });
  } catch (err) {
    console.error('[comandas/balcao]', err.message);
    res.status(500).json({ error: 'Erro ao abrir venda de balcão' });
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
    const result = await pool.query(
      `SELECT c.*, m.numero AS mesa_numero, m.area AS mesa_area
       FROM comandas c LEFT JOIN mesas m ON m.id = c.mesa_id
       WHERE c.code = $1`,
      [req.params.code.trim()]
    );
    const comanda = result.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });

    const items = await loadComandaItems(comanda.id);
    res.json({ ...comanda, items });
  } catch (err) {
    console.error('[comandas/resolve]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/comandas/:id/mesa — vincula a comanda a uma mesa cadastrada (equipe).
// Obrigatório pra qualquer comanda aberta por cartão físico antes de lançar pedido —
// só venda balcão (código começando com "balcao_") fica isenta.
router.patch('/:id/mesa', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'mesa_id é obrigatório' });
  try {
    const mesaResult = await pool.query(`SELECT id FROM mesas WHERE id = $1`, [mesa_id]);
    if (!mesaResult.rows[0]) return res.status(404).json({ error: 'Mesa não encontrada' });

    const result = await pool.query(
      `UPDATE comandas SET mesa_id = $1 WHERE id = $2 AND status = 'aberta' RETURNING *`,
      [mesa_id, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Comanda não encontrada ou não está aberta' });
    await pool.query(`UPDATE mesas SET status = 'ocupada' WHERE id = $1 AND status = 'livre' RETURNING id`, [mesa_id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[comandas/mesa]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/comandas/:id/orders — registra pedido na comanda (soma ao total corrente)
router.post('/:id/orders', async (req, res) => {
  const { items, notes, mesa } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Itens vazios' });

  try {
    let comandaResult = await pool.query(`SELECT * FROM comandas WHERE id = $1`, [req.params.id]);
    let comanda = comandaResult.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'aberta') return res.status(400).json({ error: 'Comanda não está aberta' });

    // O tablet (kiosk.html) fica fixo numa mesa e já manda o número dela — usa isso pra
    // vincular a comanda automaticamente, sem depender de um atendente fazer isso manualmente.
    if (!comanda.mesa_id && mesa) {
      const mesaResult = await pool.query(`SELECT id FROM mesas WHERE numero = $1`, [parseInt(mesa)]);
      if (mesaResult.rows[0]) {
        const updated = await pool.query(`UPDATE comandas SET mesa_id = $1 WHERE id = $2 RETURNING *`, [mesaResult.rows[0].id, comanda.id]);
        comanda = updated.rows[0];
      }
    }
    if (!comanda.mesa_id && !comanda.code.startsWith('balcao_')) {
      return res.status(400).json({ error: 'Selecione uma mesa antes de lançar pedidos nesta comanda' });
    }

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
        `INSERT INTO comanda_items (comanda_id, product_id, quantity, unit_price, subtotal, notes, added_by, mesa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [comanda.id, item.product_id, item.quantity, item.unit_price, item.subtotal, item.notes || null, req.user?.id || null, mesa || null]
      );
      await insertItemAddons(itemResult.rows[0].id, item.addons);
    }

    const updateResult = await pool.query(
      `UPDATE comandas SET subtotal = subtotal + $1, total = total + $1 WHERE id = $2 RETURNING *`,
      [addedTotal, comanda.id]
    );
    const updatedComanda = updateResult.rows[0];

    if (updatedComanda.mesa_id) {
      await pool.query(`UPDATE mesas SET status = 'ocupada' WHERE id = $1 AND status = 'livre' RETURNING id`, [updatedComanda.mesa_id]);
    }

    // Envia para cozinha/balcão em tempo real e imprime, reaproveitando o mesmo
    // pipeline usado em routes/orders.js (getStationsForOrder + printOrderTicket).
    const pseudoOrder = { id: comanda.id, customer_name: comanda.label || comanda.code, notes: notes || null, mesa: mesa || null };
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

// POST /api/comandas/:id/request-close — cliente pede a conta (pública, sem pagamento).
// Imprime o pré-fechamento no caixa; o garçom recebe o pagamento na mesa e informa o
// operador do caixa, que fecha de fato pelo comanda.html (POST /:id/close).
router.post('/:id/request-close', async (req, res) => {
  try {
    const comandaResult = await pool.query(`SELECT * FROM comandas WHERE id = $1`, [req.params.id]);
    const comanda = comandaResult.rows[0];
    if (!comanda) return res.status(404).json({ error: 'Comanda não encontrada' });
    if (comanda.status !== 'aberta') return res.status(400).json({ error: 'Comanda não está aberta' });

    const updateResult = await pool.query(
      `UPDATE comandas SET closing_requested_at = NOW() WHERE id = $1 RETURNING *`,
      [comanda.id]
    );
    const updatedComanda = updateResult.rows[0];
    const items = await loadComandaItems(comanda.id);
    const lastMesa = [...items].reverse().find((i) => i.mesa)?.mesa || null;

    const caixaCfg = STATION_ROUTES.caixa;
    printOrderTicket(caixaCfg.printer, {
      stationName: caixaCfg.name,
      emoji: caixaCfg.emoji,
      fullReceipt: true,
      order: {
        id: updatedComanda.id,
        customer_name: `PRÉ-FECHAMENTO — ${updatedComanda.label || updatedComanda.code}`,
        total_amount: updatedComanda.total,
        notes: 'Cliente solicitou a conta. Garçom vai receber o pagamento na mesa.',
        mesa: lastMesa,
      },
      items,
    }).catch((e) => console.error('[print/comanda/request-close]', e.message));

    broadcastOrderUpdate({ event: 'comanda_closing_requested', comanda: updatedComanda });

    res.json({ ok: true });
  } catch (err) {
    console.error('[comandas/request-close]', err.message);
    res.status(500).json({ error: 'Erro ao solicitar fechamento' });
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

// POST /api/comandas/:id/close — fecha a conta (uma ou mais formas de pagamento). Feito
// pelo operador do caixa (comanda.html), depois de receber o pagamento na mesa via garçom —
// não é mais chamado pelo cliente direto (kiosk.html só solicita, via /request-close).
router.post('/:id/close', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
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
    const originalCode = comanda.code;
    // Arquiva o código original nesta linha (fechada, histórico preservado) e libera o
    // código de verdade numa comanda nova — o mesmo cartão físico já fica pronto pro
    // próximo cliente, sem precisar de cadastro manual no admin.
    const archivedCode = `${originalCode}__closed_${Date.now()}`;

    const updateResult = await pool.query(
      `UPDATE comandas SET status = 'fechada', payment_method = $1, closed_at = NOW(), closed_by = $2, code = $3
       WHERE id = $4 RETURNING *`,
      [summaryMethod, req.user?.id || null, archivedCode, comanda.id]
    );
    const closedComanda = { ...updateResult.rows[0], code: originalCode };

    await pool.query(
      `INSERT INTO comandas (code, label, opened_by) VALUES ($1,$2,$3) RETURNING id`,
      [originalCode, comanda.label, req.user?.id || null]
    );

    // Libera a mesa se essa era a última comanda aberta vinculada a ela.
    if (comanda.mesa_id) {
      const outrasAbertas = await pool.query(
        `SELECT id FROM comandas WHERE mesa_id = $1 AND status = 'aberta'`,
        [comanda.mesa_id]
      );
      if (!outrasAbertas.rows.length) {
        await pool.query(`UPDATE mesas SET status = 'livre' WHERE id = $1 AND status = 'ocupada' RETURNING id`, [comanda.mesa_id]);
      }
    }

    for (const p of payments) {
      await pool.query(
        `INSERT INTO comanda_payments (comanda_id, method, amount) VALUES ($1,$2,$3) RETURNING id`,
        [comanda.id, p.method, parseFloat(p.amount)]
      );
    }

    const items = await loadComandaItems(comanda.id);
    const lastMesa = [...items].reverse().find((i) => i.mesa)?.mesa || null;

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
        mesa: lastMesa,
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

    // O código original pode ter sido reciclado pro próximo cliente ao fechar (ver
    // POST /:id/close). Se ninguém usou o cartão ainda, desfaz o reciclo; se já tem
    // gente usando, não dá pra reabrir sem confundir o atendimento em andamento.
    const archivedMatch = comanda.code.match(/^(.*)__closed_\d+$/);
    let restoredCode = comanda.code;
    if (archivedMatch) {
      const originalCode = archivedMatch[1];
      const recycledResult = await pool.query(`SELECT * FROM comandas WHERE code = $1`, [originalCode]);
      const recycled = recycledResult.rows[0];
      if (recycled) {
        const hasActivity = parseFloat(recycled.total) > 0 || recycled.status !== 'aberta';
        if (hasActivity) {
          return res.status(400).json({ error: 'Não é possível reabrir: esse cartão já foi reutilizado por outro cliente.' });
        }
        await pool.query(`DELETE FROM comandas WHERE id = $1 RETURNING id`, [recycled.id]);
        restoredCode = originalCode;
      }
    }

    await pool.query(`DELETE FROM comanda_payments WHERE comanda_id = $1 RETURNING id`, [comanda.id]);

    const updateResult = await pool.query(
      `UPDATE comandas SET status = 'aberta', payment_method = NULL, closed_at = NULL, closed_by = NULL, code = $1
       WHERE id = $2 RETURNING *`,
      [restoredCode, comanda.id]
    );

    const items = await loadComandaItems(comanda.id);
    res.json({ ...updateResult.rows[0], items });
  } catch (err) {
    console.error('[comandas/reopen]', err.message);
    res.status(500).json({ error: 'Erro ao reabrir comanda' });
  }
});

module.exports = router;
