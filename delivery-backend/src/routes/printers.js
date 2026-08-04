const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastToStation, requestPrinterList } = require('../websocket/hub');
const pool = require('../db/pool');
const { internalError } = require('../utils/errors');
const { getCashSummary, todayBelem, getSessionSummary } = require('../services/cashSummary');

const PRINTER_KEYS = ['printer_caixa', 'printer_cozinha', 'printer_balcao'];

router.use(authMiddleware);

// GET /api/printers — pede ao agente local (Windows, conectado via WS) a lista de impressoras instaladas
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const printers = await requestPrinterList();
    res.json({ printers });
  } catch (e) {
    console.error('[printers/GET]', e.message);
    res.json({ printers: [], error: 'Não foi possível consultar as impressoras' });
  }
});

// GET /api/printers/config — lê config de impressoras salva no banco
router.get('/config', requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT key, value FROM settings WHERE key = ANY($1)`, [PRINTER_KEYS]);
    const cfg = {};
    for (const row of r.rows) cfg[row.key] = row.value;
    res.json(cfg);
  } catch (e) {
    return internalError(res, e, '[printers/config GET]');
  }
});

// POST /api/printers/config — salva config de impressoras no banco
router.post('/config', requireRole('admin'), async (req, res) => {
  const { printer_caixa, printer_cozinha, printer_balcao } = req.body;
  const entries = [
    ['printer_caixa', printer_caixa || ''],
    ['printer_cozinha', printer_cozinha || ''],
    ['printer_balcao', printer_balcao || ''],
  ];
  try {
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key`,
        [key, value]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    return internalError(res, e, '[printers/config POST]');
  }
});

// POST /api/printers/print-report — envia relatório financeiro para impressão térmica via agente
router.post('/print-report', requireRole('admin'), (req, res) => {
  const { date, report } = req.body;
  if (!report) return res.status(400).json({ error: 'Dados do relatório ausentes' });

  broadcastToStation('caixa', { event: 'print_report', date, report });
  res.json({ ok: true });
});

// POST /api/printers/reprint-order/:id — reimprime o cupom de venda do caixa (mesmo formato da impressão automática)
router.post('/reprint-order/:id', requireRole('admin'), async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });

    const items = await pool.query(
      `SELECT oi.*, p.name AS product_name
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

    if (!items.rows.length) return res.status(400).json({ error: 'Pedido sem itens' });

    broadcastToStation('caixa', { event: 'reprint_order', order: order.rows[0], items: items.rows });
    res.json({ ok: true });
  } catch (e) {
    return internalError(res, e, '[printers/reprint-order]');
  }
});

// POST /api/printers/finalize-order/:id — imprime recibo de conferência (resumo + valor) e marca o pedido como finalizado
router.post('/finalize-order/:id', requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE orders SET finalized_at = NOW() WHERE id = $1
       RETURNING order_number, payment_method, subtotal, delivery_fee, discount, total, created_at,
         (SELECT name FROM customers c WHERE c.id = orders.customer_id) AS customer_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });
    broadcastToStation('caixa', { event: 'finalize_order', order: r.rows[0] });
    res.json({ ok: true });
  } catch (e) {
    return internalError(res, e, '[printers/finalize-order]');
  }
});

// POST /api/printers/close-register — imprime fechamento de caixa (fundo/sangria/suprimento/saldo
// + vendas por comanda/balcão/delivery e forma de pagamento, mesmo resumo da aba Caixa)
router.post('/close-register', requireRole('admin', 'atendente'), async (req, res) => {
  const date = req.body.date || todayBelem();
  try {
    let summary;
    // Com session_id, imprime o TURNO (com contado/esperado/diferença). Sem ele,
    // mantém a impressão por data de antes, pra não quebrar quem ainda chamar
    // do jeito antigo.
    if (req.body.session_id) {
      const s = await pool.query(`SELECT * FROM cash_sessions WHERE id = $1`, [req.body.session_id]);
      if (!s.rows[0]) return res.status(404).json({ error: 'Turno não encontrado' });
      const sess = s.rows[0];
      const resumo = await getSessionSummary(sess);
      summary = {
        date: (sess.closed_at || sess.opened_at),
        session: sess,
        movements: resumo.movements,
        totals: { ...resumo.totals, saldo: resumo.expected },
        sales: resumo.sales,
        expected: resumo.expected,
        counted: sess.counted_amount != null ? parseFloat(sess.counted_amount) : null,
        difference: sess.difference != null ? parseFloat(sess.difference) : null,
      };
    } else {
      summary = await getCashSummary(date);
    }
    summary.operatorName = req.user?.name || null;
    broadcastToStation('caixa', { event: 'close_register', summary });
    res.json({ ok: true, summary });
  } catch (e) {
    return internalError(res, e, '[printers/close-register]');
  }
});

module.exports = router;
