const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DB_FILE = path.join(__dirname, 'dados.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return { lancamentos:[], compras:[], fichas:[], funcionarios:[], eventos:[], faltas:[], adiantamentos:[], categorias:[] };
}
function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data), 'utf8');
}

const server = http.createServer((req, res) => {
  // No cache headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve app - always fresh
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    try {
      const file = fs.readFileSync(path.join(__dirname, 'gestao_restaurante_mobile.html'));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(file);
    } catch(e) {
      res.writeHead(500);
      res.end('Erro ao carregar app: ' + e.message);
    }
    return;
  }

  // Load DB
  if (req.method === 'GET' && req.url.startsWith('/dados')) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(loadDB()));
    return;
  }

  // Save DB
  if (req.method === 'POST' && req.url === '/dados') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        saveDB(JSON.parse(body));
        res.writeHead(200);
        res.end('ok');
      } catch(e) {
        res.writeHead(500);
        res.end('erro: ' + e.message);
      }
    });
    return;
  }

  // Proxy IA - cupom scan
  if (req.method === 'POST' && req.url === '/api/scan') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const data = JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: payload.max_tokens || 2000,
          messages: payload.messages
        });
        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(data)
          }
        };
        const apiReq = https.request(options, apiRes => {
          let result = '';
          apiRes.on('data', chunk => result += chunk);
          apiRes.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(apiRes.statusCode);
            res.end(result);
            console.log('IA scan - status:', apiRes.statusCode);
          });
        });
        apiReq.on('error', err => {
          console.error('Erro IA:', err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });
        apiReq.write(data);
        apiReq.end();
      } catch(e) {
        console.error('Erro parse:', e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', apiKey: API_KEY ? 'configurada' : 'AUSENTE', uptime: process.uptime() }));
    return;
  }

  res.writeHead(404);
  res.end('Not found: ' + req.url);
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`API Key: ${API_KEY ? '✅ configurada (' + API_KEY.substring(0,20) + '...)' : '❌ AUSENTE'}`);
});
