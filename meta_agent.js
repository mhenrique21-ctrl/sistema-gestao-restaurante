const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    raw.split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && v.length) process.env[k.trim()] = v.join('=').trim();
    });
  } catch (_) {}
}
loadEnv();

const META_TOKEN   = process.env.META_ACCESS_TOKEN   || '';
const AD_ACCOUNT   = process.env.META_AD_ACCOUNT_ID  || ''; // ex: act_123456789
const PAGE_ID      = process.env.META_PAGE_ID         || '';
const CATALOG_ID   = process.env.META_CATALOG_ID      || '';
const API_VERSION  = 'v20.0';
const BASE_URL     = `https://graph.facebook.com/${API_VERSION}`;
const PORT         = process.env.META_AGENT_PORT || 3001;

// ─── HTTP helper ────────────────────────────────────────────────────────────
function metaRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = new URL(`${BASE_URL}${endpoint}${sep}access_token=${META_TOKEN}`);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── ADS ────────────────────────────────────────────────────────────────────
async function listarCampanhas() {
  return metaRequest('GET', `/${AD_ACCOUNT}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time`);
}

async function criarCampanha({ nome, objetivo, orcamentoDiario, dataInicio, dataFim }) {
  // objetivo: LINK_CLICKS | REACH | CONVERSIONS | MESSAGES | LEAD_GENERATION
  return metaRequest('POST', `/${AD_ACCOUNT}/campaigns`, {
    name: nome,
    objective: objetivo || 'LINK_CLICKS',
    status: 'PAUSED',
    daily_budget: Math.round((orcamentoDiario || 10) * 100), // em centavos
    start_time: dataInicio,
    stop_time: dataFim,
    special_ad_categories: []
  });
}

async function alterarStatusCampanha(campanhaId, status) {
  // status: ACTIVE | PAUSED | DELETED | ARCHIVED
  return metaRequest('POST', `/${campanhaId}`, { status });
}

async function listarConjuntosAnuncios(campanhaId) {
  const filtro = campanhaId ? `&campaign_id=${campanhaId}` : '';
  return metaRequest('GET', `/${AD_ACCOUNT}/adsets?fields=id,name,status,daily_budget,targeting,optimization_goal${filtro}`);
}

async function criarConjuntoAnuncios({ nome, campanhaId, orcamentoDiario, publico, posicionamentos }) {
  return metaRequest('POST', `/${AD_ACCOUNT}/adsets`, {
    name: nome,
    campaign_id: campanhaId,
    daily_budget: Math.round((orcamentoDiario || 10) * 100),
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    status: 'PAUSED',
    targeting: publico || {
      geo_locations: { countries: ['BR'] },
      age_min: 18,
      age_max: 65
    },
    publisher_platforms: posicionamentos || ['facebook', 'instagram']
  });
}

async function listarAnuncios(conjuntoId) {
  const filtro = conjuntoId ? `&adset_id=${conjuntoId}` : '';
  return metaRequest('GET', `/${AD_ACCOUNT}/ads?fields=id,name,status,creative,adset_id${filtro}`);
}

// ─── MÉTRICAS / INSIGHTS ────────────────────────────────────────────────────
async function metricasCampanhas({ periodo, campanhaId }) {
  // periodo: today | yesterday | last_7d | last_30d | last_month | this_month
  const alvo = campanhaId || AD_ACCOUNT;
  const endpoint = `/${alvo}/insights?fields=impressions,reach,clicks,spend,cpm,cpc,ctr,actions,cost_per_action_type&date_preset=${periodo || 'last_7d'}&level=campaign`;
  return metaRequest('GET', endpoint);
}

async function metricasAnuncio(anuncioId, periodo) {
  return metaRequest('GET', `/${anuncioId}/insights?fields=impressions,reach,clicks,spend,cpm,cpc,ctr,actions&date_preset=${periodo || 'last_7d'}`);
}

// ─── MENSAGENS (WhatsApp/Messenger) ─────────────────────────────────────────
async function listarConversas() {
  return metaRequest('GET', `/${PAGE_ID}/conversations?fields=id,link,participants,updated_time,unread_count&platform=messenger`);
}

async function listarMensagens(conversaId) {
  return metaRequest('GET', `/${conversaId}/messages?fields=id,from,message,created_time`);
}

async function enviarMensagem(destinatarioId, texto) {
  return metaRequest('POST', `/${PAGE_ID}/messages`, {
    recipient: { id: destinatarioId },
    message: { text: texto }
  });
}

async function responderWhatsApp(numeroTelefone, texto, whatsappBusinessId) {
  const wabId = whatsappBusinessId || process.env.META_WABA_ID || '';
  return metaRequest('POST', `/${wabId}/messages`, {
    messaging_product: 'whatsapp',
    to: numeroTelefone,
    type: 'text',
    text: { body: texto }
  });
}

// ─── CATÁLOGO ────────────────────────────────────────────────────────────────
async function listarProdutos() {
  return metaRequest('GET', `/${CATALOG_ID}/products?fields=id,name,description,price,availability,url,image_url`);
}

async function criarProduto({ nome, descricao, preco, moeda, disponibilidade, url, imagemUrl, sku }) {
  return metaRequest('POST', `/${CATALOG_ID}/products`, {
    name: nome,
    description: descricao || '',
    price: Math.round(preco * 100), // em centavos
    currency: moeda || 'BRL',
    availability: disponibilidade || 'in stock',
    url: url || '',
    image_url: imagemUrl || '',
    retailer_id: sku || `SKU-${Date.now()}`
  });
}

async function atualizarProduto(produtoId, campos) {
  return metaRequest('POST', `/${produtoId}`, campos);
}

async function deletarProduto(produtoId) {
  return metaRequest('DELETE', `/${produtoId}`);
}

// ─── SERVIDOR HTTP (interface do agente) ────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { resolve({}); } });
  });
}

const ROUTES = {
  // Campanhas
  'GET /campanhas':           () => listarCampanhas(),
  'POST /campanhas':          b  => criarCampanha(b),
  'POST /campanhas/status':   b  => alterarStatusCampanha(b.campanhaId, b.status),

  // Conjuntos de anúncios
  'GET /conjuntos':           b  => listarConjuntosAnuncios(b.campanhaId),
  'POST /conjuntos':          b  => criarConjuntoAnuncios(b),

  // Anúncios
  'GET /anuncios':            b  => listarAnuncios(b.conjuntoId),

  // Métricas
  'GET /metricas':            b  => metricasCampanhas(b),
  'GET /metricas/anuncio':    b  => metricasAnuncio(b.anuncioId, b.periodo),

  // Mensagens
  'GET /conversas':           () => listarConversas(),
  'GET /mensagens':           b  => listarMensagens(b.conversaId),
  'POST /mensagens':          b  => enviarMensagem(b.destinatarioId, b.texto),
  'POST /whatsapp':           b  => responderWhatsApp(b.numero, b.texto, b.wabId),

  // Catálogo
  'GET /produtos':            () => listarProdutos(),
  'POST /produtos':           b  => criarProduto(b),
  'PUT /produtos':            b  => atualizarProduto(b.produtoId, b.campos),
  'DELETE /produtos':         b  => deletarProduto(b.produtoId),
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  const url    = new URL(req.url, `http://localhost`);
  const key    = `${req.method} ${url.pathname}`;
  const body   = await parseBody(req);
  // query params também vão para o body
  url.searchParams.forEach((v, k) => { body[k] = v; });

  const handler = ROUTES[key];
  if (!handler) return json(res, 404, { erro: `Rota não encontrada: ${key}` });

  if (!META_TOKEN) return json(res, 500, { erro: 'META_ACCESS_TOKEN não configurado no .env' });

  try {
    const result = await handler(body);
    json(res, 200, result);
  } catch (err) {
    json(res, 500, { erro: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🤖 Meta Business Agent rodando em http://localhost:${PORT}`);
  console.log('──────────────────────────────────────────────');
  console.log('CAMPANHAS');
  console.log(`  GET    /campanhas`);
  console.log(`  POST   /campanhas          { nome, objetivo, orcamentoDiario, dataInicio, dataFim }`);
  console.log(`  POST   /campanhas/status   { campanhaId, status }`);
  console.log('CONJUNTOS DE ANÚNCIOS');
  console.log(`  GET    /conjuntos          ?campanhaId=...`);
  console.log(`  POST   /conjuntos          { nome, campanhaId, orcamentoDiario, publico }`);
  console.log('ANÚNCIOS');
  console.log(`  GET    /anuncios           ?conjuntoId=...`);
  console.log('MÉTRICAS');
  console.log(`  GET    /metricas           ?periodo=last_7d&campanhaId=...`);
  console.log(`  GET    /metricas/anuncio   ?anuncioId=...&periodo=...`);
  console.log('MENSAGENS');
  console.log(`  GET    /conversas`);
  console.log(`  GET    /mensagens          ?conversaId=...`);
  console.log(`  POST   /mensagens          { destinatarioId, texto }`);
  console.log(`  POST   /whatsapp           { numero, texto, wabId }`);
  console.log('CATÁLOGO');
  console.log(`  GET    /produtos`);
  console.log(`  POST   /produtos           { nome, descricao, preco, url, imagemUrl, sku }`);
  console.log(`  PUT    /produtos           { produtoId, campos: {...} }`);
  console.log(`  DELETE /produtos           { produtoId }`);
  console.log('──────────────────────────────────────────────\n');
});
