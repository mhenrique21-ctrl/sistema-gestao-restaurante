const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/mesas — lista todas as mesas (equipe)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM mesas ORDER BY numero`);
    res.json(result.rows);
  } catch (err) {
    console.error('[mesas/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar mesas' });
  }
});

// POST /api/mesas — criar mesa (admin)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { numero, area, capacidade } = req.body;
  if (!numero || !['interna', 'externa'].includes(area)) {
    return res.status(400).json({ error: 'numero e area ("interna" ou "externa") são obrigatórios' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO mesas (numero, area, capacidade) VALUES ($1,$2,$3) RETURNING *`,
      [numero, area, capacidade || 4]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe uma mesa com esse número' });
    console.error('[mesas/POST]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/mesas/:id — editar mesa (admin ou atendente, ex: mudar status livre/ocupada)
router.patch('/:id', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
  const fields = ['numero', 'area', 'capacidade', 'status'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE mesas SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Mesa não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe uma mesa com esse número' });
    console.error('[mesas/PATCH]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/mesas/:id — remover mesa (admin)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM mesas WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Mesa não encontrada' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[mesas/DELETE]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
