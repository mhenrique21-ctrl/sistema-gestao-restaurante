const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware);

// GET /api/categories — todas (a tela de venda filtra active=true no front
// pra continuar respondendo rápido mesmo offline momentaneamente)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, icon, color, sort_order, active FROM categories ORDER BY sort_order, name`
    );
    res.json(result.rows);
  } catch (err) {
    return internalError(res, err, '[categories/GET]');
  }
});

router.post('/', requireRole('admin', 'gerente'), async (req, res) => {
  const { name, icon, color, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const result = await pool.query(
      `INSERT INTO categories (name, icon, color, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), icon || null, color || null, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[categories/POST]');
  }
});

router.patch('/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { name, icon, color, sort_order, active } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
  if (icon !== undefined) { updates.push(`icon = $${idx++}`); values.push(icon); }
  if (color !== undefined) { updates.push(`color = $${idx++}`); values.push(color); }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }
  if (active !== undefined) { updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`); }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo pra atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[categories/PATCH]');
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM categories WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json({ deleted: true });
  } catch (err) {
    return internalError(res, err, '[categories/DELETE]');
  }
});

module.exports = router;
