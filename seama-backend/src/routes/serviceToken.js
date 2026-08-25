const router = require('express').Router();
const jwt = require('jsonwebtoken');

// POST /api/service-token — emite um JWT de serviço (role admin, 1h de validade)
// pro App Gestão chamar rotas admin (estoque, catálogo) sem login de usuário
// real. Protegido pelo mesmo segredo compartilhado que supply.js já usa pra
// autenticar o Gestão (SERVICE_SECRET, enviado no header x-service-secret,
// nunca exposto ao navegador). Mesmo padrão do delivery-backend
// (src/routes/serviceToken.js) — o Gestão já sabe pedir esse token, só
// mudando a URL base pro backend certo por empresa.
router.post('/', (req, res) => {
  const secret = req.headers['x-service-secret'];
  if (!process.env.SERVICE_SECRET || secret !== process.env.SERVICE_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  const expiresIn = 3600;
  const token = jwt.sign(
    { id: 'service-gestao', name: 'App Gestão (serviço)', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn }
  );
  res.json({ token, expiresIn });
});

module.exports = router;
