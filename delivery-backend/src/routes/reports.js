const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('admin'));

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    // Resumo por forma de pagamento
    const byPayment = await pool.query(`
      SELECT
        COALESCE(payment_method, 'Não informado') AS payment_method,
        COUNT(*) AS qty,
        SUM(total) AS total,
        SUM(COALESCE(discount, 0)) AS discount,
        SUM(COALESCE(delivery_fee, 0)) AS delivery_fee,
        SUM(subtotal) AS subtotal
      FROM orders
      WHERE DATE(created_at AT TIME ZONE 'America/Belem') = $1
        AND status NOT IN ('cancelado')
      GROUP BY payment_method
      ORDER BY total DESC
    `, [date]);

    // Resumo por status
    const byStatus = await pool.query(`
      SELECT
        status,
        COUNT(*) AS qty,
        SUM(total) AS total
      FROM orders
      WHERE DATE(created_at AT TIME ZONE 'America/Belem') = $1
      GROUP BY status
      ORDER BY status
    `, [date]);

    // Totais gerais
    const totals = await pool.query(`
      SELECT
        COUNT(*) AS total_pedidos,
        SUM(CASE WHEN status != 'cancelado' THEN total ELSE 0 END) AS receita,
        SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS cancelados,
        SUM(COALESCE(discount, 0)) AS total_descontos,
        SUM(COALESCE(delivery_fee, 0)) AS total_entregas
      FROM orders
      WHERE DATE(created_at AT TIME ZONE 'America/Belem') = $1
    `, [date]);

    // Lista de pedidos do dia
    const orders = await pool.query(`
      SELECT
        order_number, status, payment_method, delivery_type,
        subtotal, delivery_fee, discount, total, created_at,
        (SELECT name FROM customers c WHERE c.id = orders.customer_id) AS customer_name
      FROM orders
      WHERE DATE(created_at AT TIME ZONE 'America/Belem') = $1
      ORDER BY created_at
    `, [date]);

    res.json({
      date,
      by_payment: byPayment.rows,
      by_status: byStatus.rows,
      totals: totals.rows[0],
      orders: orders.rows,
    });
  } catch (err) {
    console.error('[reports/daily]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
