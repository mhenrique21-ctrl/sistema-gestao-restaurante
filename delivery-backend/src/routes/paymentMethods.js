const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET público — usado pelo checkout
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM payment_methods ORDER BY sort_order, id');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.use(authMiddleware, requireRole('admin'));

// POST — criar
router.post('/', async (req, res) => {
  const { name, description, requires_change, pix_key, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const r = await pool.query(
      'INSERT INTO payment_methods (name, description, requires_change, pix_key, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, description || null, requires_change || false, pix_key || null, sort_order || 0]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH — editar
router.patch('/:id', async (req, res) => {
  const fields = ['name', 'description', 'active', 'requires_change', 'pix_key', 'sort_order'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE payment_methods SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM payment_methods WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
