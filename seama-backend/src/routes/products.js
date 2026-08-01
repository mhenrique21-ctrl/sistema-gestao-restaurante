const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware);

// GET /api/products — inclui indisponíveis/inativos; a tela de venda decide
// como exibir (ex: cinza/desabilitado), igual já é feito na Confraria.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, category_id, name, description, image_url, price, code, barcode, active, available, sort_order
       FROM products ORDER BY sort_order, name`
    );
    res.json(result.rows);
  } catch (err) {
    return internalError(res, err, '[products/GET]');
  }
});

router.post('/', requireRole('admin', 'gerente'), async (req, res) => {
  const { category_id, name, description, image_url, price, code, barcode, sort_order = 0 } = req.body;
  if (!name || !(parseFloat(price) >= 0)) {
    return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO products (category_id, name, description, image_url, price, code, barcode, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [category_id || null, name.trim(), description || null, image_url || null, parseFloat(price), code || null, barcode || null, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[products/POST]');
  }
});

router.patch('/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { category_id, name, description, image_url, price, code, barcode, sort_order, active, available } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (category_id !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category_id); }
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
  if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
  if (image_url !== undefined) { updates.push(`image_url = $${idx++}`); values.push(image_url); }
  if (price !== undefined) { updates.push(`price = $${idx++}`); values.push(parseFloat(price)); }
  if (code !== undefined) { updates.push(`code = $${idx++}`); values.push(code); }
  if (barcode !== undefined) { updates.push(`barcode = $${idx++}`); values.push(barcode); }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }
  // active/available ficam de fora da lista parametrizada (mesmo padrão já
  // usado no delivery-backend da Confraria) pra nunca passar de $9 parâmetros
  // reais — acima disso o wrapper de pool.js corrompe $10+ por substituição
  // de string sem âncora.
  if (active !== undefined) { updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`); }
  if (available !== undefined) { updates.push(`available = ${available ? 'TRUE' : 'FALSE'}`); }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo pra atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[products/PATCH]');
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM products WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ deleted: true });
  } catch (err) {
    return internalError(res, err, '[products/DELETE]');
  }
});

module.exports = router;
