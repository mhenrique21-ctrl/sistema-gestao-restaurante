const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash, role, active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/auth/register (admin only — use via seed ou painel)
router.post('/register', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas admins podem criar usuários' });
  }

  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
  }

  const validRoles = ['admin', 'atendente', 'entregador', 'cozinha'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role inválida' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email.toLowerCase().trim(), hash, role || 'atendente']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email já cadastrado' });
    console.error('[auth/register]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/auth/register-customer — cadastro rápido de cliente (sem senha)
router.post('/register-customer', async (req, res) => {
  const { name, phone, email } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  try {
    const result = await pool.query(
      `INSERT INTO customers (name, phone, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, customers.email)
       RETURNING id, name, phone, email`,
      [name, phone.replace(/\D/g, ''), email || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[auth/register-customer]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
