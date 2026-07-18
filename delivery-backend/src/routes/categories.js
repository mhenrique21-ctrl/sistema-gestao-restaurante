const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM categories ORDER BY sort_order, name');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/categories
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, description, sort_order, image_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const r = await pool.query(
      'INSERT INTO categories (name, description, sort_order, image_url) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, description, sort_order || 0, image_url]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Categoria já existe' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/categories/:id/products — todos os produtos (admin)
router.get('/:id/products', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, c.name AS category_name FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.category_id = $1 ORDER BY p.sort_order, p.name`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/categories/:id
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const fields = ['name', 'description', 'sort_order', 'image_url', 'active', 'printer'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/categories/:id/apply-printer — aplica impressora a todos os produtos da categoria
router.post('/:id/apply-printer', requireRole('admin'), async (req, res) => {
  const { printer } = req.body;
  const target = ['cozinha', 'balcao'].includes(printer) ? printer : null;
  const targetSql = target ? `'${target}'` : 'NULL';
  try {
    const r = await pool.query(
      `UPDATE products SET print_target = ${targetSql} WHERE category_id = $1 RETURNING id`,
      [req.params.id]
    );
    res.json({ updated: r.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/categories/:id/apply-template-days — aplica active_days de um template a todos os produtos da categoria
router.post('/:id/apply-template-days', requireRole('admin'), async (req, res) => {
  const { active_days } = req.body;
  const daysArr = Array.isArray(active_days) && active_days.length > 0 ? active_days.map(Number) : null;
  const daysSql = daysArr ? `'{${daysArr.join(',')}}'::int[]` : 'NULL';
  try {
    const r = await pool.query(
      `UPDATE products SET active_days = ${daysSql} WHERE category_id = $1 RETURNING id`,
      [req.params.id]
    );
    res.json({ updated: r.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
