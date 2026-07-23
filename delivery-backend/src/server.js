require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { initWebSocket } = require('./websocket/hub');

const app = express();
const server = http.createServer(app);

app.use(compression());

// Baseline de defesa contra abuso — bem generoso pra não afetar uso normal
// (apps de delivery/PDV/kiosk fazendo polling); limites mais rígidos ficam
// nas rotas sensíveis específicas (ex: login, em routes/auth.js).
app.use(rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Sem CORS_ORIGIN configurada no ambiente, caía para '*' (qualquer origem
// podia chamar a API). Agora usa uma lista segura de origens conhecidas como
// padrão — CORS_ORIGIN (separada por vírgula) continua tendo prioridade.
const DEFAULT_CORS_ORIGINS = [
  'https://pedidos.confrariacafe.com',
  'https://gestao.confrariacafe.com',
  'http://localhost:5173',
  'http://localhost:5174',
];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : DEFAULT_CORS_ORIGINS;

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));

// Bug pré-existente corrigido: havia um middleware separado que drenava
// manualmente o stream do request pra montar req.rawBody (pro webhook do
// Stripe verificar assinatura), e DEPOIS o express.json() tentava ler o
// mesmo stream de novo — que já estava esgotado, gerando "stream is not
// readable" (500) em toda chamada a esse endpoint, com ou sem JWT. O
// `verify` do próprio express.json() dá acesso ao buffer bruto sem
// consumir o stream duas vezes.
app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => {
    if (req.path === '/api/orders/webhook/stripe') req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// Serve páginas estáticas sem cache
app.use(express.static(require('path').join(__dirname, '../public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));

// Serve logo diretamente (Nginx não bloqueia /api/)
app.get('/api/logo', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/logo.png'));
});

// Documentação da API — cobre por enquanto os recursos mais usados
// (menu, orders); cresce incrementalmente anotando outras rotas com @openapi.
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Rotas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/users', require('./routes/users'));
app.use('/api/neighborhoods', require('./routes/neighborhoods'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/payment-methods', require('./routes/paymentMethods'));
app.use('/api/delivery', require('./routes/delivery'));
app.use('/api/promotions', require('./routes/promotions'));
app.use('/api/coupons', require('./routes/coupons'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/addon-templates', require('./routes/addonTemplates'));
app.use('/api/printers', require('./routes/printers'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/comandas', require('./routes/comandas'));
app.use('/api/cash-movements', require('./routes/cashMovements'));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/mesas', require('./routes/mesas'));
app.use('/api/pdv-provision', require('./routes/pdvProvision'));
app.use('/api/service-token', require('./routes/serviceToken'));
app.use('/api/printer-agent-token', require('./routes/printerAgentToken'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
});

// Error handler global
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor' });
});

// WebSocket
initWebSocket(server);

const PORT = parseInt(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`\n🚀 Delivery Backend - Confraria`);
  console.log(`   HTTP       → http://localhost:${PORT}`);
  console.log(`   Retaguarda → http://localhost:${PORT}/retaguarda.html`);
  console.log(`   Admin      → http://localhost:${PORT}/admin.html`);
  console.log(`   Cozinha    → http://localhost:${PORT}/kitchen.html`);
  console.log(`   WS         → ws://localhost:${PORT}/ws?token=<jwt>&station=<estação>`);
  console.log(`   Env        → ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, server };
