const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware);

// Chaves aceitas — lista fixa pra ninguém gravar chave arbitrária pelo app.
const ALLOWED_KEYS = [
  'printer_ip', 'printer_port', 'printer_model', 'printer_copies',
  'printer_kitchen_ip', 'printer_kitchen_port', 'printer_kitchen_enabled',
  // Cor que marca a categoria selecionada no menu lateral da venda. Guarda a
  // CHAVE da opção ('verde', 'ambar'...), não o hex: assim o ajuste fino de
  // tom fica no front, num lugar só, sem precisar reescrever o que já está
  // gravado no banco.
  'cat_active_color',
  // Tamanho de letra por camada, num JSON só ({"menu":15,...}). Uma chave por
  // camada geraria uma linha nova no banco a cada camada futura; assim o
  // conjunto inteiro é gravado e lido de uma vez.
  'ui_font_sizes',
  // Layout da tela de venda (colunas, foto, espacamento, carrinho).
  'ui_layout',
  // Categorias do Financeiro liberadas pra escolher numa sangria, num JSON só
  // ([{"nome":"...","ativo":true}]) — lista própria do PDV, não sincronizada
  // ao vivo com a Gestão.
  'sangria_categories',
];

// GET /api/settings — todas as configurações (chave/valor)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`SELECT key, value FROM settings`);
    const cfg = {};
    for (const row of result.rows) cfg[row.key] = row.value;
    res.json(cfg);
  } catch (err) {
    return internalError(res, err, '[settings/GET]');
  }
});

// POST /api/settings — grava várias chaves de uma vez (admin/gerente)
router.post('/', requireRole('admin', 'gerente'), async (req, res) => {
  const entries = Object.entries(req.body || {}).filter(([k]) => ALLOWED_KEYS.includes(k));
  if (!entries.length) return res.status(400).json({ error: 'Nenhuma configuração válida enviada' });
  try {
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key`,
        [key, value === null || value === undefined ? '' : String(value)]
      );
    }
    res.json({ ok: true, saved: entries.map(([k]) => k) });
  } catch (err) {
    return internalError(res, err, '[settings/POST]');
  }
});

module.exports = router;
