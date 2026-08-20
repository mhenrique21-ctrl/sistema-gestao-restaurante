const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { getCashSummary, todayBelem } = require('../services/cashSummary');

router.use(authMiddleware, requireRole('admin', 'atendente'));

// GET /api/cash-movements?date=YYYY-MM-DD — abertura/sangrias/suprimentos + vendas (PDV+Delivery) do dia (padrão: hoje)
router.get('/', async (req, res) => {
  const date = req.query.date || todayBelem();
  try {
    const summary = await getCashSummary(date);
    res.json(summary);
  } catch (err) {
    console.error('[cash-movements/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar movimentações' });
  }
});

// POST /api/cash-movements — registrar abertura (fundo de caixa), sangria ou suprimento.
// "breakdown" (opcional, só faz sentido em type=abertura) guarda a composição do valor
// inicial por forma de pagamento: { dinheiro: {qtd, valor}, cartao_debito: {...}, ... }.
router.post('/', async (req, res) => {
  const { type, amount, reason, breakdown } = req.body;
  if (!['sangria', 'suprimento', 'abertura'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  if (!(parseFloat(amount) > 0)) {
    return res.status(400).json({ error: 'Valor inválido' });
  }
  try {
    if (type === 'abertura') {
      const today = todayBelem();
      const existing = await pool.query(
        `SELECT id FROM cash_movements WHERE type = 'abertura' AND DATE(created_at AT TIME ZONE 'America/Belem') = $1`,
        [today]
      );
      if (existing.rows.length) {
        return res.status(400).json({ error: 'Já existe uma abertura de caixa registrada hoje' });
      }
    }
    // O pool.query deste projeto faz substituição de string, não parametrização real —
    // um objeto JS vira "[object Object]" se passado direto. Precisa serializar antes.
    const breakdownJson = breakdown && typeof breakdown === 'object' ? JSON.stringify(breakdown) : null;
    const result = await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by, breakdown) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [type, parseFloat(amount), reason || null, req.user?.id || null, breakdownJson]
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
