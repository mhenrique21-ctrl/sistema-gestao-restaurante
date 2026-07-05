const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/neighborhoods — bairros ativos, agrupados por zona (público, usado no checkout)
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.all === 'true';
    const [neighborhoodsResult, settingsResult] = await Promise.all([
      pool.query(
        includeInactive
          ? `SELECT * FROM neighborhoods ORDER BY zone, sort_order, name`
          : `SELECT * FROM neighborhoods WHERE active = true ORDER BY zone, sort_order, name`
      ),
      pool.query(`SELECT value FROM settings WHERE key = 'free_delivery'`),
    ]);
    const freeDelivery = settingsResult.rows[0]?.value === 'true';
    res.json(neighborhoodsResult.rows.map((n) => ({
      ...n,
      delivery_fee: freeDelivery ? 0 : parseFloat(n.delivery_fee),
      free_delivery: freeDelivery,
    })));
  } catch (err) {
    console.error('[neighborhoods/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar bairros' });
  }
});

// POST /api/neighborhoods — criar bairro (admin)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { zone, name, delivery_fee, sort_order } = req.body;
  if (!name || delivery_fee === undefined) {
    return res.status(400).json({ error: 'name e delivery_fee são obrigatórios' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO neighborhoods (zone, name, delivery_fee, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [zone || 'GERAL', name, delivery_fee, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bairro já cadastrado' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/neighborhoods/:id — editar bairro (admin)
router.patch('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const fields = ['zone', 'name', 'delivery_fee', 'active', 'sort_order'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE neighborhoods SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Bairro não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bairro já cadastrado' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/neighborhoods/:id — remover bairro (admin)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM neighborhoods WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Bairro não encontrado' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
