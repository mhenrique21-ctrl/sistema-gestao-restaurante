const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

const DAY_NAMES = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

// GET /api/promotions — lista promoções ativas (público, usado no checkout)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM promotions WHERE active = true ORDER BY created_at`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[promotions/GET]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/promotions/apply?subtotal=XX&delivery_fee=XX&zone=CENTRAL — calcula desconto aplicável agora
router.get('/apply', async (req, res) => {
  const subtotal = parseFloat(req.query.subtotal || 0);
  const deliveryFee = parseFloat(req.query.delivery_fee || 0);
  const zone = (req.query.zone || '').toUpperCase() || null;
  const nowDay = new Date().getDay();

  try {
    const result = await pool.query(`SELECT * FROM promotions WHERE active = true ORDER BY created_at`);
    let appliedPromo = null;
    let discount = 0;

    for (const promo of result.rows) {
      if (promo.day_of_week?.length && !promo.day_of_week.includes(nowDay)) continue;
      if (subtotal < parseFloat(promo.min_order_value)) continue;
      if (promo.zones?.length && zone && !promo.zones.includes(zone)) continue;

      let d = 0;
      if (promo.discount_type === 'free_delivery') d = deliveryFee;
      else if (promo.discount_type === 'percent') d = subtotal * (parseFloat(promo.discount_value) / 100);
      else if (promo.discount_type === 'fixed') d = parseFloat(promo.discount_value);

      if (d > discount) { discount = d; appliedPromo = promo; }
    }

    res.json({ applied: !!appliedPromo, promo: appliedPromo, discount: Math.round(discount * 100) / 100 });
  } catch (err) {
    console.error('[promotions/apply]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Admin (requer auth) ──────────────────────────────────────────────────────

// GET /api/promotions/all — todas incluindo inativas (admin)
router.get('/all', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM promotions ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/promotions — criar promoção
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, description, active, day_of_week, min_order_value, discount_type, discount_value } = req.body;
  if (!name || !discount_type) return res.status(400).json({ error: 'name e discount_type são obrigatórios' });
  try {
    const result = await pool.query(
      `INSERT INTO promotions (name, description, active, day_of_week, min_order_value, discount_type, discount_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description || '', active !== false, day_of_week || null, min_order_value || 0, discount_type, discount_value || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[promotions/POST]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/promotions/:id — editar promoção
router.patch('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const scalar = ['name', 'description', 'active', 'min_order_value', 'discount_type', 'discount_value'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of scalar) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  // Arrays: converter para literal PostgreSQL {val1,val2}
  if (req.body.day_of_week !== undefined) {
    const arr = req.body.day_of_week;
    updates.push(`day_of_week = $${idx++}`);
    values.push(arr === null ? null : (Array.isArray(arr) ? arr : [arr]));
  }
  if (req.body.zones !== undefined) {
    const arr = req.body.zones;
    updates.push(`zones = $${idx++}`);
    values.push(arr === null ? null : (Array.isArray(arr) ? arr : [arr]));
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE promotions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Promoção não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[promotions/PATCH]', err.message);
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

// DELETE /api/promotions/:id
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM promotions WHERE id = $1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
module.exports.DAY_NAMES = DAY_NAMES;
