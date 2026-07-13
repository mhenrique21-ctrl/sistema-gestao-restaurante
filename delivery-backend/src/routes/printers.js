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

module.exports = router;
