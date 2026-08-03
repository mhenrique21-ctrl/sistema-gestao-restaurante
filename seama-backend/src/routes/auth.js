const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');

const ROLES = ['caixa', 'gerente', 'admin'];

// PIN de 6 dígitos tem só 1 milhão de combinações, e as primeiras que
// qualquer um tenta são sequência e dígito repetido. Barrar aqui vale mais
// que qualquer proteção depois.
function weakPinReason(pin) {
  const s = String(pin);
  if (/^(\d)\1+$/.test(s)) return 'PIN não pode ser o mesmo dígito repetido';
  const asc = '0123456789';
  const desc = '9876543210';
  if (asc.includes(s) || desc.includes(s)) return 'PIN não pode ser uma sequência';
  if (['123456', '654321', '112233', '123123', '102030'].includes(s)) return 'PIN muito comum, escolha outro';
  return null;
}

// Quantos admins ativos existiriam se este usuário mudasse. Serve pra impedir
// que o último admin seja rebaixado ou desativado — sem admin, ninguém mais
// entra nas configurações e o sistema fica sem dono.
async function countOtherActiveAdmins(excludeId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active = true AND id <> $1`,
    [excludeId]
  );
  return r.rows[0]?.n ?? 0;
}

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

    // Registro do último acesso é informativo (aparece na tela de usuários);
    // falhar aqui não pode impedir o login.
    pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING id`, [user.id])
      .catch((e) => console.error('[auth/last_login]', e.message));

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
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
  const weak = weakPinReason(pin);
  if (weak) return res.status(400).json({ error: weak });

  try {
    const pinHash = await bcrypt.hash(String(pin), 10);
    const result = await pool.query(
      `INSERT INTO users (username, pin_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, active`,
      [username.trim(), pinHash, role]
    );
    logAction(req.user.id, 'usuario_criado', { user_id: result.rows[0].id, username: username.trim(), role });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse nome' });
    return internalError(res, err, '[auth/users create]');
  }
});

// POST /api/auth/change-pin — qualquer usuário troca o PRÓPRIO PIN, provando
// que sabe o atual. Redefinição de PIN de terceiro é outra rota (só admin).
router.post('/change-pin', authMiddleware, async (req, res) => {
  const { current_pin, new_pin } = req.body;
  if (!current_pin || !new_pin) return res.status(400).json({ error: 'Informe o PIN atual e o novo' });
  if (!/^\d{4,6}$/.test(String(new_pin))) return res.status(400).json({ error: 'PIN deve ter de 4 a 6 dígitos' });
  const weak = weakPinReason(new_pin);
  if (weak) return res.status(400).json({ error: weak });

  try {
    const r = await pool.query(`SELECT pin_hash FROM users WHERE id = $1`, [req.user.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    const ok = await bcrypt.compare(String(current_pin), r.rows[0].pin_hash);
    if (!ok) return res.status(401).json({ error: 'PIN atual incorreto' });

    const pinHash = await bcrypt.hash(String(new_pin), 10);
    await pool.query(`UPDATE users SET pin_hash = $1 WHERE id = $2 RETURNING id`, [pinHash, req.user.id]);
    logAction(req.user.id, 'pin_alterado', { proprio: true });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[auth/change-pin]');
  }
});

// PATCH /api/auth/users/:id — admin edita nome, PIN, perfil ou ativa/desativa
router.patch('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { username, pin, role, active } = req.body;
  const alvoId = req.params.id;
  const souEu = alvoId === req.user.id;

  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
  if (pin !== undefined) {
    if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN deve ter de 4 a 6 dígitos' });
    const weak = weakPinReason(pin);
    if (weak) return res.status(400).json({ error: weak });
  }

  try {
    const atualRes = await pool.query(`SELECT id, username, role, active FROM users WHERE id = $1`, [alvoId]);
    const atual = atualRes.rows[0];
    if (!atual) return res.status(404).json({ error: 'Usuário não encontrado' });

    // O caminho mais comum de se trancar pra fora é o admin mexendo em si
    // mesmo — bloqueia antes de qualquer coisa.
    if (souEu && active === false) return res.status(400).json({ error: 'Você não pode desativar a si mesmo' });
    if (souEu && role !== undefined && role !== 'admin') {
      return res.status(400).json({ error: 'Você não pode rebaixar o próprio perfil' });
    }

    // Sem nenhum admin ativo, ninguém mais entra nas configurações.
    const perdeAdmin = atual.role === 'admin' && atual.active
      && ((role !== undefined && role !== 'admin') || active === false);
    if (perdeAdmin && (await countOtherActiveAdmins(alvoId)) === 0) {
      return res.status(400).json({ error: 'Precisa haver ao menos um administrador ativo' });
    }

    const updates = [];
    const values = [];
    let idx = 1;
    if (username !== undefined) { updates.push(`username = $${idx++}`); values.push(username.trim()); }
    if (role !== undefined) { updates.push(`role = $${idx++}`); values.push(role); }
    if (active !== undefined) { updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`); }
    if (pin !== undefined) {
      const pinHash = await bcrypt.hash(String(pin), 10);
      updates.push(`pin_hash = $${idx++}`); values.push(pinHash);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nenhum campo pra atualizar' });
    values.push(alvoId);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, username, role, active`,
      values
    );

    // Cada tipo de mudança vira um registro próprio: "mexeram no usuário" não
    // ajuda numa apuração, "resetaram o PIN do fulano" ajuda.
    if (pin !== undefined) logAction(req.user.id, 'pin_redefinido', { user_id: alvoId, username: atual.username });
    if (role !== undefined && role !== atual.role) {
      logAction(req.user.id, 'perfil_alterado', { user_id: alvoId, username: atual.username, de: atual.role, para: role });
    }
    if (active !== undefined && active !== atual.active) {
      logAction(req.user.id, active ? 'usuario_reativado' : 'usuario_desativado', { user_id: alvoId, username: atual.username });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse nome' });
    return internalError(res, err, '[auth/users update]');
  }
});

// GET /api/auth/users — admin lista todos (inclusive inativos)
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, username, role, active, created_at, last_login_at FROM users ORDER BY username`);
    res.json(result.rows);
  } catch (err) {
    return internalError(res, err, '[auth/users list]');
  }
});

module.exports = router;
