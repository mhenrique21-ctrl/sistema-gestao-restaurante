const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { authMiddleware, requireRole, invalidarUsuario } = require('../middleware/auth');

// Até 10 tentativas de login por IP a cada 15 minutos — sem isso, a rota
// de login aceitava tentativas ilimitadas de força bruta de senha.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

function emitirToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions || [] },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Marca o último acesso pra que a tela de usuários mostre conta parada. Conta
// esquecida e nunca usada é a que vaza sem ninguém perceber.
async function marcarAcesso(id) {
  try {
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING id`, [id]);
  } catch (err) {
    console.error('[auth/marcarAcesso]', err.message);
  }
}

// POST /api/auth/login — aceita nome ou email + senha
router.post('/login', loginLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  const identifier = (name || email || '').trim();
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Nome e senha são obrigatórios' });
  }

  try {
    // LIMIT 1 sem ORDER BY era um empate resolvido pelo Postgres como bem
    // entendesse. Com "mario" e "MARIO" cadastrados, os dois casam em
    // LOWER(name) e o login passou a cair na conta errada — comparando a senha
    // digitada contra o hash de outra pessoa. Pior: a ordem física muda quando
    // uma das linhas é atualizada, então o login "funcionava" até alguém trocar
    // uma senha e parava de funcionar sem ninguém mexer no código.
    //
    // Agora quem casa exatamente vence, e o empate restante cai na conta mais
    // antiga — determinístico nos dois casos.
    const result = await pool.query(
      `SELECT id, name, email, password_hash, role, active, permissions, must_change_password
         FROM users WHERE LOWER(name) = LOWER($1) OR LOWER(email) = LOWER($1)
        ORDER BY (name = $1) DESC, (email = $1) DESC, created_at
        LIMIT 1`,
      [identifier]
    );

    const user = result.rows[0];
    // Desativado responde igual a senha errada: dizer "conta desativada"
    // confirma pra quem está tentando que aquele nome de usuário existe.
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    await marcarAcesso(user.id);
    const permissions = user.permissions || [];
    res.json({
      token: emitirToken(user),
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role, permissions,
        must_change_password: !!user.must_change_password,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/auth/login-pin — entrada rápida no PDV. Só funciona pra quem tem
// PIN cadastrado; o admin continua exigindo a senha completa.
router.post('/login-pin', loginLimiter, async (req, res) => {
  const identifier = String(req.body.name || '').trim();
  const pin = String(req.body.pin || '');
  if (!identifier || !pin) return res.status(400).json({ error: 'Informe o operador e o PIN' });

  try {
    // Mesmo empate do login por senha. Aqui só interessa quem tem PIN — se
    // duas contas têm o mesmo nome variando maiúscula e só uma cadastrou PIN,
    // é obviamente essa que a pessoa quis. Entre as que têm, vence a exata.
    const result = await pool.query(
      `SELECT id, name, email, role, active, permissions, pin_hash, must_change_password
         FROM users WHERE LOWER(name) = LOWER($1) AND pin_hash IS NOT NULL
        ORDER BY (name = $1) DESC, created_at
        LIMIT 1`,
      [identifier]
    );
    const user = result.rows[0];
    if (!user || !user.active || !user.pin_hash) {
      return res.status(401).json({ error: 'Operador ou PIN inválido' });
    }
    if (!(await bcrypt.compare(pin, user.pin_hash))) {
      return res.status(401).json({ error: 'Operador ou PIN inválido' });
    }
    // Quem ainda deve trocar a senha não entra por PIN: senão o atalho vira o
    // jeito de nunca trocar.
    if (user.must_change_password) {
      return res.status(403).json({ error: 'Entre com a senha para trocá-la antes de usar o PIN', code: 'TROCAR_SENHA' });
    }

    await marcarAcesso(user.id);
    res.json({
      token: emitirToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions || [] },
    });
  } catch (err) {
    console.error('[auth/login-pin]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/auth/change-password — o próprio usuário troca a senha, provando
// que sabe a atual. É o que fecha o ciclo da senha provisória.
router.post('/change-password', authMiddleware, async (req, res) => {
  const atual = String(req.body.current_password || '');
  const nova = String(req.body.new_password || '');
  const { validarSenha } = require('./users');
  try {
    const r = await pool.query(`SELECT id, name, password_hash FROM users WHERE id = $1`, [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!(await bcrypt.compare(atual, user.password_hash))) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    const erro = validarSenha(nova, user.name);
    if (erro) return res.status(400).json({ error: erro });
    if (await bcrypt.compare(nova, user.password_hash)) {
      return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual' });
    }

    const hash = await bcrypt.hash(nova, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE, sessions_valid_from = NOW()
        WHERE id = $2 RETURNING id`,
      [hash, user.id]
    );
    invalidarUsuario(user.id);
    await pool.query(
      `INSERT INTO user_audit (target_user_id, target_name, actor_user_id, actor_name, action)
       VALUES ($1, $2, $1, $2, 'trocou a propria senha') RETURNING id`,
      [user.id, user.name]
    );
    // Trocar a senha encerra as outras sessões, então devolve um token novo
    // pra quem acabou de trocar não ser deslogado de si mesmo.
    const full = await pool.query(`SELECT id, name, email, role, permissions FROM users WHERE id = $1`, [user.id]);
    res.json({ ok: true, token: emitirToken(full.rows[0]) });
  } catch (err) {
    console.error('[auth/change-password]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/auth/pdv-operators — lista pública (sem JWT, é a tela de login) dos
// operadores com acesso ao PDV. Só nome e cargo — nunca email/senha/permissões.
router.get('/pdv-operators', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, role, (pin_hash IS NOT NULL) AS tem_pin
         FROM users WHERE role IN ('admin', 'atendente') AND active = true ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[auth/pdv-operators]', err.message);
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

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/register (admin only — use via seed ou painel)
router.post('/register', registerLimiter, authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
  }

  const validRoles = ['admin', 'operador', 'atendente', 'entregador', 'cozinha'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role inválida' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { permissions } = req.body;
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, permissions)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, permissions`,
      [name, email ? email.toLowerCase().trim() : null, hash, role || 'operador', permissions || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nome ou email já cadastrado' });
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
