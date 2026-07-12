const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');

// POST /api/pdv-provision — cria ou atualiza um login do PDV (role fixa 'atendente').
// Rota de serviço, sem JWT de usuário: usada só pelo backend do App Gestão
// (new_server.js) quando alguém marca "criar acesso PDV" no cadastro de usuários
// de lá. Protegida por um segredo compartilhado enviado no header
// x-provision-secret — nunca exposto ao navegador, fica só nos dois backends.
router.post('/', async (req, res) => {
  const secret = req.headers['x-provision-secret'];
  if (!process.env.PDV_PROVISION_SECRET || secret !== process.env.PDV_PROVISION_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Nome e senha são obrigatórios' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const existing = await pool.query(`SELECT id FROM users WHERE name = $1`, [name.trim()]);
    if (existing.rows.length) {
      // id vem primeiro ($1) e o hash bcrypt por último ($2) de propósito: o wrapper
      // de query deste projeto faz substituição de string em ordem ($1, $2, ...) sem
      // parametrização real, e hashes bcrypt contêm literais "$2b$10$" — se um hash
      // fosse substituído antes de um placeholder de número mais alto (ex: $2, $10),
      // o texto "$2"/"$10" embutido no próprio hash seria re-substituído por engano.
      // Colocando o hash na última posição, não sobra placeholder maior pra colidir.
      await pool.query(
        `UPDATE users SET password_hash = $2, role = 'atendente', active = true WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, hash]
      );
      return res.json({ message: 'Login do PDV atualizado.' });
    }
    const email = `${name.trim().toLowerCase().replace(/\s+/g, '.')}@interno.local`;
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'atendente') RETURNING id`,
      [name.trim(), email, hash]
    );
    res.status(201).json({ message: 'Login do PDV criado.' });
  } catch (err) {
    console.error('[pdv-provision]', err.message);
    res.status(500).json({ error: 'Erro ao provisionar login do PDV' });
  }
});

module.exports = router;
