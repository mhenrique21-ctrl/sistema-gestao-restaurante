const router = require('express').Router();
const jwt = require('jsonwebtoken');

// POST /api/printer-agent-token — emite um JWT de curta duração (24h) pro
// agente de impressão local (Windows) usar na conexão WebSocket. O agente
// guarda só o PRINT_AGENT_SECRET (fixo, nunca expira) e chama essa rota
// pra pegar um token novo antes de cada conexão — assim nunca fica sem
// imprimir por token vencido. Mesmo padrão do service-token (ver serviceToken.js).
router.post('/', (req, res) => {
  const secret = req.headers['x-printer-secret'];
  if (!process.env.PRINT_AGENT_SECRET || secret !== process.env.PRINT_AGENT_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const expiresIn = 86400;
  const token = jwt.sign(
    { id: 'print-agent', name: 'Agente de Impressão (loja)', role: 'agent', permissions: [] },
    process.env.JWT_SECRET,
    { expiresIn }
  );
  res.json({ token, expiresIn });
});

module.exports = router;
