const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/menu — cardápio completo agrupado por categoria
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.description AS category_description,
        c.image_url AS category_image,
        c.sort_order AS category_sort,
        p.id AS product_id,
        p.name AS product_name,
        p.description AS product_description,
        p.price,
        p.image_url AS product_image,
        p.available,
        p.sort_order AS product_sort
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.available = true
      WHERE c.active = true
      ORDER BY c.sort_order, p.sort_order, p.name
    `);

    const menu = {};
    for (const row of result.rows) {
      if (!menu[row.category_id]) {
        menu[row.category_id] = {
          id: row.category_id,
          name: row.category_name,
          description: row.category_description,
          image_url: row.category_image,
          sort_order: row.category_sort,
          products: [],
        };
      }
      if (row.product_id) {
        menu[row.category_id].products.push({
          id: row.product_id,
          name: row.product_name,
          description: row.product_description,
          price: parseFloat(row.price),
          image_url: row.product_image,
          available: row.available,
        });
      }
    }

    res.json(Object.values(menu).sort((a, b) => a.sort_order - b.sort_order));
  } catch (err) {
    console.error('[menu/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar cardápio' });
  }
});

// GET /api/menu/products/:id — produto específico
router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/menu/products — criar produto (admin)
router.post('/products', authMiddleware, requireRole('admin'), async (req, res) => {
  const { category_id, name, description, price, image_url, sort_order } = req.body;
  if (!category_id || !name || price === undefined) {
    return res.status(400).json({ error: 'category_id, name e price são obrigatórios' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO products (category_id, name, description, price, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [category_id, name, description, price, image_url, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Categoria não encontrada' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/menu/products/:id — atualizar produto (admin)
router.patch('/products/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const fields = ['name', 'description', 'price', 'image_url', 'available', 'sort_order', 'category_id'];
  const updates = [];
  const values = [];
  let idx = 1;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
