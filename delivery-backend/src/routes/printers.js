const router = require('express').Router();
const { exec } = require('child_process');
const { authMiddleware, requireRole } = require('../middleware/auth');

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

module.exports = router;
