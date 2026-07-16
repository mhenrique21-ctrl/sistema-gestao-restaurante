const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// Workaround do bug do driver pg no VPS: arrays JS viram CSV em vez de array
// Postgres quando passados como parâmetro $N — precisa inlinar como literal.
function toPgTextArray(arr) {
  const items = arr.map(s => String(s).trim()).filter(Boolean);
  const escaped = items.map(s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
  return `'{${escaped.join(',')}}'::text[]`;
}

// GET /api/templates
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM templates ORDER BY created_at');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/templates
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, items, active_days } = req.body;
  if (!name || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'name e items são obrigatórios' });
  const daysArr = Array.isArray(active_days) && active_days.length > 0 ? active_days.map(Number) : null;
  const daysSql = daysArr ? `'{${daysArr.join(',')}}'::int[]` : 'NULL';
  const itemsSql = toPgTextArray(items);
  try {
    const r = await pool.query(
      `INSERT INTO templates (name, items, active_days) VALUES ($1, ${itemsSql}, ${daysSql}) RETURNING *`,
      [name.trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/templates/:id
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const { name, items, active_days } = req.body;
  const daysArr = Array.isArray(active_days) && active_days.length > 0 ? active_days.map(Number) : null;
  const daysSql = daysArr ? `'{${daysArr.join(',')}}'::int[]` : 'NULL';
  const itemsSql = toPgTextArray(items || []);
  try {
    const r = await pool.query(
      `UPDATE templates SET name=$1, items=${itemsSql}, active_days=${daysSql} WHERE id=$2 RETURNING *`,
      [name.trim(), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Template não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/templates/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM templates WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
