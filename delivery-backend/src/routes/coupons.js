const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

// POST /api/coupons/validate — valida e aplica cupom (público, usado no checkout)
router.post('/validate', async (req, res) => {
  const { code, subtotal = 0, delivery_fee = 0 } = req.body;
  if (!code) return res.status(400).json({ error: 'Informe o cupom' });

  try {
    const result = await pool.query(
      `SELECT * FROM coupons WHERE code = $1 AND active = true`,
      [code.trim().toUpperCase()]
    );
    const coupon = result.rows[0];
    if (!coupon) return res.status(404).json({ error: 'Cupom inválido ou expirado' });
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
      return res.status(400).json({ error: 'Cupom expirado' });
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses)
      return res.status(400).json({ error: 'Cupom esgotado' });
    if (parseFloat(subtotal) < parseFloat(coupon.min_order_value))
      return res.status(400).json({ error: `Pedido mínimo de R$ ${parseFloat(coupon.min_order_value).toFixed(2).replace('.', ',')} para este cupom` });

    let discount = 0;
    if (coupon.discount_type === 'percent')
      discount = parseFloat(subtotal) * (parseFloat(coupon.discount_value) / 100);
    else if (coupon.discount_type === 'fixed')
      discount = parseFloat(coupon.discount_value);
    else if (coupon.discount_type === 'free_delivery')
      discount = parseFloat(delivery_fee);

    discount = Math.min(discount, parseFloat(subtotal) + parseFloat(delivery_fee));

    res.json({
      valid: true,
      coupon: { id: coupon.id, code: coupon.code, description: coupon.description, discount_type: coupon.discount_type, discount_value: parseFloat(coupon.discount_value) },
      discount: Math.round(discount * 100) / 100,
    });
  } catch (err) {
    console.error('[coupons/validate]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/coupons/use — incrementa uso (chamado após pedido criado com cupom)
router.post('/use', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ ok: true });
  try {
    await pool.query(`UPDATE coupons SET uses_count = uses_count + 1 WHERE code = $1`, [code.toUpperCase()]);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true });
  }
});

// ── Admin ───────────────────────────────────────────────────────────────────

// GET /api/coupons — listar cupons (admin)
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM coupons ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/coupons — criar cupom
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { code, description, discount_type, discount_value, min_order_value, max_uses, max_uses_per_customer, allowed_categories, expires_at } = req.body;
  if (!code || !discount_type) return res.status(400).json({ error: 'Código e tipo são obrigatórios' });
  const catsArr = Array.isArray(allowed_categories) ? allowed_categories : (typeof allowed_categories === 'string' ? allowed_categories.split(',').filter(Boolean) : []);
  const cats = catsArr.length ? `{${catsArr.map(c => `"${c}"`).join(',')}}` : null;
  try {
    const result = await pool.query(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, max_uses, max_uses_per_customer, allowed_categories, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code.trim().toUpperCase(), description || '', discount_type, discount_value || 0,
       min_order_value || 0, max_uses || null, max_uses_per_customer || null, cats, expires_at || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Código já existe' });
    console.error('[coupons/POST]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/coupons/:id
router.patch('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const b = req.body;
  // Se vier conjunto completo de campos (edição via modal), usa query estática para evitar bug $10+ no pg
  if (b.code !== undefined && b.discount_type !== undefined) {
    try {
      const catsArr = Array.isArray(b.allowed_categories) ? b.allowed_categories : (typeof b.allowed_categories === 'string' ? b.allowed_categories.split(',').filter(Boolean) : []);
      const cats = catsArr.length ? `{${catsArr.map(c => `"${c}"`).join(',')}}` : null;
      // expires_at vem do input date (YYYY-MM-DD) — seguro interpolar diretamente para evitar bug $10+
      const expiresSQL = b.expires_at ? `'${b.expires_at.replace(/[^0-9\-]/g, '')}'::date` : 'NULL';
      const result = await pool.query(
        `UPDATE coupons SET code=$1, description=$2, discount_type=$3, discount_value=$4,
         min_order_value=$5, max_uses=$6, max_uses_per_customer=$7, allowed_categories=$8,
         expires_at=${expiresSQL} WHERE id=$9 RETURNING *`,
        [
          b.code.trim().toUpperCase(), b.description || '',
          b.discount_type, b.discount_value || 0,
          b.min_order_value || 0, b.max_uses || null,
          b.max_uses_per_customer || null, cats,
          req.params.id
        ]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Cupom não encontrado' });
      return res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Código já existe' });
      return internalError(res, err, '[coupons/PATCH]');
    }
  }
  // Atualização parcial (ex: toggle active)
  const fields = ['active', 'code', 'description', 'discount_type', 'discount_value', 'min_order_value', 'max_uses', 'expires_at'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (b[f] !== undefined) {
      updates.push(`${f} = $${idx++}`);
      values.push(f === 'code' ? b[f].trim().toUpperCase() : b[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE coupons SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cupom não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[coupons/PATCH partial]');
  }
});

// DELETE /api/coupons/:id
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM coupons WHERE id = $1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
