require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Atrás do Nginx (reverse proxy) — sem isso, o Express não confia no
// X-Forwarded-For que o Nginx envia, e o express-rate-limit recusa a
// requisição inteira (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) em vez de só
// avisar. "1" = confia só no primeiro hop (o próprio Nginx local).
app.set('trust proxy', 1);

app.use(compression());

app.use(rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
}));

const DEFAULT_CORS_ORIGINS = [
  'https://seama.confrariacafe.com',
  'http://localhost:5175',
  'capacitor://localhost',
];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : DEFAULT_CORS_ORIGINS;

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(require('path').join(__dirname, '../public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/addons', require('./routes/addons'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/cash-movements', require('./routes/cashMovements'));
app.use('/api/cash-sessions', require('./routes/cashSessions'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/supply', require('./routes/supply'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/service-token', require('./routes/serviceToken'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.use((req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor' });
});

const PORT = parseInt(process.env.PORT) || 4100;
server.listen(PORT, () => {
  console.log(`\n🚀 Backend PDV - Seama`);
  console.log(`   HTTP → http://localhost:${PORT}`);
  console.log(`   Env  → ${process.env.NODE_ENV || 'development'}\n`);
  require('./services/gestaoSync').iniciarSincronizacaoPeriodica();
});

module.exports = { app, server };
