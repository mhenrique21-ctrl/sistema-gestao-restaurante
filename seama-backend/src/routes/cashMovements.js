const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');
const { todayBelem } = require('../utils/date');

router.use(authMiddleware);

const SALE_METHODS = ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix', 'vale_alimentacao', 'vale_refeicao'];

// GET /api/cash-movements?date=YYYY-MM-DD — abertura/sangrias/suprimentos +
// vendas do dia por forma de pagamento (padrão: hoje, fuso de Belém)
router.get('/', async (req, res) => {
  const date = req.query.date || todayBelem();
  try {
    const movResult = await pool.query(
      `SELECT cm.id, cm.type, cm.amount, cm.reason, cm.created_at, u.username AS created_by_name
       FROM cash_movements cm
       LEFT JOIN users u ON u.id = cm.created_by
       WHERE DATE(cm.created_at AT TIME ZONE 'America/Belem') = $1
       ORDER BY cm.created_at ASC`,
      [date]
    );
    const abertura = movResult.rows.filter((r) => r.type === 'abertura').reduce((s, r) => s + parseFloat(r.amount), 0);
    const sangrias = movResult.rows.filter((r) => r.type === 'sangria').reduce((s, r) => s + parseFloat(r.amount), 0);
    const suprimentos = movResult.rows.filter((r) => r.type === 'suprimento').reduce((s, r) => s + parseFloat(r.amount), 0);

    const salesRows = await pool.query(
      `SELECT sp.method, COUNT(*) AS qty, COALESCE(SUM(sp.amount), 0) AS total
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE s.status = 'concluida' AND DATE(s.created_at AT TIME ZONE 'America/Belem') = $1
       GROUP BY sp.method`,
      [date]
    );

    const byMethod = {};
    for (const m of SALE_METHODS) byMethod[m] = { qty: 0, total: 0 };
    for (const row of salesRows.rows) {
      if (byMethod[row.method]) byMethod[row.method] = { qty: parseInt(row.qty, 10), total: parseFloat(row.total) };
    }
    const totalVendido = SALE_METHODS.reduce((s, m) => s + byMethod[m].total, 0);
    const dinheiro = byMethod.dinheiro.total;
    const saldo = abertura + suprimentos - sangrias + dinheiro;

    res.json({
      date,
      movements: [...movResult.rows].reverse(),
      totals: { abertura, sangrias, suprimentos, saldo },
      sales: { byMethod, totalVendido },
    });
  } catch (err) {
    return internalError(res, err, '[cash-movements/GET]');
  }
});

// POST /api/cash-movements — abertura (uma vez por dia), sangria ou suprimento
router.post('/', async (req, res) => {
  const { type, amount, reason } = req.body;
  if (!['sangria', 'suprimento', 'abertura'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  if (!(parseFloat(amount) > 0)) {
    return res.status(400).json({ error: 'Valor inválido' });
  }
  if (type === 'sangria' && !['gerente', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Só gerente ou admin pode registrar sangria' });
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
    const result = await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, parseFloat(amount), reason || null, req.user.id]
    );
    if (type === 'sangria') await logAction(req.user.id, 'sangria', { amount: parseFloat(amount), reason });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[cash-movements/POST]');
  }
});

module.exports = router;
