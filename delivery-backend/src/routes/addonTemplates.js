const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// Mesmo motivo do templates.js: parâmetros $N não lidam bem com tipos
// compostos (array/jsonb) nesse wrapper de pool — inlinar como literal.
function toPgJsonb(obj) {
  return "'" + JSON.stringify(obj).replace(/'/g, "''") + "'::jsonb";
}

// GET /api/addon-templates — todos (admin vê ativos e inativos; a tela de
// Adicionais do produto filtra active=true no próprio front)
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM addon_templates ORDER BY sort_order, name');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/addon-templates
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, min_select = 0, max_select = 1, required = false, options = [], sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const optionsSql = toPgJsonb(options);
  try {
    const r = await pool.query(
      `INSERT INTO addon_templates (name, min_select, max_select, required, options, sort_order)
       VALUES ($1, $2, $3, $4, ${optionsSql}, $5) RETURNING *`,
      [name.trim(), min_select, max_select, required, sort_order]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/addon-templates/:id — inclui alternar active
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const { name, min_select, max_select, required, options, active, sort_order } = req.body;
  const updates = [], values = [];
  let idx = 1;
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
  if (min_select !== undefined) { updates.push(`min_select = $${idx++}`); values.push(min_select); }
  if (max_select !== undefined) { updates.push(`max_select = $${idx++}`); values.push(max_select); }
  if (required !== undefined) { updates.push(`required = $${idx++}`); values.push(required); }
  if (active !== undefined) { updates.push(`active = $${idx++}`); values.push(active); }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }
  if (options !== undefined) { updates.push(`options = ${toPgJsonb(options)}`); }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE addon_templates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Modelo não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/addon-templates/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM addon_templates WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
