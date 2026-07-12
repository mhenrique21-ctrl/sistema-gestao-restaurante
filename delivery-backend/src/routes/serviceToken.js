const router = require('express').Router();
const jwt = require('jsonwebtoken');

// POST /api/service-token — emite um JWT de serviço (role admin, 1h de validade)
// pra outros backends internos (hoje: App Gestão) chamarem rotas admin sem
// precisar de login de usuário real. Protegido por segredo compartilhado,
// enviado no header x-service-secret — nunca exposto ao navegador, fica só
// nos dois backends. Mesmo padrão do PDV_PROVISION_SECRET (ver pdvProvision.js).
router.post('/', (req, res) => {
  const secret = req.headers['x-service-secret'];
  if (!process.env.GESTAO_SERVICE_SECRET || secret !== process.env.GESTAO_SERVICE_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const expiresIn = 3600;
  const token = jwt.sign(
    { id: 'service-gestao', name: 'App Gestão (serviço)', role: 'admin', permissions: [] },
    process.env.JWT_SECRET,
    { expiresIn }
  );
  res.json({ token, expiresIn });
});

module.exports = router;
