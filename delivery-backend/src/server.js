require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { initWebSocket } = require('./websocket/hub');

const app = express();
const server = http.createServer(app);

// Captura rawBody para webhook Stripe ANTES do json parser
app.use((req, res, next) => {
  if (req.path === '/api/orders/webhook/stripe') {
    let data = [];
    req.on('data', (chunk) => data.push(chunk));
    req.on('end', () => {
      req.rawBody = Buffer.concat(data);
      next();
    });
  } else {
    next();
  }
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve páginas estáticas (kitchen.html, retaguarda.html)
app.use(express.static(require('path').join(__dirname, '../public')));

// Rotas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/users', require('./routes/users'));

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
