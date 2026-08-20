const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('admin', 'atendente'));

// GET /api/dashboard — resumo do dia
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const [totals, byStatus, topProducts] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(total), 0) AS revenue,
          COALESCE(SUM(CASE WHEN payment_status='pago' THEN total ELSE 0 END), 0) AS paid_revenue,
          COUNT(CASE WHEN status='cancelado' THEN 1 END) AS cancelled
        FROM orders WHERE DATE(created_at) = $1
      `, [date]),

      pool.query(`
        SELECT status, COUNT(*) AS count
        FROM orders WHERE DATE(created_at) = $1
        GROUP BY status ORDER BY count DESC
      `, [date]),

      pool.query(`
        SELECT p.name, SUM(oi.quantity) AS qty_sold, SUM(oi.subtotal) AS revenue
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        WHERE DATE(o.created_at) = $1 AND o.status != 'cancelado'
        GROUP BY p.name ORDER BY qty_sold DESC LIMIT 5
      `, [date]),
    ]);

    res.json({
      date,
      summary: totals.rows[0],
      by_status: byStatus.rows,
      top_products: topProducts.rows,
    });
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
