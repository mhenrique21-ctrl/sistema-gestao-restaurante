const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('admin', 'atendente'));

// GET /api/cash-movements?date=YYYY-MM-DD — abertura/sangrias/suprimentos do dia (padrão: hoje)
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const result = await pool.query(
      `SELECT cm.id, cm.type, cm.amount, cm.reason, cm.created_at,
              u.name AS created_by_name
       FROM cash_movements cm
       LEFT JOIN users u ON u.id = cm.created_by
       WHERE DATE(cm.created_at AT TIME ZONE 'America/Belem') = $1
       ORDER BY cm.created_at ASC`,
      [date]
    );
    const abertura = result.rows.filter((r) => r.type === 'abertura').reduce((s, r) => s + parseFloat(r.amount), 0);
    const sangrias = result.rows.filter((r) => r.type === 'sangria').reduce((s, r) => s + parseFloat(r.amount), 0);
    const suprimentos = result.rows.filter((r) => r.type === 'suprimento').reduce((s, r) => s + parseFloat(r.amount), 0);
    const saldo = abertura + suprimentos - sangrias;
    res.json({
      date,
      movements: [...result.rows].reverse(),
      totals: { abertura, sangrias, suprimentos, saldo },
    });
  } catch (err) {
    console.error('[cash-movements/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar movimentações' });
  }
});

// POST /api/cash-movements — registrar abertura (fundo de caixa), sangria ou suprimento
router.post('/', async (req, res) => {
  const { type, amount, reason } = req.body;
  if (!['sangria', 'suprimento', 'abertura'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  if (!(parseFloat(amount) > 0)) {
    return res.status(400).json({ error: 'Valor inválido' });
  }
  try {
    if (type === 'abertura') {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await pool.query(
        `SELECT id FROM cash_movements WHERE type = 'abertura' AND DATE(created_at AT TIME ZONE 'America/Belem') = $1`,
        [today]
      );
      if (existing.rows.length) {
        return res.status(400).json({ error: 'Já existe uma abertura de caixa registrada hoje' });
      }
    }
    const result = await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, parseFloat(amount), reason || null, req.user?.id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[cash-movements/POST]', err.message);
    res.status(500).json({ error: 'Erro ao registrar movimentação' });
  }
});

// DELETE /api/cash-movements/:id — estornar um lançamento incorreto (admin)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM cash_movements WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Movimentação não encontrada' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[cash-movements/DELETE]', err.message);
    res.status(500).json({ error: 'Erro ao excluir movimentação' });
  }
});

module.exports = router;
