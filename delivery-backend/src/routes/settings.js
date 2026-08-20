const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Chaves conhecidas expostas publicamente (nada sensível)
const PUBLIC_KEYS = ['store_whatsapp_number', 'pix_key', 'store_name', 'banner_image_url', 'logo_url', 'primary_color', 'business_hours', 'special_dates', 'free_delivery', 'kiosk_idle_seconds', 'min_order_delivery', 'store_closed_manual'];
const JSON_KEYS = ['business_hours', 'special_dates'];

// Lista fixa (definida no código, não vem de input do usuário) — interpolada direto na
// query em vez de $N porque o driver pg deste projeto não suporta $10 ou mais (ver memória
// "Bug pg driver VPS — parâmetros $10+"), e PUBLIC_KEYS já passou de 9 itens.
const PUBLIC_KEYS_SQL_LIST = PUBLIC_KEYS.map((k) => `'${k.replace(/'/g, "''")}'`).join(',');

// GET /api/settings — configurações da loja (público, usado no checkout/WhatsApp)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM settings WHERE key IN (${PUBLIC_KEYS_SQL_LIST})`
    );
    const settings = {};
    for (const key of PUBLIC_KEYS) settings[key] = JSON_KEYS.includes(key) ? null : '';
    for (const row of result.rows) {
      if (JSON_KEYS.includes(row.key)) {
        try { settings[row.key] = row.value ? JSON.parse(row.value) : null; } catch { settings[row.key] = null; }
      } else {
        settings[row.key] = row.value || '';
      }
    }
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
      const stored = JSON_KEYS.includes(key)
        ? (value == null ? '' : JSON.stringify(value))
        : (value === null || value === undefined ? '' : String(value));
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
         RETURNING key`,
        [key, stored]
      );
    }
    const result = await pool.query(`SELECT key, value FROM settings WHERE key IN (${PUBLIC_KEYS_SQL_LIST})`);
    const settings = {};
    for (const row of result.rows) settings[row.key] = row.value || '';
    res.json(settings);
  } catch (err) {
    console.error('[settings/PATCH]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/settings/sangria-categories — qualquer usuário autenticado (quem
// faz sangria no caixa precisa ler a lista, não só o admin que a edita).
router.get('/sangria-categories', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM settings WHERE key = 'sangria_categories'`);
    let categorias = [];
    try { categorias = JSON.parse(result.rows[0]?.value || '[]'); } catch { categorias = []; }
    res.json({ categorias: Array.isArray(categorias) ? categorias : [] });
  } catch (err) {
    console.error('[settings/sangria-categories/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar categorias' });
  }
});

// PUT /api/settings/sangria-categories — só admin
router.put('/sangria-categories', authMiddleware, requireRole('admin'), async (req, res) => {
  const { categorias } = req.body;
  if (!Array.isArray(categorias)) return res.status(400).json({ error: 'categorias deve ser uma lista' });
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('sangria_categories', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(categorias)]
    );
    res.json({ ok: true, categorias });
  } catch (err) {
    console.error('[settings/sangria-categories/PUT]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/settings/pdv-menu — aparência do menu lateral do PDV. Qualquer usuário
// autenticado lê (é ele quem carrega o próprio tablet), só admin edita.
router.get('/pdv-menu', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM settings WHERE key = 'pdv_menu_config'`);
    let config = {};
    try { config = JSON.parse(result.rows[0]?.value || '{}'); } catch { config = {}; }
    res.json({
      fontSize: config.fontSize || 'media',
      accentColor: config.accentColor || '#C9A25E',
      position: config.position || 'esquerda',
      displayMode: config.displayMode || 'completo',
      hiddenItems: Array.isArray(config.hiddenItems) ? config.hiddenItems : [],
    });
  } catch (err) {
    console.error('[settings/pdv-menu/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar configuração do menu' });
  }
});

// PUT /api/settings/pdv-menu — só admin
router.put('/pdv-menu', authMiddleware, requireRole('admin'), async (req, res) => {
  const { fontSize, accentColor, position, displayMode, hiddenItems } = req.body;
  if (!['pequena', 'media', 'grande'].includes(fontSize)) return res.status(400).json({ error: 'fontSize inválido' });
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor || '')) return res.status(400).json({ error: 'accentColor inválido' });
  if (!['esquerda', 'direita'].includes(position)) return res.status(400).json({ error: 'position inválido' });
  if (!['completo', 'compacto'].includes(displayMode)) return res.status(400).json({ error: 'displayMode inválido' });
  if (!Array.isArray(hiddenItems)) return res.status(400).json({ error: 'hiddenItems deve ser uma lista' });

  try {
    const config = { fontSize, accentColor, position, displayMode, hiddenItems };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('pdv_menu_config', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    res.json({ ok: true, ...config });
  } catch (err) {
    console.error('[settings/pdv-menu/PUT]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
