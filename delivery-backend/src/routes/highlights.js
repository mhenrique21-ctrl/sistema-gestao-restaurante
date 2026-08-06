const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

// GET /api/highlights — usado pelo autoatendimento, SEM login: o totem não
// tem sessão de operador. Só devolve o que está ativo, e nada sensível.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT h.id, h.title, h.subtitle, h.image_url, h.price_label, h.product_id,
              p.name AS product_name, p.price AS product_price, p.image_url AS product_image
         FROM kiosk_highlights h
         LEFT JOIN products p ON p.id = h.product_id
        WHERE h.active = true
        ORDER BY h.sort_order, h.created_at`
    );
    res.set('Cache-Control', 'public, max-age=30');
    res.json(r.rows.map((h) => ({
      id: h.id,
      title: h.title,
      subtitle: h.subtitle,
      // Imagem própria vence a do produto: o destaque pode ter uma arte feita
      // pra tela cheia, enquanto a foto do produto é de catálogo.
      image_url: h.image_url || h.product_image || null,
      price_label: h.price_label || (h.product_price != null ? `R$ ${parseFloat(h.product_price).toFixed(2).replace('.', ',')}` : null),
      product_id: h.product_id,
      product_name: h.product_name,
    })));
  } catch (err) {
    return internalError(res, err, '[highlights/GET]');
  }
});

// Daqui pra baixo é edição: exige login de admin.
router.use(authMiddleware, requireRole('admin'));

// GET /api/highlights/admin — inclui os desativados, pra tela de edição.
router.get('/admin', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT h.*, p.name AS product_name, p.image_url AS product_image
         FROM kiosk_highlights h LEFT JOIN products p ON p.id = h.product_id
        ORDER BY h.sort_order, h.created_at`
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[highlights/admin]');
  }
});

router.post('/', async (req, res) => {
  const { title, subtitle, image_url, price_label, product_id } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Informe o título' });
  try {
    const r = await pool.query(
      `INSERT INTO kiosk_highlights (title, subtitle, image_url, price_label, product_id, sort_order)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(sort_order) + 1 FROM kiosk_highlights), 0))
       RETURNING *`,
      [String(title).trim(), subtitle || null, image_url || null, price_label || null, product_id || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[highlights/POST]');
  }
});

router.patch('/:id', async (req, res) => {
  const updates = [];
  const values = [];
  let idx = 1;
  for (const campo of ['title', 'subtitle', 'image_url', 'price_label']) {
    if (req.body[campo] !== undefined) {
      updates.push(`${campo} = $${idx++}`);
      values.push(req.body[campo] === '' ? null : req.body[campo]);
    }
  }
  if (req.body.product_id !== undefined) {
    updates.push(`product_id = $${idx++}`);
    values.push(req.body.product_id || null);
  }
  if (req.body.sort_order !== undefined) updates.push(`sort_order = ${parseInt(req.body.sort_order, 10) || 0}`);
  // Booleano como literal: o wrapper do pool substitui $N por string e quebra
  // a partir de $10.
  if (req.body.active !== undefined) updates.push(`active = ${req.body.active ? 'TRUE' : 'FALSE'}`);
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });

  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE kiosk_highlights SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Destaque não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[highlights/PATCH]');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM kiosk_highlights WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Destaque não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[highlights/DELETE]');
  }
});

module.exports = router;
