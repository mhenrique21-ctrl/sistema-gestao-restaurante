const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// Todas as rotas exigem autenticação
router.use(authMiddleware);

// GET /api/customers — listar (com busca por nome ou telefone)
router.get('/', async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let query = 'SELECT * FROM customers WHERE active = true';
    const values = [];

    if (search) {
      query += ` AND (name ILIKE $1 OR phone ILIKE $1)`;
      values.push(`%${search}%`);
    }

    query += ` ORDER BY name LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(parseInt(limit), offset);

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error('[customers/GET]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const customer = await pool.query(
      'SELECT * FROM customers WHERE id = $1 AND active = true',
      [req.params.id]
    );
    if (!customer.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });

    // Busca últimos 10 pedidos do cliente
    const orders = await pool.query(
      `SELECT o.id, o.status, o.total, o.payment_method, o.created_at,
              COUNT(oi.id) AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 10`,
      [req.params.id]
    );

    res.json({ ...customer.rows[0], recent_orders: orders.rows });
  } catch (err) {
    console.error('[customers/:id]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/customers — criar cliente
router.post('/', async (req, res) => {
  const { name, phone, email, address_street, address_number,
          address_complement, address_neighborhood, address_city, address_zip, notes } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers
        (name, phone, email, address_street, address_number, address_complement,
         address_neighborhood, address_city, address_zip, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, phone, email, address_street, address_number, address_complement,
       address_neighborhood, address_city || 'São Paulo', address_zip, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Telefone já cadastrado' });
    console.error('[customers/POST]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/customers/:id — atualizar cliente
router.patch('/:id', async (req, res) => {
  const fields = ['name', 'phone', 'email', 'address_street', 'address_number',
                  'address_complement', 'address_neighborhood', 'address_city', 'address_zip', 'notes'];
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
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${idx} AND active = true RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Telefone já cadastrado' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/customers/:id/block — bloquear/desbloquear cliente
router.patch('/:id/block', async (req, res) => {
  const { blocked } = req.body;
  if (typeof blocked !== 'boolean') return res.status(400).json({ error: 'Campo blocked obrigatório' });
  try {
    const result = await pool.query(
      'UPDATE customers SET blocked = $1 WHERE id = $2 AND active = true RETURNING *',
      [blocked, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[customers/:id/block]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/customers/:id — deletar cliente (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE customers SET active = false WHERE id = $1 AND active = true RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[customers/:id/DELETE]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
