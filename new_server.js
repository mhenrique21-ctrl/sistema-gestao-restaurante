import 'dotenv/config';
import http from 'http';
import https from 'https';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import webPush from 'web-push';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DIST = path.join(__dirname, 'dist');
const LOGOS_DIR = path.join(__dirname, 'logos');
const CERTS_DIR = path.join(__dirname, 'certs');
const DADOS_DIR = path.join(__dirname, 'dados');
const CACHE_FILE = path.join(CERTS_DIR, 'sefaz_cache.json');
fs.mkdirSync(DADOS_DIR, { recursive: true });

// ===== WEB PUSH =====
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:admin@gestao.local';
const SUBS_FILE     = path.join(DADOS_DIR, 'push_subscriptions.json');
const PUSH_SENT_FILE= path.join(DADOS_DIR, 'push_last_sent.json');

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('[Push] VAPID configurado ✅');
} else {
  console.warn('[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não definidas — notificações desativadas.');
}

function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8')); } catch { return []; }
}
function saveSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs));
}

async function checkPushNotifications() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const now = new Date();
  const hour = now.getHours();
  if (hour < 7 || hour > 9) return; // só 7h–9h
  const today = now.toISOString().slice(0, 10);
  let lastSent = {};
  try { lastSent = JSON.parse(fs.readFileSync(PUSH_SENT_FILE, 'utf-8')); } catch {}
  if (lastSent.date === today) return; // já enviou hoje
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const subs = loadSubs();
  if (!subs.length) return;
  const byEmpresa = {};
  subs.forEach(s => { if (!byEmpresa[s.empresa]) byEmpresa[s.empresa] = []; byEmpresa[s.empresa].push(s.subscription); });
  let enviou = false;
  for (const [empresa, subscriptions] of Object.entries(byEmpresa)) {
    const dbFile = path.join(DADOS_DIR, `${empresa.toLowerCase()}.json`);
    let db = {};
    try { db = JSON.parse(fs.readFileSync(dbFile, 'utf-8')); } catch { continue; }
    const contas = (db.contas || []).filter(c => c.status === 'pendente' && c.vencimento === tomorrowStr);
    if (!contas.length) continue;
    const total = contas.reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
    const resumo = contas.slice(0, 3).map(c => `• ${c.descricao}: R$ ${parseFloat(c.valor).toFixed(2).replace('.', ',')}`).join('\n')
      + (contas.length > 3 ? `\n+${contas.length - 3} outra(s)` : '');
    const payload = JSON.stringify({
      title: `💰 ${contas.length} conta(s) vencem amanhã — ${empresa}`,
      body: `Total: R$ ${total.toFixed(2).replace('.', ',')}\n${resumo}`,
      tag: `contas-${empresa}-${tomorrowStr}`,
      url: '/',
    });
    for (const sub of subscriptions) {
      webPush.sendNotification(sub, payload).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          saveSubs(loadSubs().filter(s => s.subscription.endpoint !== sub.endpoint));
        }
      });
    }
    enviou = true;
    console.log(`[Push] Notificação enviada: ${empresa} — ${contas.length} conta(s) amanhã.`);
  }
  if (enviou) fs.writeFileSync(PUSH_SENT_FILE, JSON.stringify({ date: today }));
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } catch { return {}; }
}
function saveCache(data) {
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

function serveFile(filePath, res) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.writeHead(200);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ---- NF-e / SEFAZ helpers ----

function getNsuMap() {
  const f = path.join(CERTS_DIR, 'nsu.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return {}; }
}

function saveNsu(emp, nsu) {
  const f = path.join(CERTS_DIR, 'nsu.json');
  const m = getNsuMap();
  m[emp] = nsu;
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(m));
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

function getAllTags(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  return xml.match(re) || [];
}

function categorize(nome) {
  const n = nome.toLowerCase();
  if (/carne|frango|peixe|atum|presunto|salame|bacon|lingui|bife|costela|alcatra/.test(n)) return 'proteína';
  if (/saco|sacola|copo|prato|talher|embalagem|bandeja|alumin|guardana|canudo|descart/.test(n)) return 'descartáveis';
  if (/detergente|desinf|sanit|sabão|sabao|sabonete|esponja|vassoura|rodo|alcool|álcool|luva|limpeza/.test(n)) return 'material de limpeza';
  return 'insumos';
}

function normalizeUnit(u) {
  const up = (u || '').toUpperCase();
  if (/^(KG|KGS|G|GR|GRAMA)$/.test(up)) return 'kg';
  if (/^(L|LT|ML|LITRO|LTS)$/.test(up)) return 'L';
  return 'un';
}

function parseNFeXml(xml) {
  const g = (tag) => getTag(xml, tag);
  const emitXml = xml.match(/<emit>[\s\S]*?<\/emit>/)?.[0] || '';
  const endXml  = emitXml.match(/<enderEmit>[\s\S]*?<\/enderEmit>/)?.[0] || '';
  const fornecedor = {
    nome:     getTag(emitXml, 'xNome'),
    cnpj:     getTag(emitXml, 'CNPJ'),
    endereco: [getTag(endXml,'xLgr'),getTag(endXml,'nro'),getTag(endXml,'xBairro'),getTag(endXml,'xMun'),getTag(endXml,'UF')].filter(Boolean).join(', '),
  };
  const dets = getAllTags(xml, 'det');
  const itens = dets.map(det => {
    const prod = det.match(/<prod>[\s\S]*?<\/prod>/)?.[0] || '';
    const nome      = getTag(prod, 'xProd');
    const qtd       = parseFloat(getTag(prod, 'qCom')) || 1;
    const vUnit     = parseFloat(getTag(prod, 'vUnCom')) || 0;
    const vTotal    = parseFloat(getTag(prod, 'vProd')) || 0;
    const uCom      = getTag(prod, 'uCom') || 'un';
    return { nome, categoria: categorize(nome), unidade: normalizeUnit(uCom), quantidade: qtd, valorUnitario: vUnit, valorTotal: vTotal };
  }).filter(i => i.nome);
  const total = parseFloat(g('vNF')) || itens.reduce((s, i) => s + i.valorTotal, 0);
  // nNF: direct tag first, fallback to chNFe positions 25-34
  let nNF = g('nNF') || '';
  if (!nNF) {
    const chNFe = g('chNFe') || '';
    if (chNFe.length === 44) nNF = String(parseInt(chNFe.substring(25, 34), 10) || '');
  }
  // date: dEmi (v3) or dhEmi (v4)
  const data = (g('dEmi') || g('dhEmi') || '').substring(0, 10);
  return { fornecedor, itens, totalCompra: total, data, nNF };
}

function buildSoapEnvelope(cnpj, uf, ultNSU) {
  const nsu = String(ultNSU || 0).padStart(15, '0');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <cUF>${uf}</cUF>
      <versaoDados>1.01</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>1</tpAmb>
          <cUFAutor>${uf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${nsu}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

function sefazSync(emp) {
  return new Promise((resolve, reject) => {
    const pfxPath  = path.join(CERTS_DIR, `${emp.toLowerCase()}.pfx`);
    const keyPath  = path.join(CERTS_DIR, `${emp.toLowerCase()}_key.pem`);
    const certPath = path.join(CERTS_DIR, `${emp.toLowerCase()}_cert.pem`);

    const hasPem = fs.existsSync(keyPath) && fs.existsSync(certPath);
    const hasPfx = fs.existsSync(pfxPath);
    if (!hasPem && !hasPfx) return reject(new Error(`Certificado não encontrado para ${emp}`));

    const passphrase = process.env[`CERT_${emp}_PASS`] || '';
    const cnpj       = (process.env[`CNPJ_${emp}`] || '').replace(/\D/g, '');
    const uf         = process.env[`UF_${emp}`] || '35';

    if (!cnpj) return reject(new Error(`CNPJ_${emp} não configurado no .env`));

    const nsuMap = getNsuMap();
    // Key by CNPJ so companies sharing the same CNPJ share the same NSU counter
    const nsuKey = cnpj || emp;
    const ultNSU = nsuMap[nsuKey] ?? nsuMap[emp] ?? 0;

    const soapBody = buildSoapEnvelope(cnpj, uf, ultNSU);
    const bodyBuf  = Buffer.from(soapBody, 'utf-8');

    // Prefer PEM files (no passphrase needed); fall back to PFX
    const tlsOpts = hasPem
      ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
      : { pfx: fs.readFileSync(pfxPath), passphrase };

    const options = {
      hostname: 'www1.nfe.fazenda.gov.br',
      path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': bodyBuf.length,
        'SOAPAction': '',
      },
      ...tlsOpts,
      rejectUnauthorized: true,
      timeout: 30000,
    };

    const apiReq = https.request(options, apiRes => {
      const chunks = [];
      apiRes.on('data', c => chunks.push(c));
      apiRes.on('end', () => {
        try {
          const xml = Buffer.concat(chunks).toString('utf-8');

          // Parse SEFAZ status
          const cStat   = getTag(xml, 'cStat');
          const xMotivo = getTag(xml, 'xMotivo');
          const nsuResp = parseInt(getTag(xml, 'ultNSU')) || 0;

          console.log(`[SEFAZ ${emp}] HTTP ${apiRes.statusCode} cStat=${cStat} xMotivo=${xMotivo} ultNSU=${nsuResp}`);

          // On 656: SEFAZ includes the correct ultNSU in the response — save it so next attempt uses the right starting point
          if (cStat === '656') {
            if (nsuResp > 0 && nsuResp > (parseInt(String(ultNSU)) || 0)) {
              saveNsu(nsuKey, nsuResp);
              console.log(`[SEFAZ ${emp}] 656 → salvando ultNSU=${nsuResp} para próxima tentativa`);
            }
            return reject(new Error(`SEFAZ limitou as consultas (cStat 656). ${xMotivo}. Tente novamente em 1 hora.`));
          }
          // On 137 (no more docs): save NSU so next request continues from here
          if (cStat === '137') {
            if (nsuResp > (parseInt(ultNSU) || 0)) saveNsu(nsuKey, nsuResp);
            return resolve({ nfes: [], total: 0, ultNSU: nsuResp, cStat, xMotivo });
          }
          if (cStat && cStat !== '138') {
            return reject(new Error(`SEFAZ retornou cStat ${cStat}: ${xMotivo}`));
          }

          // Extract docZip elements (cStat 138)
          const docZipRe = /<docZip[^>]*NSU="(\d+)"[^>]*>([\s\S]*?)<\/docZip>/g;
          let match;
          const nfes = [];
          let maxNSU = nsuResp;

          while ((match = docZipRe.exec(xml)) !== null) {
            const nsu     = parseInt(match[1]);
            const b64data = match[2].trim();
            if (nsu > maxNSU) maxNSU = nsu;
            try {
              const compressed = Buffer.from(b64data, 'base64');
              const decompressed = zlib.gunzipSync(compressed).toString('utf-8');
              if (decompressed.includes('<infNFe') || decompressed.includes('<NFe')) {
                const parsed = parseNFeXml(decompressed);
                if (parsed.itens.length > 0) nfes.push({ ...parsed, nsu });
              } else if (decompressed.includes('<resNFe')) {
                // Summary document — no item detail, create a single-line entry
                const chNFe  = getTag(decompressed, 'chNFe') || '';
                const xNome  = getTag(decompressed, 'xNome') || 'Fornecedor';
                const cnpj   = getTag(decompressed, 'CNPJ')  || '';
                const vNF    = parseFloat(getTag(decompressed, 'vNF')) || 0;
                const rawDt  = getTag(decompressed, 'dhEmi') || getTag(decompressed, 'dEmi') || '';
                const data   = rawDt.substring(0, 10);
                let nNF = '';
                if (chNFe.length === 44) nNF = String(parseInt(chNFe.substring(25, 34), 10) || '');
                if (vNF > 0) {
                  nfes.push({
                    fornecedor: { nome: xNome, cnpj, endereco: '' },
                    itens: [{ nome: `NF-e ${nNF||chNFe.slice(-9)} – ${xNome}`, categoria: 'insumos', unidade: 'un', quantidade: 1, valorUnitario: vNF, valorTotal: vNF }],
                    totalCompra: vNF,
                    data,
                    nNF,
                    nsu,
                  });
                }
              }
            } catch { /* skip malformed docZip */ }
          }

          if (maxNSU > nsuResp) saveNsu(nsuKey, maxNSU);

          // Return the 10 most recent NF-es (sorted by date descending)
          const nfesOrdenadas = nfes
            .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
            .slice(0, 10);

          resolve({ nfes: nfesOrdenadas, total: nfes.length, ultNSU: maxNSU });
        } catch (e) {
          reject(new Error('Erro ao parsear resposta SEFAZ: ' + e.message));
        }
      });
    });

    apiReq.on('error', err => reject(new Error('Erro de conexão SEFAZ: ' + err.message)));
    apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('Timeout na conexão com SEFAZ')); });
    apiReq.write(bodyBuf);
    apiReq.end();
  });
}

// ---- HTTP Server ----

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];

  // IA proxy
  if (req.method === 'POST' && urlPath === '/api/scan') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const data = JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1500,
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
          });
        });
        apiReq.on('error', err => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });
        apiReq.write(data);
        apiReq.end();
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // NF-e config — which companies have certificates
  if (req.method === 'GET' && urlPath === '/api/nfe-config') {
    const config = {};
    for (const emp of ['CONFRARIA', 'SEAMA']) {
      const pfx = path.join(CERTS_DIR, `${emp.toLowerCase()}.pfx`);
      const hasCnpj = !!(process.env[`CNPJ_${emp}`]);
      config[emp] = fs.existsSync(pfx) && hasCnpj;
    }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(config));
    return;
  }

  // NSU status / manual set
  if (urlPath === '/api/nsu-status') {
    const emp = (req.url.split('?empresa=')[1]||'').split('&')[0].toUpperCase()||'CONFRARIA';
    const cnpj = (process.env[`CNPJ_${emp}`]||'').replace(/\D/g,'');
    const nsuKey = cnpj || emp;
    if (req.method === 'GET') {
      const m = getNsuMap();
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ nsu: m[nsuKey] ?? m[emp] ?? 0, nsuKey }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { nsu } = JSON.parse(body);
          const val = parseInt(nsu);
          if (isNaN(val) || val < 0) { res.writeHead(400); res.end(JSON.stringify({error:'NSU inválido'})); return; }
          saveNsu(nsuKey, val);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, nsu: val, nsuKey }));
        } catch { res.writeHead(400); res.end(JSON.stringify({error:'JSON inválido'})); }
      });
      return;
    }
  }

  // NF-e cache — GET (retorna NF-es do auto-sync)
  if (req.method === 'GET' && urlPath === '/api/nfe-cache') {
    const emp = (req.url.split('?empresa=')[1]||'').split('&')[0].toUpperCase()||'CONFRARIA';
    const cnpj = (process.env[`CNPJ_${emp}`]||'').replace(/\D/g,'');
    const key = cnpj || emp;
    const cache = loadCache();
    const entry = cache[key] || { nfes:[], timestamp:null, ultNSU:0 };
    res.setHeader('Content-Type','application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ nfes: entry.nfes||[], timestamp: entry.timestamp, ultNSU: entry.ultNSU||0 }));
    return;
  }

  // NF-e cache — remover NF-es já importadas (por lista de NSUs)
  if (req.method === 'POST' && urlPath === '/api/nfe-cache/remove') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { empresa, nsus } = JSON.parse(body);
        const cnpj = (process.env[`CNPJ_${empresa}`]||'').replace(/\D/g,'');
        const key = cnpj || empresa;
        const cache = loadCache();
        if (cache[key]) {
          cache[key].nfes = (cache[key].nfes||[]).filter(n => !(nsus||[]).includes(n.nsu));
          saveCache(cache);
        }
        res.setHeader('Content-Type','application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok:true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // NF-e sync via SEFAZ
  if (req.method === 'POST' && urlPath === '/api/nfe-sync') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { empresa, resetNsu, customNsu } = JSON.parse(body);
        if (!['CONFRARIA', 'SEAMA'].includes(empresa)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Empresa inválida' }));
          return;
        }
        const cnpjSync = (process.env[`CNPJ_${empresa}`] || '').replace(/\D/g, '');
        const nsuKeySync = cnpjSync || empresa;
        if (resetNsu) saveNsu(nsuKeySync, 0);
        else if (customNsu !== undefined && !isNaN(parseInt(customNsu))) saveNsu(nsuKeySync, parseInt(customNsu));
        const result = await sefazSync(empresa);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Push: chave pública VAPID
  if (req.method === 'GET' && urlPath === '/api/push-vapid-key') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ publicKey: VAPID_PUBLIC || null }));
    return;
  }

  // Push: salvar subscription
  if (req.method === 'POST' && urlPath === '/api/push-subscribe') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { empresa, subscription } = JSON.parse(body);
        if (!empresa || !subscription?.endpoint) { res.writeHead(400); res.end('{}'); return; }
        const subs = loadSubs().filter(s => s.subscription.endpoint !== subscription.endpoint);
        subs.push({ empresa: empresa.toUpperCase(), subscription, criadoEm: new Date().toISOString() });
        saveSubs(subs);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end('{}'); }
    });
    return;
  }

  // Push: cancelar subscription
  if (req.method === 'POST' && urlPath === '/api/push-unsubscribe') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { endpoint } = JSON.parse(body);
        saveSubs(loadSubs().filter(s => s.subscription.endpoint !== endpoint));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end('{}'); }
    });
    return;
  }

  // Push: enviar notificação de teste
  if (req.method === 'POST' && urlPath === '/api/push-test') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { empresa } = JSON.parse(body);
        if (!VAPID_PUBLIC || !VAPID_PRIVATE) { res.writeHead(503); res.end(JSON.stringify({ error: 'VAPID não configurado' })); return; }
        const subs = loadSubs().filter(s => s.empresa === (empresa||'').toUpperCase());
        if (!subs.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Nenhuma assinatura ativa para esta empresa' })); return; }
        const payload = JSON.stringify({ title: '🔔 Teste — App Gestão', body: 'Notificações funcionando! Você receberá alertas de contas a vencer.', tag: 'teste', url: '/' });
        let ok = 0;
        for (const s of subs) {
          await webPush.sendNotification(s.subscription, payload).then(() => ok++).catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) saveSubs(loadSubs().filter(x => x.subscription.endpoint !== s.subscription.endpoint));
          });
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, enviados: ok }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // Dados da empresa — GET
  if (req.method === 'GET' && urlPath.startsWith('/api/dados/')) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('null'); return; }
    const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
    try {
      const data = fs.readFileSync(file, 'utf-8');
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(data);
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end('null');
    }
    return;
  }

  // Listar backups disponíveis
  if (req.method === 'GET' && urlPath.startsWith('/api/backups/')) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('[]'); return; }
    const backDir = path.join(DADOS_DIR, 'backups', emp.toLowerCase());
    try {
      fs.mkdirSync(backDir, { recursive: true });
      const files = fs.readdirSync(backDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 48);
      const list = files.map(f => {
        const stat = fs.statSync(path.join(backDir, f));
        let preview = {};
        try {
          const d = JSON.parse(fs.readFileSync(path.join(backDir, f), 'utf-8'));
          preview = { contas: (d.contas||[]).length, vendas: (d.vendas||[]).length, compras: (d.compras||[]).length, funcionarios: (d.funcionarios||[]).length };
        } catch {}
        return { file: f, size: stat.size, mtime: stat.mtime, preview };
      });
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(list));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end('[]');
    }
    return;
  }

  // Restaurar um backup específico
  if (req.method === 'POST' && urlPath.startsWith('/api/restore/')) {
    const parts = urlPath.split('/');
    const emp = (parts[3] || '').toUpperCase();
    const fileName = parts[4] || '';
    if (!['CONFRARIA','SEAMA'].includes(emp) || !fileName) { res.writeHead(400); res.end('{}'); return; }
    const backFile = path.join(DADOS_DIR, 'backups', emp.toLowerCase(), fileName);
    const mainFile = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
    try {
      const data = fs.readFileSync(backFile, 'utf-8');
      JSON.parse(data);
      fs.writeFileSync(mainFile, data);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end('{"ok":true}');
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Dados da empresa — POST (salvar)
  if (req.method === 'POST' && urlPath.startsWith('/api/dados/')) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        // Rotating backup: keep last 48 backups (hourly over 2 days)
        const backDir = path.join(DADOS_DIR, 'backups', emp.toLowerCase());
        fs.mkdirSync(backDir, { recursive: true });
        if (fs.existsSync(file)) {
          try {
            const existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
            const existingContas = (existing.contas||[]).length;
            const incomingContas = (incoming.contas||[]).length;
            const existingVendas = (existing.vendas||[]).length;
            const incomingVendas = (incoming.vendas||[]).length;
            // If incoming data has significantly fewer records than current, save a safety backup
            if (existingContas > 5 && incomingContas === 0 || existingVendas > 5 && incomingVendas === 0) {
              const safetyFile = path.join(backDir, `safety_${Date.now()}.json`);
              fs.writeFileSync(safetyFile, fs.readFileSync(file));
              console.warn(`[Backup] SAFETY backup criado para ${emp}: contas ${existingContas}->${incomingContas} vendas ${existingVendas}->${incomingVendas}`);
            }
            // Regular rotating backup every ~1h (check if last backup is older than 30min)
            const backups = fs.readdirSync(backDir).filter(f => f.endsWith('.json') && !f.startsWith('safety_')).sort();
            const lastBack = backups[backups.length - 1];
            const lastTs = lastBack ? parseInt(lastBack.replace('backup_','').replace('.json','')) : 0;
            if (Date.now() - lastTs > 30 * 60 * 1000) {
              const backFile = path.join(backDir, `backup_${Date.now()}.json`);
              fs.writeFileSync(backFile, fs.readFileSync(file));
              // Keep only last 48 regular backups
              const allBackups = fs.readdirSync(backDir).filter(f => f.startsWith('backup_')).sort();
              if (allBackups.length > 48) {
                allBackups.slice(0, allBackups.length - 48).forEach(f => {
                  try { fs.unlinkSync(path.join(backDir, f)); } catch {}
                });
              }
            }
          } catch {}
        }
        fs.writeFileSync(file, body);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Health check
  if (urlPath === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', apiKey: API_KEY ? 'ok' : 'AUSENTE', uptime: process.uptime() }));
    return;
  }

  // Logos (persiste entre builds)
  if (urlPath.startsWith('/logos/')) {
    const logoFile = path.join(LOGOS_DIR, urlPath.replace('/logos/', ''));
    if (fs.existsSync(logoFile)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return serveFile(logoFile, res);
    }
    res.writeHead(404); res.end('Logo not found'); return;
  }

  // Static files from dist/
  const filePath = path.join(DIST, urlPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (urlPath.includes('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
    return serveFile(filePath, res);
  }

  // SPA fallback
  const indexPath = path.join(DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    return serveFile(indexPath, res);
  }

  res.writeHead(503);
  res.end('App not built. Run: npm run build');
});

// ---- Auto-sync SEFAZ (background, every 65 minutes) ----

async function autoSyncSEFAZ() {
  const processed = new Set();
  for (const emp of ['CONFRARIA', 'SEAMA']) {
    const pfxPath  = path.join(CERTS_DIR, `${emp.toLowerCase()}.pfx`);
    const keyPath  = path.join(CERTS_DIR, `${emp.toLowerCase()}_key.pem`);
    const hasCert  = (fs.existsSync(pfxPath) || fs.existsSync(keyPath)) && process.env[`CNPJ_${emp}`];
    if (!hasCert) continue;
    const cnpj = (process.env[`CNPJ_${emp}`]||'').replace(/\D/g,'');
    const key  = cnpj || emp;
    if (processed.has(key)) { console.log(`[AutoSync] ${emp}: mesmo CNPJ de empresa anterior, pulando.`); continue; }
    processed.add(key);
    console.log(`[AutoSync] Iniciando sync SEFAZ para ${emp} (CNPJ key: ${key})...`);
    try {
      const result = await sefazSync(emp);
      const cache = loadCache();
      const existing = cache[key]?.nfes || [];
      const existingNsus = new Set(existing.map(n => n.nsu));
      const novas = (result.nfes||[]).filter(n => !existingNsus.has(n.nsu));
      const merged = [...novas, ...existing]
        .sort((a,b) => (b.data||'').localeCompare(a.data||''))
        .slice(0, 50);
      cache[key] = { nfes: merged, timestamp: new Date().toISOString(), ultNSU: result.ultNSU, empresa: emp };
      saveCache(cache);
      if (novas.length > 0) {
        console.log(`[AutoSync] ${emp}: ${novas.length} nova(s) NF-e(s) adicionada(s) ao cache. Total: ${merged.length}.`);
      } else {
        console.log(`[AutoSync] ${emp}: nenhuma NF-e nova (ultNSU=${result.ultNSU}).`);
      }
    } catch (e) {
      if (e.message && e.message.includes('656')) {
        console.log(`[AutoSync] ${emp}: rate limit SEFAZ (656). Tentará novamente no próximo ciclo.`);
      } else {
        console.error(`[AutoSync] ${emp}: erro — ${e.message}`);
      }
    }
  }
}

server.listen(PORT, () => {
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`API Key: ${API_KEY ? '✅ configurada' : '❌ AUSENTE (IA desabilitada)'}`);
  for (const emp of ['CONFRARIA', 'SEAMA']) {
    const pfx = path.join(CERTS_DIR, `${emp.toLowerCase()}.pfx`);
    const cnpj = process.env[`CNPJ_${emp}`];
    console.log(`NF-e ${emp}: ${fs.existsSync(pfx) && cnpj ? '✅ certificado OK' : '⚠️  sem certificado'}`);
  }
  // Start auto-sync: first run 15s after startup, then every 65 minutes
  setTimeout(() => autoSyncSEFAZ(), 15000);
  setInterval(() => autoSyncSEFAZ(), 65 * 60 * 1000);
  console.log('[AutoSync] Agendado: 15s após start, depois a cada 65 minutos.');
  // Push notifications: verificar a cada hora (envia entre 7h–9h)
  setInterval(() => checkPushNotifications(), 60 * 60 * 1000);
  setTimeout(() => checkPushNotifications(), 5000);
});
