const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Chaves conhecidas expostas publicamente (nada sensível)
const PUBLIC_KEYS = ['store_whatsapp_number', 'pix_key', 'store_name', 'banner_image_url', 'logo_url', 'primary_color'];

const PUBLIC_KEYS_PLACEHOLDERS = PUBLIC_KEYS.map((_, i) => `$${i + 1}`).join(',');

// GET /api/settings — configurações da loja (público, usado no checkout/WhatsApp)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM settings WHERE key IN (${PUBLIC_KEYS_PLACEHOLDERS})`,
      PUBLIC_KEYS
    );
    const settings = {};
    for (const key of PUBLIC_KEYS) settings[key] = '';
    for (const row of result.rows) settings[row.key] = row.value || '';
    res.json(settings);
  } catch (err) {
    console.error('[settings/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// PATCH /api/settings — atualizar uma ou mais configurações (admin)
router.patch('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const entries = Object.entries(req.body).filter(([key]) => PUBLIC_KEYS.includes(key));
  if (!entries.length) return res.status(400).json({ error: 'Nenhuma configuração válida enviada' });

  try {
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
         RETURNING key`,
        [key, value === null || value === undefined ? '' : String(value)]
      );
    }
    const result = await pool.query(`SELECT key, value FROM settings WHERE key IN (${PUBLIC_KEYS_PLACEHOLDERS})`, PUBLIC_KEYS);
    const settings = {};
    for (const row of result.rows) settings[row.key] = row.value || '';
    res.json(settings);
  } catch (err) {
    console.error('[settings/PATCH]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
