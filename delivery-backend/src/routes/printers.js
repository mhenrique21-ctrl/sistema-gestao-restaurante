const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastToStation, requestPrinterList } = require('../websocket/hub');
const pool = require('../db/pool');

const PRINTER_KEYS = ['printer_caixa', 'printer_cozinha', 'printer_balcao'];

router.use(authMiddleware);

// GET /api/printers — pede ao agente local (Windows, conectado via WS) a lista de impressoras instaladas
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const printers = await requestPrinterList();
    res.json({ printers });
  } catch (e) {
    res.json({ printers: [], error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// POST /api/printers/print-report — envia relatório financeiro para impressão térmica via agente
router.post('/print-report', requireRole('admin'), (req, res) => {
  const { date, report } = req.body;
  if (!report) return res.status(400).json({ error: 'Dados do relatório ausentes' });

  broadcastToStation('caixa', { event: 'print_report', date, report });
  res.json({ ok: true });
});

// POST /api/printers/finalize-order/:id — imprime recibo de conferência (resumo + valor) do pedido
router.post('/finalize-order/:id', requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT order_number, payment_method, subtotal, delivery_fee, discount, total, created_at,
              (SELECT name FROM customers c WHERE c.id = orders.customer_id) AS customer_name
       FROM orders WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });
    broadcastToStation('caixa', { event: 'finalize_order', order: r.rows[0] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/printers/close-register — imprime fechamento de caixa (totais do dia, sem lista de pedidos)
router.post('/close-register', requireRole('admin'), async (req, res) => {
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  try {
    const totals = await pool.query(
      `SELECT
         COUNT(*) AS total_pedidos,
         SUM(CASE WHEN status != 'cancelado' THEN total ELSE 0 END) AS receita,
         SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS cancelados,
         SUM(COALESCE(discount, 0)) AS total_descontos,
         SUM(COALESCE(delivery_fee, 0)) AS total_entregas
       FROM orders
       WHERE DATE(created_at AT TIME ZONE 'America/Belem') = $1`,
      [date]
    );
    const byPayment = await pool.query(
      `SELECT COALESCE(payment_method, 'Não informado') AS payment_method, COUNT(*) AS qty, SUM(total) AS total
       FROM orders
       WHERE DATE(created_at AT TIME ZONE 'America/Belem') = $1 AND status NOT IN ('cancelado')
       GROUP BY payment_method
       ORDER BY total DESC`,
      [date]
    );
    const summary = { date, totals: totals.rows[0], by_payment: byPayment.rows };
    broadcastToStation('caixa', { event: 'close_register', summary });
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
