const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole, invalidarUsuario } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware, requireRole('admin'));

// Cargos. Na prática o sistema só tem dois níveis de acesso — 57 rotas exigem
// 'admin' e 13 aceitam 'admin' ou 'atendente'. Os demais cargos servem só pra
// entrar; nenhuma rota protegida os aceita. Os rótulos abaixo dizem isso em
// português em vez de fingir uma granularidade que não existe.
const CARGOS = ['admin', 'atendente', 'cozinha', 'entregador', 'operador'];

const SENHA_MIN = 6;
// Senhas que aparecem em qualquer lista de força bruta. Barrar as óbvias vale
// mais que exigir símbolo: quem é obrigado a usar símbolo escreve no post-it.
const SENHAS_PROIBIDAS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234', '12345',
  'senha', 'senha123', 'password', 'admin', 'admin123', 'qwerty',
  'confraria', 'caixa', 'pdv', 'abcdef', '111111', '000000',
]);

function validarSenha(senha, nome) {
  if (!senha || senha.length < SENHA_MIN) return `A senha precisa de pelo menos ${SENHA_MIN} caracteres`;
  const s = String(senha).toLowerCase();
  if (SENHAS_PROIBIDAS.has(s)) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if (nome && s === String(nome).toLowerCase().trim()) return 'A senha não pode ser igual ao nome de usuário';
  if (/^(.)\1+$/.test(senha)) return 'A senha não pode ser um único caractere repetido';
  return null;
}

function validarPin(pin) {
  if (!/^\d{4,6}$/.test(String(pin || ''))) return 'O PIN precisa ter de 4 a 6 dígitos';
  if (/^(.)\1+$/.test(String(pin))) return 'PIN não pode ser o mesmo dígito repetido';
  if (['1234', '12345', '123456', '4321', '0000'].includes(String(pin))) return 'PIN fácil demais de adivinhar';
  return null;
}

async function registrar(req, alvo, action, details) {
  try {
    await pool.query(
      `INSERT INTO user_audit (target_user_id, target_name, actor_user_id, actor_name, action, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      [alvo?.id || null, alvo?.name || null, req.user?.id || null, req.user?.name || null,
       action, JSON.stringify(details || {})]
    );
  } catch (err) {
    // Auditoria não pode derrubar a operação que ela registra.
    console.error('[users/audit]', err.message);
  }
}

async function contarAdminsAtivos(exceto) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active = true AND id <> $1`,
    [exceto || '00000000-0000-0000-0000-000000000000']
  );
  return r.rows[0]?.n || 0;
}

// GET /api/users — lista pro painel. Nunca devolve hash de senha nem de PIN.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, email, role, active, permissions, created_at, last_login_at,
              must_change_password, (pin_hash IS NOT NULL) AS tem_pin,
              sessions_valid_from
         FROM users ORDER BY active DESC, name`
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[users/GET]');
  }
});

// GET /api/users/audit — histórico de alterações de acesso.
router.get('/audit', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, target_name, actor_name, action, details, created_at
         FROM user_audit ORDER BY created_at DESC LIMIT 200`
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[users/audit]');
  }
});

// POST /api/users — cria operador.
router.post('/', async (req, res) => {
  const { name, password, role } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Informe o nome de usuário' });
  if (role && !CARGOS.includes(role)) return res.status(400).json({ error: 'Cargo inválido' });

  const nome = String(name).trim();
  const erro = validarSenha(password, nome);
  if (erro) return res.status(400).json({ error: erro });

  try {
    const hash = await bcrypt.hash(password, 10);
    const email = req.body.email?.trim() || `${nome.toLowerCase().replace(/\s+/g, '.')}@interno.local`;
    // Nasce obrigado a trocar a senha: quem cadastrou sabe a senha provisória,
    // então até a troca nada feito nessa conta prova quem foi.
    const trocar = req.body.must_change_password === false ? 'FALSE' : 'TRUE';
    const r = await pool.query(
      // sessions_valid_from fica no passado: conta nova não tem sessão pra
      // proteger, e marcar NOW() aqui faria o primeiro login disputar com a
      // própria data de criação.
      `INSERT INTO users (name, email, password_hash, role, permissions, must_change_password, sessions_valid_from)
       VALUES ($1, $2, $3, $4, '{}'::text[], ${trocar}, '2000-01-01T00:00:00Z')
       RETURNING id, name, email, role, active, created_at, must_change_password`,
      [nome, email, hash, role || 'atendente']
    );
    await registrar(req, r.rows[0], 'criou', { role: r.rows[0].role });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse nome' });
    return internalError(res, err, '[users/POST]');
  }
});

// PATCH /api/users/:id — nome, cargo, ativo e senha.
router.patch('/:id', async (req, res) => {
  try {
    const atualRes = await pool.query(`SELECT id, name, role, active FROM users WHERE id = $1`, [req.params.id]);
    const atual = atualRes.rows[0];
    if (!atual) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Trava do último admin. Sem ela, um clique em "Ativo" no próprio usuário
    // tranca a loja por fora: ninguém mais cria usuário, edita preço nem fecha
    // caixa como admin, e a saída seria mexer no banco na mão.
    const perdeAdmin = atual.role === 'admin' &&
      ((req.body.role !== undefined && req.body.role !== 'admin') || req.body.active === false);
    if (perdeAdmin && (await contarAdminsAtivos(atual.id)) === 0) {
      return res.status(400).json({
        error: `${atual.name} é o único administrador ativo. Promova outra pessoa a administrador antes de mudar este acesso.`,
        code: 'ULTIMO_ADMIN',
      });
    }

    const updates = [], values = [];
    let idx = 1;
    const mudou = {};

    if (req.body.name !== undefined) {
      const nome = String(req.body.name).trim();
      if (!nome) return res.status(400).json({ error: 'Nome não pode ficar vazio' });
      updates.push(`name = $${idx++}`); values.push(nome); mudou.name = nome;
    }
    if (req.body.role !== undefined) {
      if (!CARGOS.includes(req.body.role)) return res.status(400).json({ error: 'Cargo inválido' });
      updates.push(`role = $${idx++}`); values.push(req.body.role); mudou.role = req.body.role;
    }
    if (req.body.active !== undefined) {
      updates.push(`active = ${req.body.active ? 'TRUE' : 'FALSE'}`);
      mudou.active = !!req.body.active;
    }
    if (req.body.password) {
      // Trocar a própria senha por aqui deixa o dono sem saber a senha nova se
      // ele fechar a tela, e ainda derrubava a sessão dele no mesmo instante.
      // O caminho certo pra si mesmo é POST /auth/change-password, que pede a
      // senha atual e devolve um token novo.
      if (String(req.params.id) === String(req.user?.id)) {
        return res.status(400).json({
          error: 'Para trocar a sua própria senha use "Minha senha", que pede a senha atual e mantém você conectado.',
          code: 'USE_MINHA_SENHA',
        });
      }
      const erro = validarSenha(req.body.password, mudou.name || atual.name);
      if (erro) return res.status(400).json({ error: erro });
      updates.push(`password_hash = $${idx++}`);
      values.push(await bcrypt.hash(req.body.password, 10));
      // Senha resetada por admin é provisória por definição.
      updates.push(`must_change_password = ${req.body.must_change_password === false ? 'FALSE' : 'TRUE'}`);
      mudou.senha = true;
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada para alterar' });

    // Desativar, rebaixar ou trocar a senha derruba o que estiver aberto —
    // é justamente o que se espera dessas três ações.
    const revoga = mudou.active === false || mudou.role !== undefined || mudou.senha;
    if (revoga) updates.push(`sessions_valid_from = NOW()`);

    values.push(req.params.id);
    const r = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, name, email, role, active, last_login_at, must_change_password, (pin_hash IS NOT NULL) AS tem_pin`,
      values
    );
    invalidarUsuario(req.params.id);

    const acoes = [];
    if (mudou.active === false) acoes.push('desativou');
    if (mudou.active === true) acoes.push('reativou');
    if (mudou.role) acoes.push('mudou cargo');
    if (mudou.senha) acoes.push('resetou senha');
    if (mudou.name) acoes.push('renomeou');
    await registrar(req, r.rows[0], acoes.join(' + ') || 'editou', mudou);

    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse nome' });
    return internalError(res, err, '[users/PATCH]');
  }
});

// POST /api/users/:id/revoke — botão de pânico: celular perdido, gente demitida.
router.post('/:id/revoke', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE users SET sessions_valid_from = NOW() WHERE id = $1 RETURNING id, name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    invalidarUsuario(req.params.id);
    await registrar(req, r.rows[0], 'encerrou sessões', {});
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[users/revoke]');
  }
});

// PUT/DELETE /api/users/:id/pin — atalho de entrada no PDV.
// O PIN nunca vale no admin: lá continua exigindo a senha completa.
router.put('/:id/pin', async (req, res) => {
  const erro = validarPin(req.body.pin);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const hash = await bcrypt.hash(String(req.body.pin), 10);
    const r = await pool.query(
      `UPDATE users SET pin_hash = $1 WHERE id = $2 RETURNING id, name`,
      [hash, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    invalidarUsuario(req.params.id);
    await registrar(req, r.rows[0], 'definiu PIN', {});
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[users/pin-set]');
  }
});

router.delete('/:id/pin', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE users SET pin_hash = NULL WHERE id = $1 RETURNING id, name`, [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    invalidarUsuario(req.params.id);
    await registrar(req, r.rows[0], 'removeu PIN', {});
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[users/pin-del]');
  }
});

module.exports = router;
module.exports.validarSenha = validarSenha;
