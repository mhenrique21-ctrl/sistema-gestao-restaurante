const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// O token guarda cargo e permissões e vale 7 dias. Antes, conferir só a
// assinatura significava que desativar um usuário não cortava o acesso dele:
// o celular continuava lançando pedido e fazendo sangria até o token vencer.
// Rebaixar de admin pra atendente tinha o mesmo problema.
//
// Agora toda requisição confirma no banco se a conta ainda está ativa, qual é
// o cargo AGORA, e se a sessão não foi encerrada.

// Cache curto pra não transformar cada requisição do PDV — que faz polling —
// numa ida ao banco. Ao desativar ou revogar, a entrada é derrubada na hora,
// então na prática o corte é imediato; os 30s são só a rede de segurança.
const CACHE_MS = 30000;
const cache = new Map();

function invalidarUsuario(id) {
  if (id) cache.delete(String(id));
}

async function estadoDoUsuario(id) {
  const chave = String(id);
  const hit = cache.get(chave);
  if (hit && hit.until > Date.now()) return hit.estado;

  const r = await pool.query(
    `SELECT id, name, role, active, sessions_valid_from, must_change_password
       FROM users WHERE id = $1`,
    [id]
  );
  const estado = r.rows[0] || null;
  cache.set(chave, { until: Date.now() + CACHE_MS, estado });
  return estado;
}

// jwt.iat é em segundos inteiros: um token emitido às 10:00:00.9 grava 10:00:00
// e parece anterior à revogação por até um segundo. A folga cobre esse
// arredondamento e uma diferença pequena entre o relógio do Node e o do
// Postgres — não mais que isso, senão vira janela de sobrevida.
const FOLGA_MS = 2000;

async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  try {
    const atual = await estadoDoUsuario(payload.id);
    if (!atual) return res.status(401).json({ error: 'Usuário não encontrado', code: 'SEM_CONTA' });
    if (!atual.active) {
      return res.status(401).json({ error: 'Este acesso foi desativado', code: 'DESATIVADO' });
    }
    const validoDesde = new Date(atual.sessions_valid_from).getTime();
    if (payload.iat && payload.iat * 1000 < validoDesde - FOLGA_MS) {
      return res.status(401).json({ error: 'Sessão encerrada. Entre de novo.', code: 'SESSAO_ENCERRADA' });
    }
    // O cargo que vale é o do banco. Rebaixar alguém passa a ter efeito na
    // requisição seguinte, não daqui a uma semana.
    req.user = { ...payload, role: atual.role, name: atual.name };
    req.mustChangePassword = !!atual.must_change_password;
  } catch (err) {
    // Banco fora do ar: segue com o que o token diz. Não abre brecha real —
    // sem banco nenhuma rota faz nada — e evita derrubar o PDV inteiro por
    // uma oscilação de rede.
    console.error('[auth/estado]', err.message);
    req.user = payload;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole, invalidarUsuario };
