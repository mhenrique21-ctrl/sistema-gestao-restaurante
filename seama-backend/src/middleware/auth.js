const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// O perfil e o status vêm do BANCO a cada requisição, não do token. O JWT vale
// até 12h, então sem esta consulta um usuário desativado (ou rebaixado)
// continuaria com acesso — e um admin desligado poderia desligar os outros
// antes do token vencer. É uma consulta por requisição, irrelevante no volume
// de um PDV de balcão.
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
    const r = await pool.query(`SELECT id, username, role, active FROM users WHERE id = $1`, [payload.id]);
    const user = r.rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuário inativo ou removido' });
    }
    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch (err) {
    console.error('[auth/middleware]', err.message);
    return res.status(500).json({ error: 'Erro ao validar sessão' });
  }
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

module.exports = { authMiddleware, requireRole };
