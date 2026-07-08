const router = require('express').Router();
const { exec } = require('child_process');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { broadcastToStation } = require('../websocket/hub');

router.use(authMiddleware);

// GET /api/printers — lista impressoras instaladas no servidor
router.get('/', requireRole('admin'), (req, res) => {
  const isWin = process.platform === 'win32';
  const cmd = isWin
    ? 'wmic printer get name /format:list'
    : "lpstat -a 2>/dev/null | awk '{print $1}' || echo ''";

  exec(cmd, { timeout: 5000 }, (err, stdout) => {
    if (err) return res.json({ printers: [] });

    let printers = [];
    if (isWin) {
      printers = stdout.split(/\r?\n/)
        .map(l => l.replace(/^Name=/, '').trim())
        .filter(l => l.length > 0);
    } else {
      printers = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    }

    res.json({ printers });
  });
});

// POST /api/printers/print-report — envia relatório financeiro para impressão térmica via agente
router.post('/print-report', requireRole('admin'), (req, res) => {
  const { date, report } = req.body;
  if (!report) return res.status(400).json({ error: 'Dados do relatório ausentes' });

  broadcastToStation('caixa', { event: 'print_report', date, report });
  res.json({ ok: true });
});

module.exports = router;
