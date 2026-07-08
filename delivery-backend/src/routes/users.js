const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('admin'));

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, name, email, role, active, permissions, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/users — criar usuário (admin)
router.post('/', async (req, res) => {
  const { name, password, role, permissions } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Nome e senha são obrigatórios' });
  const validRoles = ['admin', 'operador', 'atendente', 'entregador', 'cozinha'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Role inválida' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const email = req.body.email?.trim() || `${name.trim().toLowerCase().replace(/\s+/g, '.')}@interno.local`;
    const perms = Array.isArray(permissions) ? permissions : (typeof permissions === 'string' ? permissions.split(',').filter(Boolean) : []);
    const r = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, permissions)
       VALUES ($1, $2, $3, $4, $5::text[]) RETURNING id, name, email, role, active, permissions`,
      [name.trim(), email, hash, role || 'operador', `{${perms.join(',')}}`]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nome já cadastrado' });
    console.error('[users/POST]', err.message, err.code, err.detail);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// PATCH /api/users/:id — editar nome, role, active, senha, permissions
router.patch('/:id', async (req, res) => {
  const fields = ['role', 'active', 'name'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (req.body.password) {
    const hash = await bcrypt.hash(req.body.password, 10);
    updates.push(`password_hash = $${idx++}`);
    values.push(hash);
  }
  if (req.body.permissions !== undefined) {
    const perms = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    updates.push(`permissions = $${idx++}::text[]`);
    values.push(`{${perms.join(',')}}`);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, email, role, active, permissions`,
      values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
