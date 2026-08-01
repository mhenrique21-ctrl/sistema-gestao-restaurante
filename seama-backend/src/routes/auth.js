const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

// Até 10 tentativas de login por IP a cada 15 minutos — PIN de 6 dígitos tem
// espaço de busca pequeno, então o rate limit é a defesa real contra força bruta.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

// GET /api/auth/operators — lista pública (nome + id) pra tela de login
// mostrar os operadores cadastrados antes de digitar o PIN.
router.get('/operators', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role FROM users WHERE active = true ORDER BY username`
    );
    res.json(result.rows);
  } catch (err) {
    return internalError(res, err, '[auth/operators]');
  }
});

// POST /api/auth/login — username + PIN numérico de até 6 dígitos
router.post('/login', loginLimiter, async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Usuário e PIN são obrigatórios' });
  }
  if (!/^\d{4,6}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN deve ter de 4 a 6 dígitos' });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, pin_hash, role, active FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [username.trim()]
    );

    const user = result.rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = await bcrypt.compare(String(pin), user.pin_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    return internalError(res, err, '[auth/login]');
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, active FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[auth/me]');
  }
});

// POST /api/auth/users — admin cadastra um colaborador (username + PIN)
router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { username, pin, role } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Usuário e PIN são obrigatórios' });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN deve ter de 4 a 6 dígitos' });
  if (!['caixa', 'gerente', 'admin'].includes(role)) return res.status(400).json({ error: 'Perfil inválido' });

  try {
    const pinHash = await bcrypt.hash(String(pin), 10);
    const result = await pool.query(
      `INSERT INTO users (username, pin_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, active`,
      [username.trim(), pinHash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse nome' });
    return internalError(res, err, '[auth/users create]');
  }
});

// PATCH /api/auth/users/:id — admin edita nome, PIN, perfil ou ativa/desativa
router.patch('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { username, pin, role, active } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (username !== undefined) { updates.push(`username = $${idx++}`); values.push(username.trim()); }
  if (role !== undefined) {
    if (!['caixa', 'gerente', 'admin'].includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
    updates.push(`role = $${idx++}`); values.push(role);
  }
  if (active !== undefined) { updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`); }
  if (pin !== undefined) {
    if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN deve ter de 4 a 6 dígitos' });
    const pinHash = await bcrypt.hash(String(pin), 10);
    updates.push(`pin_hash = $${idx++}`); values.push(pinHash);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo pra atualizar' });
  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, username, role, active`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse nome' });
    return internalError(res, err, '[auth/users update]');
  }
});

// GET /api/auth/users — admin lista todos (inclusive inativos)
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, username, role, active, created_at FROM users ORDER BY username`);
    res.json(result.rows);
  } catch (err) {
    return internalError(res, err, '[auth/users list]');
  }
});

module.exports = router;
