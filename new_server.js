import http from 'http';
import https from 'https';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import webPush from 'web-push';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import { mergeDocument } from './mergeDocument.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env: read file directly from script directory, override empty vars
const _envFile = path.join(__dirname, '.env');
if (fs.existsSync(_envFile)) {
  fs.readFileSync(_envFile, 'utf-8').split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx < 1 || line.trimStart().startsWith('#')) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (val) process.env[key] = val;
  });
}
try { await import('dotenv/config'); } catch {}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DIST = path.join(__dirname, 'dist');
const LOGOS_DIR = path.join(__dirname, 'logos');
const CERTS_DIR = path.join(__dirname, 'certs');
const DADOS_DIR = path.join(__dirname, 'dados');
const BANNERS_DIR = path.join(DADOS_DIR, 'banners');

// Token de serviço (JWT admin do PDV) usado pra proxiar rotas de catálogo e
// estoque — ver getServiceToken() e as rotas /api/menu-produtos*,
// /api/menu-categorias* e /api/estoque-pdv* mais abaixo. Um cache por
// empresa: CONFRARIA e SEAMA são dois backends diferentes, cada um com seu
// próprio JWT.
const _serviceTokens = { CONFRARIA: { token: null, expiry: 0 }, SEAMA: { token: null, expiry: 0 } };
const CACHE_FILE = path.join(CERTS_DIR, 'sefaz_cache.json');
fs.mkdirSync(DADOS_DIR, { recursive: true });
fs.mkdirSync(BANNERS_DIR, { recursive: true });

// ===== CARDÁPIO TV =====
// Fica FORA do documento principal (dados/<empresa>.json), de propósito: aquele
// arquivo já passa de 1-3MB e é lido/gravado a cada sync de qualquer aparelho
// logado — embutir imagem teria feito o mesmo problema de performance que o
// endpoint /versao (linha ~1966) existe pra evitar. Metadado dos banners é um
// JSON pequeno à parte; a imagem em si vira arquivo estático em BANNERS_DIR.
function cardapioTvFile(emp) {
  return path.join(DADOS_DIR, `cardapio_tv_${emp.toLowerCase()}.json`);
}
// Formato atual: { telas: [{id,nome,banners}] } — várias TVs por empresa, cada
// uma com seu próprio conjunto de banners. Documentos salvos antes disso
// tinham só { banners: [] } direto; migra em memória pra uma tela "TV1" na
// leitura, sem precisar reescrever o arquivo nem quebrar quem já tinha link
// salvo na TV.
function loadCardapioTv(emp) {
  let data;
  try { data = JSON.parse(fs.readFileSync(cardapioTvFile(emp), 'utf-8')); } catch { data = { telas: [] }; }
  if (!Array.isArray(data.telas)) {
    data = { telas: Array.isArray(data.banners) ? [{ id: 'tv1', nome: 'TV1', banners: data.banners }] : [] };
  }
  return data;
}
function encontrarTela(data, telaId) {
  return data.telas.find(t => t.id === telaId) || data.telas[0] || null;
}

// Server-Sent Events: cada TV aberta mantém uma conexão HTTP viva aqui dentro.
// Quando o painel salva a lista de banners, escrevemos direto nessas conexões
// — a TV recebe o aviso na hora, em vez de esperar o próximo poll de 5min
// (que continua existindo como rede de segurança, caso o canal caia).
const sseClients = { CONFRARIA: new Set(), SEAMA: new Set() };
function broadcastCardapioTv(emp) {
  for (const res of sseClients[emp] || []) {
    try { res.write('data: refresh\n\n'); } catch { sseClients[emp].delete(res); }
  }
}

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
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
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

function setRateLimit(emp, minutes) {
  const f = path.join(CERTS_DIR, 'nsu.json');
  const m = getNsuMap();
  m[`rateLimitUntil_${emp}`] = Date.now() + minutes * 60 * 1000;
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(m));
}

function isRateLimited(emp) {
  const m = getNsuMap();
  const until = m[`rateLimitUntil_${emp}`];
  if (!until) return false;
  if (Date.now() < until) {
    const minLeft = Math.ceil((until - Date.now()) / 60000);
    console.log(`[AutoSync] ${emp}: rate limit ativo por mais ${minLeft}min — pulando.`);
    return true;
  }
  return false;
}

function decodeXmlEntities(s) {
  // Uma passada só não basta quando o emissor da nota já grava o nome
  // com escape duplo (ex: "M.A. SILVA &amp;amp; SILVA LTDA" no XML) — sobra
  // um "&amp;" literal depois de decodificar uma vez. Repete até não sobrar
  // entidade nenhuma (teto de 5 voltas, só por segurança contra XML malformado).
  let out = s;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
    if (next === out) break;
    out = next;
  }
  return out;
}
function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeXmlEntities(m[1].trim()) : '';
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

function parseNFeXml(rawXml) {
  let xml = rawXml.replace(/\sxmlns(:[a-zA-Z0-9]+)?="[^"]*"/g, '');
  xml = xml.replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');
  const g = (tag) => getTag(xml, tag);
  const emitXml = xml.match(/<emit>[\s\S]*?<\/emit>/)?.[0] || '';
  const endXml  = emitXml.match(/<enderEmit>[\s\S]*?<\/enderEmit>/)?.[0] || '';
  const fornecedor = {
    nome:     getTag(emitXml, 'xNome'),
    cnpj:     getTag(emitXml, 'CNPJ'),
    endereco: [getTag(endXml,'xLgr'),getTag(endXml,'nro'),getTag(endXml,'xBairro'),getTag(endXml,'xMun'),getTag(endXml,'UF')].filter(Boolean).join(', '),
  };
  let dets = getAllTags(xml, 'det');
  // Fallback: try with exec loop if match() returned nothing (large XML edge case)
  if (!dets.length) {
    const detRe = /<det[^>]*>[\s\S]*?<\/det>/g;
    let dm;
    while ((dm = detRe.exec(xml)) !== null) dets.push(dm[0]);
  }
  const itens = dets.map(det => {
    // Try <prod>...</prod> first, then look for xProd directly in det
    const prod = det.match(/<prod>[\s\S]*?<\/prod>/)?.[0] || det;
    const nome      = getTag(prod, 'xProd');
    const qtd       = parseFloat(getTag(prod, 'qCom')) || 1;
    const vUnit     = parseFloat(getTag(prod, 'vUnCom')) || 0;
    const vTotal    = parseFloat(getTag(prod, 'vProd')) || 0;
    const uCom      = getTag(prod, 'uCom') || 'un';
    return { nome, categoria: categorize(nome), unidade: normalizeUnit(uCom), quantidade: qtd, valorUnitario: vUnit, valorTotal: vTotal };
  }).filter(i => i.nome);
  if (!itens.length && dets.length) {
    console.log(`[parseNFeXml] ⚠️ ${dets.length} det(s) encontrados mas 0 itens extraídos — possível problema de namespace. XML início: ${rawXml.slice(0,300)}`);
  }
  const totalBlock = xml.match(/<ICMSTot>[\s\S]*?<\/ICMSTot>/)?.[0] || '';
  const total = parseFloat(totalBlock ? getTag(totalBlock, 'vNF') : g('vNF')) || itens.reduce((s, i) => s + i.valorTotal, 0);
  // chNFe: from infNFe Id attribute (NFe + 44 digits) or explicit tag
  const chNFeAttr = (xml.match(/Id="NFe(\d{44})"/) || [])[1] || '';
  const chNFe = chNFeAttr || g('chNFe') || '';
  const modelo = chNFe.length >= 22 ? chNFe.substring(20, 22) : '55';
  // nNF: direct tag first, fallback to chNFe positions 25-34
  let nNF = g('nNF') || '';
  if (!nNF && chNFe.length === 44) nNF = String(parseInt(chNFe.substring(25, 34), 10) || '');
  // date: dEmi (v3) or dhEmi (v4)
  const data = (g('dEmi') || g('dhEmi') || '').substring(0, 10);
  // Forma de pagamento: <pag> > <detPag> > <tPag>
  const tPagMap = {"01":"dinheiro","02":"dinheiro","03":"cartão crédito","04":"cartão débito","05":"dinheiro","10":"dinheiro","11":"dinheiro","14":"boleto","15":"boleto","16":"pix","17":"pix","18":"pix","99":"dinheiro"};
  const detPagBlock = xml.match(/<detPag>[\s\S]*?<\/detPag>/)?.[0] || '';
  const tPag = getTag(detPagBlock, 'tPag');
  const formaPag = tPagMap[tPag] || '';
  // Vencimento: <cobr> > <dup> > <dVenc>
  const dupBlock = xml.match(/<dup>[\s\S]*?<\/dup>/)?.[0] || '';
  const dVenc = getTag(dupBlock, 'dVenc') || '';
  return { fornecedor, itens, totalCompra: total, data, nNF, chNFe, modelo, formaPag, dVenc, rawXml: rawXml };
}

function buildChaveEnvelope(cnpj, uf, chNFe) {
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
          <consChNFe>
            <chNFe>${chNFe}</chNFe>
          </consChNFe>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

function sefazFetchByChave(emp, chNFe) {
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
    if (!cnpj) return reject(new Error(`CNPJ_${emp} não configurado`));
    const soapBody = buildChaveEnvelope(cnpj, uf, chNFe);
    const bodyBuf  = Buffer.from(soapBody, 'utf-8');
    const tlsOpts  = hasPem
      ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
      : { pfx: fs.readFileSync(pfxPath), passphrase };
    const options = {
      hostname: 'www1.nfe.fazenda.gov.br',
      path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': bodyBuf.length, 'SOAPAction': '' },
      ...tlsOpts, rejectUnauthorized: true, timeout: 30000,
    };
    console.log(`[SEFAZ ${emp}] Buscando NF-e por chave ...${chNFe.slice(-8)}`);
    const apiReq = https.request(options, apiRes => {
      const chunks = [];
      apiRes.on('data', c => chunks.push(c));
      apiRes.on('end', () => {
        try {
          let xml = Buffer.concat(chunks).toString('utf-8');
          xml = xml.replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');
          const cStat = getTag(xml, 'cStat');
          const xMotivo = getTag(xml, 'xMotivo');
          console.log(`[SEFAZ ${emp}] fetchByChave ...${chNFe.slice(-8)}: cStat=${cStat} ${xMotivo}`);
          if (cStat === '137') return reject(new Error('SEFAZ ainda não disponibilizou a NF-e completa (cStat 137). Tente novamente em alguns minutos.'));
          if (cStat === '656') return reject(new Error(`SEFAZ limitou consultas (cStat 656). ${xMotivo}. Aguarde 1 hora.`));
          if (cStat && cStat !== '138') return reject(new Error(`SEFAZ cStat ${cStat}: ${xMotivo}`));
          const docZipRe = /<docZip[^>]*>([\s\S]*?)<\/docZip>/g;
          let match;
          let resumoData = null;
          while ((match = docZipRe.exec(xml)) !== null) {
            try {
              const decompressed = zlib.gunzipSync(Buffer.from(match[1].trim(), 'base64')).toString('utf-8');
              if (decompressed.includes('<infNFe') || decompressed.includes('<NFe') || decompressed.includes('<procNFe') || decompressed.includes('<nfeProc')) {
                const parsed = parseNFeXml(decompressed);
                if ((parsed.itens || []).length > 0) {
                  console.log(`[SEFAZ ${emp}] ✅ NF-e completa ...${chNFe.slice(-8)}: ${parsed.itens.length} itens`);
                  return resolve({ ...parsed, tipoDoc: 'completo' });
                }
                // Full NF-e XML found but 0 items — parsing may have failed; resolve to avoid silent drop
                console.log(`[SEFAZ ${emp}] ⚠️ NF-e completa encontrada mas 0 itens extraídos ...${chNFe.slice(-8)}`);
                return resolve({ ...parsed, tipoDoc: 'completo', itens: [] });
              }
              if (decompressed.includes('<resNFe')) {
                const cleanRes = decompressed.replace(/\sxmlns(:[a-zA-Z0-9]+)?="[^"]*"/g, '').replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');
                resumoData = {
                  fornecedor: { nome: getTag(cleanRes, 'xNome') || 'Fornecedor', cnpj: getTag(cleanRes, 'CNPJ') || '', endereco: '' },
                  itens: [], totalCompra: parseFloat(getTag(cleanRes, 'vNF')) || 0,
                  data: (getTag(cleanRes, 'dhEmi') || getTag(cleanRes, 'dEmi') || '').substring(0, 10),
                  chNFe, tipoDoc: 'resumo',
                };
              }
            } catch {}
          }
          if (resumoData) {
            console.log(`[SEFAZ ${emp}] ⚠️ NF-e ...${chNFe.slice(-8)}: apenas resumo disponível (manifestação pode estar pendente)`);
            return reject(new Error('SEFAZ retornou apenas resumo. A manifestação foi enviada mas a NF-e completa ainda não está disponível. Tente novamente em 5-10 minutos.'));
          }
          reject(new Error('NF-e não encontrada na resposta SEFAZ. Tente novamente em alguns minutos.'));
        } catch (e) { reject(new Error('Erro ao parsear: ' + e.message)); }
      });
    });
    apiReq.on('error', err => reject(new Error('Conexão SEFAZ: ' + err.message)));
    apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('Timeout SEFAZ')); });
    apiReq.write(bodyBuf);
    apiReq.end();
  });
}

// ===== MANIFESTAÇÃO DO DESTINATÁRIO (Ciência da Operação) =====

function ensurePemFiles(emp) {
  const keyPath  = path.join(CERTS_DIR, `${emp.toLowerCase()}_key.pem`);
  const certPath = path.join(CERTS_DIR, `${emp.toLowerCase()}_cert.pem`);
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return { keyPath, certPath };
  const pfxPath = path.join(CERTS_DIR, `${emp.toLowerCase()}.pfx`);
  if (!fs.existsSync(pfxPath)) return null;
  const pass = process.env[`CERT_${emp}_PASS`] || '';
  try {
    execSync(`openssl pkcs12 -in "${pfxPath}" -nocerts -nodes -out "${keyPath}" -passin pass:"${pass}" 2>/dev/null`);
    execSync(`openssl pkcs12 -in "${pfxPath}" -nokeys -out "${certPath}" -passin pass:"${pass}" 2>/dev/null`);
    console.log(`[SEFAZ ${emp}] PEM extraído do PFX ✅`);
    return { keyPath, certPath };
  } catch (e) {
    console.error(`[SEFAZ ${emp}] Falha ao extrair PEM do PFX: ${e.message}`);
    return null;
  }
}

function getX509CertBase64(certPem) {
  const certs = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  if (!certs.length) return '';
  return certs[0].replace(/-----BEGIN CERTIFICATE-----/,'').replace(/-----END CERTIFICATE-----/,'').replace(/\s/g,'');
}

let _signDebug = {};
function buildManifestacaoSoap(cnpj, uf, chNFe, privateKeyPem, certPem, tpAmb = '1') {
  const tpEvento   = '210210';
  const nSeqEvento = '1';
  const evId       = `ID${tpEvento}${chNFe}0${nSeqEvento}`;

  // Hora de Brasília (UTC-3)
  const _d = new Date();
  const dhEvento = new Date(_d.getTime() - 3 * 3600 * 1000)
    .toISOString().replace(/\.\d{3}Z$/, '-03:00');

  const infEventoXml =
    `<infEvento Id="${evId}">` +
    `<cOrgao>91</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${chNFe}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>` +
    `</infEvento>`;

  const eventoXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEventoXml}</evento>`;

  const certBase64 = getX509CertBase64(certPem);

  // Assinatura via xml-crypto (implementação real de C14N/XMLDSig) em vez de
  // string concatenada à mão — a versão manual anterior travava a SEFAZ com
  // "Object reference not set to an instance of an object" antes de qualquer
  // cStat, indicando rejeição da assinatura em si.
  //
  // Ainda assim a SEFAZ continuava devolvendo o mesmo "Object reference not
  // set to an instance of an object" pra toda manifestação. A assinatura
  // usava RSA-SHA1/SHA1 — algoritmo que a Nota Técnica 2016.002 depreciou;
  // o ambiente nacional exige RSA-SHA256/SHA256 pra eventos há anos, e
  // rejeita SHA1 com esse mesmo erro genérico em vez de um cStat limpo.
  //
  // CAUSA RAIZ DE VERDADE (achada comparando com a implementação original,
  // commit 3ecf9d9 de 21/jun — antes de qualquer uma dessas tentativas —
  // que assinava com crypto.createSign() puro e USAVA CANONICALIZAÇÃO
  // EXCLUSIVA): esta versão com xml-crypto trocou pra canonicalização
  // NORMAL/INCLUSIVA (REC-xml-c14n-20010315). Os dois métodos só divergem
  // quando o trecho assinado (aqui, <infEvento>) acaba embutido dentro de
  // um documento maior com namespaces extras herdados de fora — que é
  // exatamente o nosso caso: assinamos o <evento> isolado, mas ele vai
  // parar dentro do <soap12:Envelope>, com xmlns:xsi/xsd/soap12 herdados.
  // Canonicalização inclusiva puxa esses namespaces herdados na hora de
  // RECONFERIR a assinatura (já dentro do envelope completo) — mudando o
  // digest calculado e invalidando a assinatura sem qualquer coisa errada
  // no conteúdo em si. Exclusiva ignora namespace herdado não usado
  // dentro do próprio trecho, existe EXATAMENTE pra evitar esse problema
  // em assinatura "enveloped" — e é o que a NF-e exige por especificação.
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: `#${evId}`,
  });
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
  sig.computeSignature(eventoXml, {
    location: { reference: "//*[local-name(.)='infEvento']", action: 'after' },
  });
  const eventoAssinado = sig.getSignedXml();

  // Autoverificação: reconfere a própria assinatura antes de mandar pra
  // SEFAZ, com o MESMO xml-crypto — não pode confiar que "computeSignature
  // não jogou erro" significa "assinatura válida". Se isto der falso, o
  // problema é na geração em si, não em como o log/terminal mostrou depois.
  try {
    const verifyDoc = new DOMParser().parseFromString(eventoAssinado, 'text/xml');
    const sigNode = verifyDoc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
    const verificador = new SignedXml({ publicCert: certPem });
    verificador.loadSignature(sigNode);
    const autoOk = verificador.checkSignature(eventoAssinado);
    console.log(`[SEFAZ] Autoverificação da assinatura (${chNFe.slice(-8)}): ${autoOk ? '✅ válida' : '❌ INVÁLIDA'}`);
    if (!autoOk) console.log(`[SEFAZ] Autoverificação — erros: ${JSON.stringify(verificador.validationErrors)}`);
  } catch (ve) {
    console.log(`[SEFAZ] Autoverificação lançou exceção: ${ve.message}`);
  }

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>1</idLote>` +
    eventoAssinado +
    `</envEvento>`;

  _signDebug = { method: 'xml-crypto', evId };

  // cUF é a UF da empresa que está chamando o serviço (ex: 35 = SP) — igual
  // buildChaveEnvelope() já faz pra consulta. Estava fixo em "91" (código do
  // Ambiente Nacional, correto pra cOrgao dentro do evento, mas não pro cUF
  // do cabeçalho): o parâmetro uf chegava até aqui e nunca era usado —
  // candidato real pro "Object reference not set" que a manifestação sempre
  // devolvia mesmo já com assinatura em SHA-256 e sem o header redundante.
  const cabec = `<nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><cUF>${uf}</cUF><versaoDados>1.00</versaoDados></nfeCabecMsg>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Header>${cabec}</soap12:Header>` +
    `<soap12:Body>` +
    `<nfeRecepcaoEventoNF xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `<nfeDadosMsg>${envEvento}</nfeDadosMsg>` +
    `</nfeRecepcaoEventoNF>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function sefazManifestar(emp, chNFe) {
  return new Promise((resolve, reject) => {
    const pem = ensurePemFiles(emp);
    if (!pem) return reject(new Error(`Certificado PEM não disponível para ${emp}. Verifique o .pfx e openssl.`));
    const pfxPath  = path.join(CERTS_DIR, `${emp.toLowerCase()}.pfx`);
    const passphrase = process.env[`CERT_${emp}_PASS`] || '';
    const cnpj = (process.env[`CNPJ_${emp}`] || '').replace(/\D/g, '');
    const uf   = process.env[`UF_${emp}`] || '35';
    if (!cnpj) return reject(new Error(`CNPJ_${emp} não configurado`));
    const privateKeyPem = fs.readFileSync(pem.keyPath, 'utf-8');
    const certPem = fs.readFileSync(pem.certPath, 'utf-8');
    const soapBody = buildManifestacaoSoap(cnpj, uf, chNFe, privateKeyPem, certPem);
    console.log(`[SEFAZ ${emp}] DEBUG envelope enviado (manifestação ${chNFe.slice(-8)}): ${soapBody}`);
    const bodyBuf = Buffer.from(soapBody, 'utf-8');
    const hasPem = fs.existsSync(pem.keyPath) && fs.existsSync(pem.certPath);
    const tlsOpts = hasPem
      ? { key: fs.readFileSync(pem.keyPath), cert: fs.readFileSync(pem.certPath) }
      : { pfx: fs.readFileSync(pfxPath), passphrase };
    const options = {
      hostname: 'www.nfe.fazenda.gov.br',
      path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
      method: 'POST',
      // SOAP 1.2 leva a action só no parâmetro do Content-Type — mandar TAMBÉM
      // o header SOAPAction (convenção do SOAP 1.1) é redundante e, testando
      // contra a Receita, sobra como candidato pra explicar o "Object
      // reference not set" que a manifestação sempre devolvia mesmo com a
      // assinatura já em SHA-256. Consulta por chave nunca manda esse header
      // e funciona normalmente — alinhando aqui com o que já funciona lá.
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF"', 'Content-Length': bodyBuf.length },
      ...tlsOpts, rejectUnauthorized: true, timeout: 30000,
    };
    console.log(`[SEFAZ ${emp}] Manifestando ciência para NF-e ${chNFe.slice(-8)}...`);
    const apiReq = https.request(options, apiRes => {
      const chunks = [];
      apiRes.on('data', c => chunks.push(c));
      apiRes.on('end', () => {
        try {
          let xml = Buffer.concat(chunks).toString('utf-8');
          xml = xml.replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');
          const cStatEvento = getTag(xml, 'cStat');
          const xMotivo = getTag(xml, 'xMotivo');
          console.log(`[SEFAZ ${emp}] Manifestação ${chNFe.slice(-8)}: cStat=${cStatEvento} ${xMotivo}`);
          if (!cStatEvento) console.log(`[SEFAZ ${emp}] DEBUG resposta bruta (sem cStat): ${xml.slice(0, 1500)}`);
          if (['135','573'].includes(cStatEvento)) {
            resolve({ ok: true, cStat: cStatEvento, xMotivo });
          } else {
            reject(new Error(`Manifestação cStat ${cStatEvento}: ${xMotivo}`));
          }
        } catch (e) { reject(new Error('Erro ao parsear resposta manifestação: ' + e.message)); }
      });
    });
    apiReq.on('error', err => reject(new Error('Conexão SEFAZ manifestação: ' + err.message)));
    apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('Timeout SEFAZ manifestação')); });
    apiReq.write(bodyBuf);
    apiReq.end();
  });
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

function sefazDistDFe(emp) {
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
    const nsuKey = cnpj || emp;
    const ultNSU = nsuMap[nsuKey] ?? nsuMap[emp] ?? 0;

    const soapBody = buildSoapEnvelope(cnpj, uf, ultNSU);
    const bodyBuf  = Buffer.from(soapBody, 'utf-8');

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
          let xml = Buffer.concat(chunks).toString('utf-8');
          xml = xml.replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');

          const cStat   = getTag(xml, 'cStat');
          const xMotivo = getTag(xml, 'xMotivo');
          const nsuResp = parseInt(getTag(xml, 'ultNSU')) || 0;

          console.log(`[SEFAZ ${emp}] HTTP ${apiRes.statusCode} cStat=${cStat} xMotivo=${xMotivo} ultNSU=${nsuResp}`);

          if (cStat === '656') {
            if (nsuResp > 0 && nsuResp > (parseInt(String(ultNSU)) || 0)) {
              saveNsu(nsuKey, nsuResp);
              console.log(`[SEFAZ ${emp}] 656 → salvando ultNSU=${nsuResp} para próxima tentativa`);
            }
            return reject(new Error(`SEFAZ limitou as consultas (cStat 656). ${xMotivo}. Tente novamente em 1 hora.`));
          }
          if (cStat === '137') {
            if (nsuResp > (parseInt(ultNSU) || 0)) saveNsu(nsuKey, nsuResp);
            return resolve({ nfes: [], total: 0, ultNSU: nsuResp, cStat, xMotivo });
          }
          if (cStat && cStat !== '138') {
            return reject(new Error(`SEFAZ retornou cStat ${cStat}: ${xMotivo}`));
          }

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
                if (parsed.itens.length > 0) nfes.push({ ...parsed, nsu, tipoDoc: 'completo' });
              } else if (decompressed.includes('<resNFe')) {
                const cleanRes = decompressed.replace(/\sxmlns(:[a-zA-Z0-9]+)?="[^"]*"/g, '').replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');
                const chNFe  = getTag(cleanRes, 'chNFe') || '';
                const xNome  = getTag(cleanRes, 'xNome') || 'Fornecedor';
                const cnpjDoc = getTag(cleanRes, 'CNPJ') || '';
                const vNF    = parseFloat(getTag(cleanRes, 'vNF')) || 0;
                const rawDt  = getTag(cleanRes, 'dhEmi') || getTag(cleanRes, 'dEmi') || '';
                const data   = rawDt.substring(0, 10);
                let nNF = '';
                const modelo = chNFe.length >= 22 ? chNFe.substring(20, 22) : '55';
                if (chNFe.length === 44) nNF = String(parseInt(chNFe.substring(25, 34), 10) || '');
                if (vNF > 0) {
                  nfes.push({
                    fornecedor: { nome: xNome, cnpj: cnpjDoc, endereco: '' },
                    itens: [],
                    totalCompra: vNF,
                    data, nNF, chNFe, modelo, nsu, tipoDoc: 'resumo',
                  });
                }
              }
            } catch { /* skip malformed docZip */ }
          }

          if (maxNSU > nsuResp) saveNsu(nsuKey, maxNSU);

          const nfesOrdenadas = nfes
            .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

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

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── Ciclo de vida de uma NF-e recebida ────────────────────────────────
//
// O distDFe entrega, pra nota em que somos destinatários, só o `resNFe` — um
// resumo com fornecedor, valor e chave, SEM os itens. O XML completo (`nfeProc`)
// só é liberado depois da manifestação do destinatário. E o detalhe que derruba
// a maioria das integrações: o completo NÃO volta na mesma consulta nem na
// mesma chave — ele reaparece como um NSU NOVO, numa varredura posterior,
// minutos ou horas depois.
//
// A versão anterior manifestava, esperava 5 SEGUNDOS e consultava por chave.
// A SEFAZ processa a manifestação de forma assíncrona, então a consulta caía
// em cStat 137 (nada localizado) e nada voltava pra tentar de novo — por isso
// 17 de 17 notas ficaram eternamente em resumo.
//
// Agora cada nota tem estado persistido e o trabalho é dividido entre ciclos:
//   novo            → resumo recém-chegado, ainda não manifestado
//   aguardando_xml  → manifestação aceita; o completo chega numa varredura futura
//   completo        → XML com itens em mãos
//   sem_manifestacao→ NFC-e (modelo 65), que não tem manifestação nem distribuição
//   erro_manifestacao → a SEFAZ recusou; o cStat fica gravado pra diagnóstico
// Teto por ciclo: a cota da SEFAZ é limitada e estourá-la (cStat 656) bloqueia
// a varredura inteira por uma hora. O que sobrar vai no ciclo seguinte.
const MANIFESTACOES_POR_CICLO = 10;

function ehNFCe(chNFe) {
  return String(chNFe || '').length >= 22 && String(chNFe).substring(20, 22) === '65';
}

function estadoInicial(nota) {
  if (nota.tipoDoc === 'completo') return 'completo';
  return ehNFCe(nota.chNFe) ? 'sem_manifestacao' : 'novo';
}

// Funde o que chegou da varredura com o que já estava no cache, casando por
// CHAVE — não por NSU. É isso que permite o completo, que chega num NSU novo,
// substituir o resumo antigo em vez de virar uma segunda linha da mesma nota.
function fundirNotas(existentes, chegando) {
  const porChave = new Map();
  for (const n of existentes) {
    // Nota que entrou no cache ANTES da máquina de estados existir não tem
    // `estado`. Sem carimbar aqui, ela não casa com 'novo' nem com nada, então
    // manifestarPendentes nunca a enxerga e ela fica em resumo pra sempre — foi
    // exatamente o que prendeu as 25 notas (log: estados {"?":25}, 0
    // manifestações, ciclo após ciclo). Só o ramo de nota NOVA aplicava
    // estadoInicial; o de nota já conhecida passava direto.
    const comEstado = n.estado ? n : { ...n, estado: estadoInicial(n), manifestacao: n.manifestacao || null };
    porChave.set(n.chNFe || `nsu:${n.nsu}`, comEstado);
  }

  for (const nova of chegando) {
    const chave = nova.chNFe || `nsu:${nova.nsu}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { ...nova, estado: estadoInicial(nova), manifestacao: null });
      continue;
    }
    // Promoção resumo → completo: preserva o histórico de manifestação e o NSU
    // original, que é por onde o usuário reconhece a nota na tela.
    if (nova.tipoDoc === 'completo' && atual.tipoDoc !== 'completo') {
      porChave.set(chave, {
        ...nova,
        nsu: atual.nsu,
        estado: 'completo',
        manifestacao: atual.manifestacao || null,
        nsuCompleto: nova.nsu,
      });
    }
  }
  return [...porChave.values()].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}

// Manifesta o que ainda não foi manifestado e GRAVA o resultado por nota.
// Gravar o cStat é o que tira essa etapa da invisibilidade: sem isso, uma
// assinatura recusada some no log e a nota fica em resumo pra sempre sem
// ninguém saber por quê.
async function manifestarPendentes(emp, notas) {
  const pendentes = notas.filter(n => n.estado === 'novo' && n.chNFe && n.chNFe.length === 44);
  if (!pendentes.length) return { enviadas: 0, aceitas: 0, recusadas: 0 };

  const alvo = pendentes.slice(0, MANIFESTACOES_POR_CICLO);
  let aceitas = 0, recusadas = 0;
  console.log(`[SEFAZ ${emp}] ${pendentes.length} nota(s) a manifestar; processando ${alvo.length} neste ciclo.`);

  for (const nota of alvo) {
    const fim = nota.chNFe.slice(-8);
    try {
      await delay(1200);
      const r = await sefazManifestar(emp, nota.chNFe);
      const cStat = String(r?.cStat || '');
      nota.manifestacao = { cStat, xMotivo: r?.xMotivo || '', em: new Date().toISOString() };
      // 135 = evento registrado · 573 = já manifestada antes (idempotente, e o
      // efeito prático é o mesmo: o XML já está liberado)
      if (cStat === '135' || cStat === '573') {
        nota.estado = 'aguardando_xml';
        aceitas++;
        console.log(`[SEFAZ ${emp}] ✅ manifestada ...${fim} (cStat ${cStat})`);
      } else {
        nota.estado = 'erro_manifestacao';
        recusadas++;
        console.log(`[SEFAZ ${emp}] ⚠️ manifestação recusada ...${fim}: cStat ${cStat} ${r?.xMotivo || ''}`);
      }
    } catch (e) {
      // A rejeição vem como "Manifestação cStat 573: ...". Extrair o código é o
      // que transforma "deu erro" em diagnóstico: 573 é benigno (já manifestada),
      // enquanto uma recusa de assinatura aparece com código próprio — ou sem
      // código nenhum, que é o sintoma de envelope rejeitado antes do processamento.
      const msg = e.message || String(e);
      const cStat = (msg.match(/cStat\s*(\d{3})/) || [])[1] || '';
      nota.manifestacao = { cStat, xMotivo: msg, em: new Date().toISOString() };
      if (cStat === '573') { nota.estado = 'aguardando_xml'; aceitas++; }
      else { nota.estado = 'erro_manifestacao'; recusadas++; }
      console.log(`[SEFAZ ${emp}] manifestação ...${fim}: ${msg}`);
    }
  }
  return { enviadas: alvo.length, aceitas, recusadas };
}

// Uma varredura só traz até 50 documentos. Com fila acumulada, parar na
// primeira chamada deixaria o resto pra daqui a uma hora. Enquanto a SEFAZ
// responde 138 (há documentos) as chamadas seguidas são permitidas — o que
// consome cota indevidamente é insistir quando não há nada novo.
const MAX_VARREDURAS_POR_CICLO = 8;

async function sefazVarrerTudo(emp) {
  const todas = [];
  let ultimo = null;
  let erroParcial = null;
  for (let i = 0; i < MAX_VARREDURAS_POR_CICLO; i++) {
    let r;
    try {
      r = await sefazDistDFe(emp);
    } catch (e) {
      // O throw abortava a varredura inteira e `todas` era descartado junto —
      // mas o ultNSU ja tinha sido gravado dentro de sefazDistDFe. Resultado:
      // documentos consumidos, NSU avancado, nada guardado. E a SEFAZ nao
      // reenvia NSU ja consumido, entao as notas se perdiam de vez.
      //
      // Aconteceu de verdade em 27/08/2026: uma varredura andou de NSU 0 ate
      // 483 e salvou ZERO notas, porque um lote no meio respondeu cStat 656.
      //
      // Agora o erro interrompe o laco mas nao descarta o que ja veio: sobe
      // como erroParcial pra quem chamou tratar DEPOIS de salvar o cache.
      erroParcial = e;
      break;
    }
    ultimo = r;
    const qtd = (r.nfes || []).length;
    todas.push(...(r.nfes || []));
    if (!qtd) break;                 // cStat 137 ou lote vazio: acabou a fila
    await delay(1500);
  }
  return { nfes: todas, total: todas.length, ultNSU: ultimo?.ultNSU || 0, erroParcial };
}

async function sefazSync(emp) {
  return sefazVarrerTudo(emp);
}

// Resolve segredo/URL de cada PDV. Cada um tem seu próprio backend — a
// Confraria reaproveita o GESTAO_SERVICE_SECRET (mesmo segredo já usado nas
// rotas de catálogo); o Seama usa SEAMA_SERVICE_SECRET (mesmo valor que
// SERVICE_SECRET no .env do seama-backend — nomes diferentes, mesmo segredo).
function pdvDaEmpresa(emp) {
  const e = String(emp || 'SEAMA').toUpperCase();
  if (e === 'CONFRARIA') return {
    secret: process.env.GESTAO_SERVICE_SECRET,
    base: process.env.CONFRARIA_PDV_URL || 'https://pedidos.confrariacafe.com',
    envVar: 'GESTAO_SERVICE_SECRET',
  };
  return {
    secret: process.env.SEAMA_SERVICE_SECRET,
    base: process.env.SEAMA_PDV_URL || 'https://seama.confrariacafe.com',
    envVar: 'SEAMA_SERVICE_SECRET',
  };
}

// Obtém (e cacheia, por empresa) um JWT admin do PDV certo, pra proxiar rotas
// de catálogo e estoque sem precisar de login de usuário real.
async function getServiceToken(empresa) {
  const emp = String(empresa || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
  const cache = _serviceTokens[emp];
  if (cache.token && Date.now() < cache.expiry) return cache.token;
  const alvo = pdvDaEmpresa(emp);
  if (!alvo.secret) throw new Error(`${alvo.envVar} não configurado neste servidor`);
  const r = await fetch(`${alvo.base}/api/service-token`, { method: 'POST', headers: { 'x-service-secret': alvo.secret } });
  if (!r.ok) throw new Error(`Falha ao obter token de serviço do PDV ${emp} (HTTP ${r.status})`);
  const data = await r.json();
  cache.token = data.token;
  cache.expiry = Date.now() + Math.max(0, (data.expiresIn || 3600) - 60) * 1000; // renova 1min antes de expirar
  return cache.token;
}

// ---- Estoque PDV: normalizadores ----
// Confraria (delivery-backend) e Seama (seama-backend) têm APIs de estoque
// com nomes de campo diferentes (stock_qty/estoque, stock_min/minimo,
// category_name/categoria...) — essas funções traduzem os dois formatos pro
// mesmo shape, pra tela do Gestão não precisar saber qual PDV está por trás.

function normalizarListaEstoque(empresa, j) {
  if (empresa === 'CONFRARIA') {
    return {
      itens: (j.itens || []).map(i => ({
        id: i.id, nome: i.name, categoria: i.category_name || null,
        saldo: i.stock_qty, minimo: i.stock_min, abaixoMinimo: i.abaixo_do_minimo,
      })),
      abaixo: j.abaixo || 0,
    };
  }
  const itens = j.itens || [];
  return {
    itens: itens.map(i => ({
      id: i.id, nome: i.name, categoria: i.categoria || null,
      saldo: i.estoque, minimo: i.minimo, abaixoMinimo: i.abaixoMinimo,
      giroDia: i.giroDia, cobertura: i.cobertura, sugestaoCompra: i.sugestaoCompra,
    })),
    abaixo: itens.filter(i => i.abaixoMinimo).length,
    giroDias: j.giroDias,
  };
}

function normalizarFolhaInventario(empresa, j) {
  if (empresa === 'CONFRARIA') {
    return (Array.isArray(j) ? j : []).map(p => ({
      id: p.id, nome: p.name, categoria: p.category_name || null, saldoAtual: p.stock_qty,
    }));
  }
  return (j.itens || []).map(p => ({
    id: p.id, nome: p.name, categoria: p.categoria || null, saldoAtual: p.estoque,
  }));
}

// ---- IA (Anthropic) — helper compartilhado com retry, usado por /api/scan e pelas rotas de conciliação de produtos ----
function anthropicComplete({ system, userText, maxTokens = 2048 }) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) { reject(new Error('Chave da API não configurada no servidor. Configure ANTHROPIC_API_KEY no .env da VPS.')); return; }
    const bodyData = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    });
    const callAnthropic = (data) => new Promise((res2, rej2) => {
      const options = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(data) },
      };
      const apiReq = https.request(options, apiRes => {
        let result = '';
        apiRes.on('data', c => result += c);
        apiRes.on('end', () => res2({ status: apiRes.statusCode, body: result }));
      });
      apiReq.on('error', err => rej2(err));
      apiReq.setTimeout(60000, () => { apiReq.destroy(); rej2(new Error('TIMEOUT')); });
      apiReq.write(data);
      apiReq.end();
    });
    (async () => {
      const MAX_RETRIES = 3;
      const RETRY_CODES = [429, 500, 502, 503, 529];
      let lastStatus = 0, lastBody = '';
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const resp = await callAnthropic(bodyData);
          lastStatus = resp.status; lastBody = resp.body;
          if (resp.status === 200) {
            try {
              const parsed = JSON.parse(resp.body);
              const text = (parsed.content || []).map(c => c.text || '').join('');
              resolve(text);
            } catch (e) { reject(new Error('Resposta da IA inválida: ' + e.message)); }
            return;
          }
          if (!RETRY_CODES.includes(resp.status) || attempt === MAX_RETRIES) break;
          let retryAfter = 2000 * attempt;
          try { const p = JSON.parse(resp.body); if (p?.error?.type === 'rate_limit_error') retryAfter = Math.max(retryAfter, 5000); } catch {}
          await new Promise(r => setTimeout(r, retryAfter));
        } catch (netErr) {
          lastStatus = netErr.message === 'TIMEOUT' ? 504 : 500;
          lastBody = JSON.stringify({ error: netErr.message === 'TIMEOUT' ? 'Timeout: a IA demorou demais para responder.' : `Erro de rede: ${netErr.message}` });
          if (attempt === MAX_RETRIES) break;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      let errMsg = '';
      try {
        const parsed = JSON.parse(lastBody);
        const errObj = parsed?.error;
        if (errObj) {
          const errType = errObj.type || '';
          if (errType === 'authentication_error') errMsg = 'Chave da API inválida ou expirada.';
          else if (errType === 'rate_limit_error') errMsg = 'Limite de requisições da IA excedido. Aguarde alguns minutos.';
          else if (errType === 'overloaded_error' || lastStatus === 529) errMsg = 'Servidor da IA sobrecarregado. Tente novamente em alguns minutos.';
          else errMsg = errObj.message || JSON.stringify(errObj);
        }
      } catch {}
      if (!errMsg) errMsg = lastStatus === 504 ? 'Timeout: a IA demorou demais para responder.' : `Erro do servidor da IA (HTTP ${lastStatus}).`;
      reject(new Error(errMsg));
    })();
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
    req.on('data', chunk => { body += chunk; if (body.length > 30 * 1024 * 1024) { res.writeHead(413); res.end(JSON.stringify({error:'Imagem muito grande. Reduza o tamanho antes de enviar.'})); req.destroy(); } });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const msgs = [...(payload.messages || [])].filter(m => m.role !== 'assistant');
        if (!API_KEY) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Chave da API não configurada no servidor. Configure ANTHROPIC_API_KEY no .env da VPS.' }));
          return;
        }

        const SYSTEM_PROMPT = `Você é um OCR especialista em cupons fiscais brasileiros (CF-e SAT, NFC-e, NF-e). Sua ÚNICA tarefa é ler a imagem/texto e retornar um JSON com os dados extraídos.

FORMATO DE SAÍDA OBRIGATÓRIO — retorne SOMENTE este JSON, sem texto extra, sem markdown:
{
  "fornecedor": {"nome": "...", "cnpj": "...", "endereco": "..."},
  "itens": [{"nome": "...", "categoria": "...", "unidade": "un", "quantidade": 1, "valorUnitario": 10.00, "valorTotal": 10.00}],
  "totalCompra": 0.00,
  "data": "YYYY-MM-DD",
  "formaPagamento": "dinheiro",
  "dataVencimento": "YYYY-MM-DD"
}

COMO LER O CUPOM:
- Cada linha de produto normalmente segue: [código] NOME PRODUTO [qtd] [unidade] x [valor_unit] [valor_total]
- Separe corretamente: "2,500 KG x 15,90" → quantidade=2.5, unidade="kg", valorUnitario=15.90
- "1 UN x 18,90" → quantidade=1, unidade="un", valorUnitario=18.90
- Se a imagem está borrada ou com baixa resolução, use o contexto para inferir o texto
- Extraia TODOS os itens visíveis, um por um, sem pular nenhum
- IGNORE: TOTAL, SUBTOTAL, TROCO, DESCONTO, código de barras — NÃO são produtos

NOMES DE PRODUTOS:
- Use nomes genéricos SEM marca comercial
- "farinha de trigo" (não "Farinha Dona Benta"), "queijo muçarela" (não "Queijo Polenghi")
- Mantenha descritores úteis: "açúcar cristal 5kg", "leite integral 1L"

CATEGORIAS (use exatamente uma):
carnes | hortifruti | laticínios | grãos | farinhas | massas | temperos | proteína | bebidas | polpas | mercearia básica | cafés e complementos | chocolates | latas caixas e temperos | molhos | material de limpeza | descartáveis | embalagens | insumos | outros

DATA — OBRIGATÓRIO extrair:
- Procure a data de emissão no cupom (geralmente no topo ou rodapé)
- Formatos comuns: "22/06/2026", "22/06/26", "2026-06-22", "DATA: 22/06/2026"
- Converta para YYYY-MM-DD. Se ano com 2 dígitos (ex: "26"), use "2026"
- Se não encontrar, use null

FORMA DE PAGAMENTO — OBRIGATÓRIO extrair:
- Procure seções: "FORMA PGTO", "PAGAMENTO", "F.PAGTO", "FORMA DE PAGAMENTO", "Pgto"
- Mapeamento: CREDITO/CRÉDITO/CRED → "cartão crédito", DEBITO/DÉBITO/DEB → "cartão débito", PIX/QR CODE → "pix", BOLETO/FATURA → "boleto", DINHEIRO/ESPECIE → "dinheiro", FIADO/PRAZO → "fiado"
- Se não encontrar info de pagamento, use "dinheiro"
- dataVencimento: use a data de emissão; se for boleto/fiado/crédito, procure data de vencimento

Se algum campo estiver ilegível, use 0 ou "". Nunca invente valores.`;

        const callAnthropic = (bodyData) => new Promise((resolve, reject) => {
          const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': API_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Length': Buffer.byteLength(bodyData)
            }
          };
          const apiReq = https.request(options, apiRes => {
            let result = '';
            apiRes.on('data', chunk => result += chunk);
            apiRes.on('end', () => resolve({ status: apiRes.statusCode, body: result }));
          });
          apiReq.on('error', err => reject(err));
          apiReq.setTimeout(90000, () => { apiReq.destroy(); reject(new Error('TIMEOUT')); });
          apiReq.write(bodyData);
          apiReq.end();
        });

        const imgSize = JSON.stringify(msgs).length;
        console.log(`[IA] Recebida requisição de scan — payload: ${(imgSize/1024).toFixed(0)}KB, msgs: ${msgs.length}`);

        const data = JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: msgs
        });

        const MAX_RETRIES = 3;
        const RETRY_CODES = [429, 500, 502, 503, 529];
        let lastStatus = 0;
        let lastBody = '';

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const resp = await callAnthropic(data);
            lastStatus = resp.status;
            lastBody = resp.body;

            if (resp.status === 200) {
              res.setHeader('Content-Type', 'application/json');
              res.writeHead(200);
              res.end(resp.body);
              return;
            }

            if (!RETRY_CODES.includes(resp.status) || attempt === MAX_RETRIES) break;

            let retryAfter = 2000 * attempt;
            try {
              const parsed = JSON.parse(resp.body);
              if (parsed?.error?.type === 'rate_limit_error') {
                retryAfter = Math.max(retryAfter, 5000);
              }
            } catch {}
            console.log(`[IA] Tentativa ${attempt}/${MAX_RETRIES} falhou (HTTP ${resp.status}), retry em ${retryAfter}ms`);
            await new Promise(r => setTimeout(r, retryAfter));
          } catch (netErr) {
            lastStatus = netErr.message === 'TIMEOUT' ? 504 : 500;
            lastBody = JSON.stringify({ error: netErr.message === 'TIMEOUT' ? 'Timeout: a IA demorou demais para responder (90s).' : `Erro de rede: ${netErr.message}` });
            if (attempt === MAX_RETRIES) break;
            console.log(`[IA] Tentativa ${attempt}/${MAX_RETRIES} erro de rede: ${netErr.message}, retry em ${2000 * attempt}ms`);
            await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }

        res.setHeader('Content-Type', 'application/json');
        let errMsg = '';
        try {
          const parsed = JSON.parse(lastBody);
          const errObj = parsed?.error;
          if (errObj) {
            const errType = errObj.type || '';
            const errText = errObj.message || JSON.stringify(errObj);
            if (errType === 'authentication_error') errMsg = 'Chave da API inválida ou expirada. Verifique ANTHROPIC_API_KEY no .env da VPS.';
            else if (errType === 'rate_limit_error') errMsg = 'Limite de requisições excedido. Aguarde alguns minutos e tente novamente.';
            else if (errType === 'overloaded_error' || lastStatus === 529) errMsg = 'Servidor da IA sobrecarregado. Tente novamente em alguns minutos.';
            else if (errType === 'invalid_request_error') errMsg = `Requisição inválida: ${errText}`;
            else errMsg = errText;
          }
        } catch {}
        if (!errMsg) {
          if (lastStatus === 504) errMsg = 'Timeout: a IA demorou demais para responder.';
          else if (lastStatus === 401) errMsg = 'Chave da API inválida. Verifique ANTHROPIC_API_KEY no .env da VPS.';
          else errMsg = `Erro do servidor da IA (HTTP ${lastStatus}). Tente novamente.`;
        }
        console.log(`[IA] Falha final: HTTP ${lastStatus} — ${errMsg}`);
        res.writeHead(lastStatus >= 400 ? lastStatus : 500);
        res.end(JSON.stringify({ error: errMsg }));
      } catch (e) {
        console.log(`[IA] Erro ao processar requisição: ${e.message}`);
        res.writeHead(400);
        res.end(JSON.stringify({ error: `Erro ao processar requisição: ${e.message}` }));
      }
    });
    return;
  }

  // IA: sugerir vínculo de itens não conciliados com o catálogo já cadastrado (usado na tela de conciliação de import)
  if (req.method === 'POST' && urlPath === '/api/ia-sugerir-conciliacao') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { itens, catalogo } = JSON.parse(body);
        if (!Array.isArray(itens) || !itens.length || !Array.isArray(catalogo) || !catalogo.length) {
          res.setHeader('Content-Type', 'application/json'); res.writeHead(200); res.end(JSON.stringify({ sugestoes: [] })); return;
        }
        const system = `Você ajuda a reconciliar nomes de produtos de notas fiscais/cupons com um catálogo interno já cadastrado. Vários fornecedores usam marcas ou grafias diferentes para o MESMO produto (ex: "Choc. Confraria 250g" e "Chocolate Garoto 250g" podem ser o mesmo item se o restaurante considera qualquer chocolate desse tipo como um único produto de estoque).

Para cada item da lista "itens", decida se ele é o MESMO produto que algum item do "catalogo" (apenas marca/grafia diferente), ou se é genuinamente um produto novo/diferente.

Seja CONSERVADOR: só vincule quando tiver bastante confiança de que é o mesmo tipo de produto. Produtos de categorias claramente diferentes NUNCA são o mesmo item. Na dúvida, não vincule.

Responda APENAS com um JSON no formato:
{"sugestoes":[{"nome":"<nome exato do item de entrada>","catalogoId":"<id do catálogo ou null>","confianca":"alta|media"}]}`;
        const userText = `CATÁLOGO (id — nome — categoria):\n${catalogo.map(c => `${c.id} — ${c.nome} — ${c.categoria || ''}`).join('\n')}\n\nITENS A CONCILIAR:\n${itens.map(i => `${i.nome} — ${i.categoria || ''}`).join('\n')}`;
        const text = await anthropicComplete({ system, userText, maxTokens: 2048 });
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { sugestoes: [] };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(parsed));
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // IA: varrer catálogo já cadastrado em busca de produtos duplicados (marcas/grafias diferentes do mesmo item)
  if (req.method === 'POST' && urlPath === '/api/ia-sugerir-agrupamentos') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { catalogo } = JSON.parse(body);
        if (!Array.isArray(catalogo) || catalogo.length < 2) {
          res.setHeader('Content-Type', 'application/json'); res.writeHead(200); res.end(JSON.stringify({ grupos: [] })); return;
        }
        const system = `Você analisa um catálogo de matérias-primas de um restaurante/confeitaria em busca de produtos DUPLICADOS — o mesmo tipo de produto cadastrado mais de uma vez com marcas ou grafias diferentes (ex: "Chocolate Garoto 250g" e "Choc. Confraria 250g" sendo o mesmo tipo de item pro estoque do restaurante).

Seja MUITO CONSERVADOR: só agrupe itens que você tem certeza razoável de que são o mesmo tipo de produto para fins de estoque. Produtos parecidos mas de categorias/usos diferentes (ex: "farinha de trigo" e "farinha de rosca") NÃO são o mesmo item. Não invente grupos — se nada parecer duplicado, retorne uma lista vazia.

Responda APENAS com um JSON no formato:
{"grupos":[{"nomeSugerido":"<nome final do produto unificado>","ids":["<id1>","<id2>", "..."],"motivo":"<breve explicação>"}]}
Cada grupo deve ter pelo menos 2 ids. Um id só pode aparecer em um grupo.`;
        const userText = `CATÁLOGO (id — nome — categoria — unidade):\n${catalogo.map(c => `${c.id} — ${c.nome} — ${c.categoria || ''} — ${c.unidade || ''}`).join('\n')}`;
        const text = await anthropicComplete({ system, userText, maxTokens: 4096 });
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { grupos: [] };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(parsed));
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // IA status — test API key with a real call
  if (req.method === 'GET' && urlPath === '/api/ia-status') {
    res.setHeader('Content-Type', 'application/json');
    if (!API_KEY) {
      res.writeHead(200);
      res.end(JSON.stringify({ configured: false, error: 'ANTHROPIC_API_KEY não configurada no .env' }));
      return;
    }
    const testData = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Responda apenas: OK' }]
    });
    const testReq = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(testData)
      }
    }, apiRes => {
      let result = '';
      apiRes.on('data', chunk => result += chunk);
      apiRes.on('end', () => {
        if (apiRes.statusCode === 200) {
          res.writeHead(200);
          res.end(JSON.stringify({ configured: true, status: 'ok', model: 'claude-sonnet-4-6' }));
        } else {
          let errDetail = '';
          try { errDetail = JSON.parse(result)?.error?.message || result.slice(0, 200); } catch { errDetail = result.slice(0, 200); }
          console.log(`[IA-TEST] Falha: HTTP ${apiRes.statusCode} — ${errDetail}`);
          res.writeHead(200);
          res.end(JSON.stringify({ configured: true, status: 'error', httpCode: apiRes.statusCode, error: errDetail }));
        }
      });
    });
    testReq.on('error', err => {
      console.log(`[IA-TEST] Erro de rede: ${err.message}`);
      res.writeHead(200);
      res.end(JSON.stringify({ configured: true, status: 'network_error', error: err.message }));
    });
    testReq.setTimeout(15000, () => {
      testReq.destroy();
      res.writeHead(200);
      res.end(JSON.stringify({ configured: true, status: 'timeout', error: 'Timeout ao conectar com api.anthropic.com' }));
    });
    testReq.write(testData);
    testReq.end();
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

  // NF-e cache — limpar todas as NF-es de uma empresa
  if (req.method === 'POST' && urlPath === '/api/nfe-cache/clear') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { empresa } = JSON.parse(body);
        const cnpj = (process.env[`CNPJ_${empresa}`]||'').replace(/\D/g,'');
        const key = cnpj || empresa;
        const cache = loadCache();
        if (cache[key]) { cache[key].nfes = []; saveCache(cache); }
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

  // Provisiona login do PDV (delivery-backend) a partir do cadastro de usuários
  // daqui — o segredo compartilhado fica só neste backend, nunca no navegador.
  if (req.method === 'POST' && urlPath === '/api/pdv-user') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { name, password } = JSON.parse(body);
        if (!name || !password) { res.writeHead(400); res.end(JSON.stringify({ error: 'Nome e senha são obrigatórios' })); return; }
        const secret = process.env.PDV_PROVISION_SECRET;
        if (!secret) { res.writeHead(500); res.end(JSON.stringify({ error: 'PDV_PROVISION_SECRET não configurado neste servidor' })); return; }
        const base = process.env.DELIVERY_BACKEND_URL || 'http://localhost:4000';
        const upstream = await fetch(`${base}/api/pdv-provision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-provision-secret': secret },
          body: JSON.stringify({ name, password }),
        });
        const data = await upstream.json().catch(() => ({}));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(upstream.status);
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao provisionar login do PDV: ' + e.message }));
      }
    });
    return;
  }

  // ── Compra → estoque do PDV Seama ────────────────────────────────────
  // Proxy autenticado por segredo de serviço: o navegador nunca vê a
  // credencial, só fala com este backend. O PDV é a fonte da verdade do
  // estoque dos itens de revenda; aqui a compra só é empurrada pra lá.
  // Cada PDV tem seu próprio segredo e endereço (pdvDaEmpresa, definida no
  // escopo do módulo — também usada por getServiceToken() e pelo proxy de
  // estoque mais abaixo).

  if (req.method === 'POST' && urlPath === '/api/seama-estoque') {
    // Buffer[] em vez de string += : concatenar Buffers como string corrompe
    // caractere multibyte (nome de item com acento) partido entre dois
    // pacotes TCP — essa rota é por onde toda compra chega no PDV, então um
    // nome corrompido aqui nasce errado na fila de vínculos pendentes do
    // PDV, e nunca mais casa com o nome original (mesmo bug já corrigido em
    // outro lugar deste arquivo).
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const { empresa, origin_id, supplier, items } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (!origin_id || !Array.isArray(items) || !items.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'origin_id e items são obrigatórios' })); return;
        }
        const alvo = pdvDaEmpresa(empresa);
        const secret = alvo.secret;
        if (!secret) { res.writeHead(500); res.end(JSON.stringify({ error: alvo.envVar + ' não configurado neste servidor' })); return; }
        const base = alvo.base;
        const upstream = await fetch(`${base}/api/supply/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-service-secret': secret },
          body: JSON.stringify({ origin_id, supplier, items }),
        });
        const data = await upstream.json().catch(() => ({}));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(upstream.status);
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao enviar compra pro PDV: ' + e.message }));
      }
    });
    return;
  }

  // Estorno: nota (ou item) excluída no Gestão, ou movida pra outra empresa.
  // Sem isso o estoque do PDV fica maior que a realidade e só aparece na
  // contagem física.
  if (req.method === 'POST' && urlPath === '/api/seama-estorno') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const { empresa, origin_id, items } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (!origin_id) { res.writeHead(400); res.end(JSON.stringify({ error: 'origin_id é obrigatório' })); return; }
        const alvo = pdvDaEmpresa(empresa);
        const secret = alvo.secret;
        if (!secret) { res.writeHead(500); res.end(JSON.stringify({ error: alvo.envVar + ' não configurado neste servidor' })); return; }
        const base = alvo.base;
        const upstream = await fetch(`${base}/api/supply/purchase/reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-service-secret': secret },
          body: JSON.stringify({ origin_id, items }),
        });
        const data = await upstream.json().catch(() => ({}));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(upstream.status);
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao estornar no PDV: ' + e.message }));
      }
    });
    return;
  }

  // ── Faturamento do dia vindo do PDV ──────────────────────────────────
  // Caminho inverso da ponte de compras: o PDV fecha o caixa e manda o
  // resultado do dia, para a DRE deixar de depender de alguém lembrar de
  // digitar o faturamento de ontem.
  // Consumação de colaborador vinda do PDV: o fiado que ele levou no mês vira
  // desconto na folha. A tela de RH já somava consumações no holerite — isso
  // aqui só para de exigir que alguém digite uma a uma.
  if (req.method === 'POST' && urlPath === '/api/consumacao-pdv') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const secret = process.env.SEAMA_SERVICE_SECRET;
        if (!secret) { res.writeHead(503); res.end(JSON.stringify({ error: 'Integração não configurada' })); return; }
        if (req.headers['x-service-secret'] !== secret) {
          res.writeHead(401); res.end(JSON.stringify({ error: 'Credencial de serviço inválida' })); return;
        }

        const { empresa, funcionarioId, nome, mes, valor, descricao } = JSON.parse(body);
        const emp = String(empresa || '').toUpperCase();
        if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end(JSON.stringify({ error: 'empresa inválida' })); return; }
        if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) { res.writeHead(400); res.end(JSON.stringify({ error: 'mes inválido (use AAAA-MM)' })); return; }
        const v = parseFloat(valor);
        if (!Number.isFinite(v) || v <= 0) { res.writeHead(400); res.end(JSON.stringify({ error: 'valor inválido' })); return; }

        const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
        const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
        const funcs = Array.isArray(doc.funcionarios) ? doc.funcionarios : [];

        // Resolve por id primeiro; sem id, casa pelo nome ignorando acento e
        // caixa. Recusar em vez de criar funcionário: gente cadastrada por
        // engano vira linha em folha de pagamento.
        const limpar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        let func = funcionarioId ? funcs.find(f => f && f.id === funcionarioId) : null;
        if (!func && nome) {
          const iguais = funcs.filter(f => f && limpar(f.nome) === limpar(nome));
          if (iguais.length > 1) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: `Há ${iguais.length} funcionários chamados "${nome}" na Gestão. Vincule pelo cadastro para o desconto ir na pessoa certa.` }));
            return;
          }
          func = iguais[0];
        }
        if (!func) {
          res.writeHead(404);
          res.end(JSON.stringify({
            error: `Funcionário "${nome || funcionarioId}" não encontrado na Gestão`,
            disponiveis: funcs.map(f => f && f.nome).filter(Boolean),
          }));
          return;
        }

        // Id estável por funcionário e mês: reenviar ATUALIZA em vez de somar.
        // O merge do documento é por id, então isso vale também quando a tela
        // do Gestão estiver aberta em outra máquina.
        const cons = Array.isArray(doc.consumacoes) ? doc.consumacoes : [];
        const id = `pdv-cons-${func.id}-${mes}`;
        const agora = new Date().toISOString();
        const i = cons.findIndex(c => c && c.id === id);
        const reg = {
          id,
          funcionarioId: func.id,
          data: `${mes}-01`,
          mes,
          valor: v,
          descricao: descricao || `Fiado do PDV — ${mes}`,
          origem: 'pdv',
          criadoEm: i >= 0 ? (cons[i].criadoEm || agora) : agora,
          atualizadoEm: agora,
        };
        if (i >= 0) cons[i] = reg; else cons.unshift(reg);

        doc.consumacoes = cons;
        fs.writeFileSync(file, JSON.stringify(doc));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, acao: i >= 0 ? 'atualizado' : 'criado', funcionario: func.nome, mes, valor: v }));
      } catch (e) {
        console.error('[consumacao-pdv]', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao registrar consumação: ' + e.message }));
      }
    });
    return;
  }

  // Sangria categorizada feita no PDV (Seama ou Confraria) vira conta paga
  // aqui, direto em Financeiro > Contas — mesmo padrão de /api/consumacao-pdv:
  // grava direto no arquivo da empresa, id estável (pdv-sangria-<movimentoId>)
  // pra reenvio atualizar em vez de duplicar.
  if (req.method === 'POST' && urlPath === '/api/sangria-pdv') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const secret = process.env.SEAMA_SERVICE_SECRET;
        if (!secret) { res.writeHead(503); res.end(JSON.stringify({ error: 'Integração não configurada' })); return; }
        if (req.headers['x-service-secret'] !== secret) {
          res.writeHead(401); res.end(JSON.stringify({ error: 'Credencial de serviço inválida' })); return;
        }

        const { empresa, categoria, valor, motivo, data, movimentoId } = JSON.parse(body);
        const emp = String(empresa || '').toUpperCase();
        if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end(JSON.stringify({ error: 'empresa inválida' })); return; }
        const v = parseFloat(valor);
        if (!Number.isFinite(v) || v <= 0) { res.writeHead(400); res.end(JSON.stringify({ error: 'valor inválido' })); return; }
        if (!categoria) { res.writeHead(400); res.end(JSON.stringify({ error: 'categoria é obrigatória' })); return; }
        if (!movimentoId) { res.writeHead(400); res.end(JSON.stringify({ error: 'movimentoId é obrigatório' })); return; }

        const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
        const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
        const contas = Array.isArray(doc.contas) ? doc.contas : [];
        const id = `pdv-sangria-${movimentoId}`;
        const agora = new Date().toISOString();
        const i = contas.findIndex(c => c && c.id === id);
        const reg = {
          id,
          descricao: motivo || `Sangria PDV — ${categoria}`,
          categoria,
          valor: v,
          vencimento: data || agora.slice(0, 10),
          status: 'pago',
          tipo: 'saida',
          formaPag: 'dinheiro',
          origem: 'sangria_pdv',
          criadoEm: i >= 0 ? (contas[i].criadoEm || agora) : agora,
          atualizadoEm: agora,
        };
        if (i >= 0) contas[i] = reg; else contas.unshift(reg);
        doc.contas = contas;
        fs.writeFileSync(file, JSON.stringify(doc));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, acao: i >= 0 ? 'atualizado' : 'criado', categoria, valor: v }));
      } catch (e) {
        console.error('[sangria-pdv]', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao registrar sangria: ' + e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/venda-pdv') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        // Log de toda chamada recebida — antes disso, um 401/503 (segredo errado/
        // ausente) não deixava rastro nenhum, então não dava pra saber se o PDV
        // sequer estava tentando chamar este endpoint ou se as tentativas
        // falhavam silenciosamente na autenticação.
        console.log(`[venda-pdv] recebido de ${req.socket.remoteAddress} — secret ${req.headers['x-service-secret'] ? 'presente' : 'AUSENTE'}`);
        const secret = process.env.SEAMA_SERVICE_SECRET;
        if (!secret) { console.error('[venda-pdv] 503 — SEAMA_SERVICE_SECRET não configurado no .env do servidor'); res.writeHead(503); res.end(JSON.stringify({ error: 'Integração não configurada' })); return; }
        if (req.headers['x-service-secret'] !== secret) {
          console.error('[venda-pdv] 401 — credencial enviada pelo PDV não bate com SEAMA_SERVICE_SECRET');
          res.writeHead(401); res.end(JSON.stringify({ error: 'Credencial de serviço inválida' })); return;
        }

        const { empresa, data, dinheiro, maquininha, delivery, total, porHora } = JSON.parse(body);
        const emp = String(empresa || '').toUpperCase();
        if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end(JSON.stringify({ error: 'empresa inválida' })); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) { res.writeHead(400); res.end(JSON.stringify({ error: 'data inválida' })); return; }

        const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
        // Opcional — só o PDV Seama manda isso por enquanto. Item fora do
        // formato esperado (hora 0-23, valor numérico) é descartado em vez
        // de derrubar a requisição inteira.
        const porHoraLimpo = Array.isArray(porHora)
          ? porHora
              .filter(h => h && Number.isInteger(h.hora) && h.hora >= 0 && h.hora <= 23)
              .map(h => ({ hora: h.hora, valor: num(h.valor) }))
          : [];
        const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
        const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
        const vendas = Array.isArray(doc.vendas) ? doc.vendas : [];
        const agora = new Date().toISOString();

        // Idempotência por data: reenviar o mesmo dia ATUALIZA a linha. Sem
        // isso, dois fechamentos no mesmo dia (dois turnos, ou uma retentativa)
        // dobrariam o faturamento do mês em silêncio.
        // origem:"pdv" separa o que veio daqui do que foi digitado à mão — uma
        // venda lançada manualmente na tela nunca é sobrescrita por este envio.
        const i = vendas.findIndex(v => v && v.data === data && v.origem === 'pdv');
        const reg = {
          id: i >= 0 ? vendas[i].id : `pdv-${emp.toLowerCase()}-${data}`,
          data,
          total: num(total),
          maquininha: num(maquininha),
          dinheiro: num(dinheiro),
          ifood: 0, ifoodTaxa: 0, ifoodLiq: 0,
          '99food': 0, nfoodTaxa: 0, nfoodLiq: 0,
          // Só a Confraria manda isso por enquanto (delivery-backend/gestaoSync.js) —
          // o PDV Seama não separa delivery, então chega undefined e cai no 0.
          delivery: num(delivery),
          porHora: porHoraLimpo,
          origem: 'pdv',
          criadoEm: i >= 0 ? (vendas[i].criadoEm || agora) : agora,
          atualizadoEm: agora,
        };
        if (i >= 0) vendas[i] = reg; else vendas.unshift(reg);

        doc.vendas = vendas;
        fs.writeFileSync(file, JSON.stringify(doc));
        console.log(`[venda-pdv] OK — ${emp} ${data}: total=${reg.total} (${i >= 0 ? 'atualizado' : 'criado'})`);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, acao: i >= 0 ? 'atualizado' : 'criado', data, total: reg.total }));
      } catch (e) {
        console.error('[venda-pdv]', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao registrar venda do PDV: ' + e.message }));
      }
    });
    return;
  }

  // ── Catálogo real (produtos/categorias) — Confraria e Seama ───────────
  // Proxy autenticado por token de serviço — o navegador nunca vê o JWT
  // nem o segredo, só fala com este backend. Empresa vem sempre em query
  // string (?empresa=), inclusive em POST/PATCH/DELETE, pra não precisar
  // ler o corpo antes de saber pra qual PDV mandar.
  if (
    (req.method === 'GET' && (urlPath === '/api/menu-produtos' || urlPath === '/api/menu-categorias' || urlPath === '/api/pdv-destaques')) ||
    (req.method === 'POST' && (urlPath === '/api/menu-produtos' || urlPath === '/api/menu-categorias' || urlPath === '/api/menu-produtos/upload' || urlPath === '/api/pdv-destaques')) ||
    (req.method === 'PATCH' && (urlPath.startsWith('/api/menu-produtos/') || urlPath.startsWith('/api/menu-categorias/') || urlPath.startsWith('/api/pdv-destaques/'))) ||
    (req.method === 'DELETE' && (urlPath.startsWith('/api/menu-produtos/') || urlPath.startsWith('/api/pdv-destaques/')))
  ) {
    const isUpload = urlPath === '/api/menu-produtos/upload';
    const idFromPath = () => urlPath.split('/')[3]; // /api/menu-produtos/:id[...] ou /api/menu-categorias/:id
    const queryCat = new URLSearchParams(req.url.split('?')[1] || '');
    const empresa = String(queryCat.get('empresa') || 'CONFRARIA').toUpperCase() === 'SEAMA' ? 'SEAMA' : 'CONFRARIA';

    let upstreamPath = null;
    if (empresa === 'CONFRARIA') {
      if (isUpload) upstreamPath = '/api/menu/upload';
    // Destaques do totem: passaram a ser gerenciados na Gestão em vez de na
    // tela do PDV. No GET vai pra /admin porque a rota pública só devolve o
    // que está ativo, e aqui é preciso ver e editar tudo.
    else if (urlPath === '/api/pdv-destaques') upstreamPath = req.method === 'GET' ? '/api/highlights/admin' : '/api/highlights';
    else if (urlPath.startsWith('/api/pdv-destaques/')) upstreamPath = `/api/highlights/${idFromPath()}`;
      else if (urlPath === '/api/menu-produtos') upstreamPath = req.method === 'GET' ? '/api/menu/admin' : '/api/menu/products';
      else if (urlPath === '/api/menu-categorias') upstreamPath = '/api/categories';
      else if (req.method === 'PATCH' && urlPath.endsWith('/available')) upstreamPath = `/api/menu/products/${idFromPath()}/available`;
      else if (urlPath.startsWith('/api/menu-produtos/')) upstreamPath = `/api/menu/products/${idFromPath()}`;
      else if (urlPath.startsWith('/api/menu-categorias/')) upstreamPath = `/api/categories/${idFromPath()}`;
    } else {
      // Seama: produtos e categorias vivem sob /api/products e /api/categories
      // direto (sem indireção tipo /admin), e não tem sub-rota .../available —
      // "available" é só mais um campo do PATCH normal.
      if (isUpload) upstreamPath = '/api/products/upload';
      else if (urlPath === '/api/menu-produtos') upstreamPath = '/api/products';
      else if (urlPath === '/api/menu-categorias') upstreamPath = '/api/categories';
      else if (req.method === 'PATCH' && urlPath.endsWith('/available')) upstreamPath = `/api/products/${idFromPath()}`;
      else if (urlPath.startsWith('/api/menu-produtos/')) upstreamPath = `/api/products/${idFromPath()}`;
      else if (urlPath.startsWith('/api/menu-categorias/')) upstreamPath = `/api/categories/${idFromPath()}`;
    }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const token = await getServiceToken(empresa);
        const base = pdvDaEmpresa(empresa).base;
        const buf = Buffer.concat(chunks);

        // GET da lista de produtos: Confraria já devolve agrupado por
        // categoria (com produtos aninhados); o Seama devolve uma lista
        // plana — agrupa aqui pra tela não precisar saber a diferença.
        if (empresa === 'SEAMA' && req.method === 'GET' && urlPath === '/api/menu-produtos') {
          const [rp, rc] = await Promise.all([
            fetch(`${base}/api/products`, { headers: { Authorization: 'Bearer ' + token } }),
            fetch(`${base}/api/categories`, { headers: { Authorization: 'Bearer ' + token } }),
          ]);
          const produtos = await rp.json().catch(() => []);
          const categorias = await rc.json().catch(() => []);
          if (!rp.ok || !Array.isArray(produtos)) { res.writeHead(rp.status); res.end(JSON.stringify(produtos)); return; }
          const nomeCat = {};
          (Array.isArray(categorias) ? categorias : []).forEach(c => { nomeCat[c.id] = c.name; });
          const porCategoria = {};
          for (const p of produtos) {
            const catId = p.category_id || '__sem_categoria__';
            if (!porCategoria[catId]) porCategoria[catId] = { id: catId, name: nomeCat[catId] || 'Sem categoria', products: [] };
            porCategoria[catId].products.push({
              id: p.id, name: p.name, description: p.description, price: p.price,
              image_url: p.image_url, available: p.available, category_id: p.category_id,
              category_name: nomeCat[catId] || 'Sem categoria', sort_order: p.sort_order,
              code: p.code, barcode: p.barcode, print_kitchen: p.print_kitchen,
              track_stock: p.track_stock, stock_qty: p.stock_qty, stock_min: p.stock_min,
              // Campos que só existem na Confraria (promo/agendamento/kiosk):
              // vêm com valor neutro pra tela não quebrar ao ler algo que o
              // Seama não tem — o modal esconde os controles desses campos
              // quando a empresa é Seama, então eles nunca são editados aqui.
              featured: false, promo_price: null, promo_label: null, promo_max_qty: null,
              active_days: [], print_target: null, show_kiosk: true, show_delivery: true,
            });
          }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(Object.values(porCategoria)));
          return;
        }

        // GET de categorias do Seama: mesmo raciocínio, preenche os campos
        // que só a Confraria tem (description/image_url/printer) com null.
        if (empresa === 'SEAMA' && req.method === 'GET' && urlPath === '/api/menu-categorias') {
          const upstream = await fetch(`${base}${upstreamPath}`, { headers: { Authorization: 'Bearer ' + token } });
          const data = await upstream.json().catch(() => []);
          if (!upstream.ok || !Array.isArray(data)) { res.writeHead(upstream.status); res.end(JSON.stringify(data)); return; }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(data.map(c => ({ ...c, description: null, image_url: null, printer: null }))));
          return;
        }

        const upstream = await fetch(`${base}${upstreamPath}`, {
          method: req.method,
          headers: {
            'Content-Type': isUpload ? req.headers['content-type'] : 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: buf.length ? buf : undefined,
        });
        const data = await upstream.json().catch(() => ({}));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(upstream.status);
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Erro ao falar com o catálogo: ' + e.message }));
      }
    });
    return;
  }

  // ── Estoque do PDV (Confraria e Seama) ────────────────────────────────
  // Proxy autenticado por token de serviço, igual ao catálogo acima, mas
  // aqui a empresa vem em query string (GET) ou no corpo (POST) — os dois
  // PDVs respondem em formatos diferentes, então cada rota traduz pro mesmo
  // shape antes de devolver pro navegador (ver normalizarListaEstoque() e
  // normalizarFolhaInventario() mais acima).
  if (urlPath.startsWith('/api/estoque-pdv')) {
    // Sempre dinâmico (saldo, pendentes, vínculos mudam a cada ação) — nunca
    // deixa o navegador reaproveitar uma resposta antiga achando que ainda
    // vale, o que faria uma lista de pendentes já resolvida continuar
    // aparecendo na tela.
    res.setHeader('Cache-Control', 'no-store');
    const partes = urlPath.split('/').filter(Boolean); // ["api","estoque-pdv", ...]
    const query = new URLSearchParams(req.url.split('?')[1] || '');

    // GET /api/estoque-pdv?empresa=&categoria=
    if (req.method === 'GET' && partes.length === 2) {
      const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstream = await fetch(`${base}/api/stock`, { headers: { Authorization: 'Bearer ' + token } });
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) { res.writeHead(upstream.status); res.end(JSON.stringify(data)); return; }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(normalizarListaEstoque(empresa, data)));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao falar com o estoque do PDV: ' + e.message }));
        }
      })();
      return;
    }

    // GET /api/estoque-pdv/inventario/folha?empresa=
    if (req.method === 'GET' && partes[2] === 'inventario' && partes[3] === 'folha') {
      const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstreamPath = empresa === 'CONFRARIA' ? '/api/stock/inventario/novo' : '/api/stock';
          const upstream = await fetch(`${base}${upstreamPath}`, { headers: { Authorization: 'Bearer ' + token } });
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) { res.writeHead(upstream.status); res.end(JSON.stringify(data)); return; }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ itens: normalizarFolhaInventario(empresa, data) }));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao gerar folha de inventário: ' + e.message }));
        }
      })();
      return;
    }

    // POST /api/estoque-pdv/inventario  body:{empresa,itens:[{id,contado}],motivo}
    if (req.method === 'POST' && partes[2] === 'inventario' && partes.length === 3) {
      // Buffer[] em vez de string += : concatenar Buffers como string
      // corrompe caractere multibyte (nome com acento) partido entre dois
      // pacotes TCP — mesmo bug já corrigido em outra rota deste arquivo,
      // reintroduzido aqui sem querer.
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const { empresa: empresaRaw, itens, motivo } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const empresa = String(empresaRaw || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
          if (!Array.isArray(itens) || !itens.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'Informe ao menos um item contado' })); return; }
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          let upstream, data;
          if (empresa === 'CONFRARIA') {
            upstream = await fetch(`${base}/api/stock/inventario`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ itens: itens.map(i => ({ product_id: i.id, counted_qty: i.contado })), notes: motivo }),
            });
            data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) { res.writeHead(upstream.status); res.end(JSON.stringify(data)); return; }
            res.setHeader('Content-Type', 'application/json'); res.writeHead(200);
            res.end(JSON.stringify({ ok: true, contados: data.contados, divergentes: data.divergentes, valorDiferenca: data.valor_diferenca, detalhes: data.detalhes || [] }));
          } else {
            upstream = await fetch(`${base}/api/stock/contagem`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ itens: itens.map(i => ({ product_id: i.id, contado: i.contado })), motivo }),
            });
            data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) { res.writeHead(upstream.status); res.end(JSON.stringify(data)); return; }
            const ajustados = data.ajustados || [];
            res.setHeader('Content-Type', 'application/json'); res.writeHead(200);
            res.end(JSON.stringify({
              ok: true, contados: ajustados.length + (data.sem_mudanca || 0), divergentes: ajustados.length, valorDiferenca: null,
              detalhes: ajustados.map(a => ({ produto: a.produto, sistema: a.de, contado: a.para, diferenca: a.diferenca, valor: null })),
            }));
          }
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao lançar contagem: ' + e.message }));
        }
      });
      return;
    }

    // GET /api/estoque-pdv/:id/movimentos?empresa=  |  GET /api/estoque-pdv/:id/vendas?empresa=&de=&ate=
    if (req.method === 'GET' && (partes[3] === 'movimentos' || partes[3] === 'vendas')) {
      const id = partes[2];
      const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
      const acao = partes[3];
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          let upstreamPath;
          if (acao === 'movimentos') upstreamPath = `/api/stock/${id}/${empresa === 'CONFRARIA' ? 'movimentos' : 'movements'}`;
          else upstreamPath = `/api/stock/${id}/vendas?de=${encodeURIComponent(query.get('de') || '')}&ate=${encodeURIComponent(query.get('ate') || '')}`;
          const upstream = await fetch(`${base}${upstreamPath}`, { headers: { Authorization: 'Bearer ' + token } });
          const data = await upstream.json().catch(() => ({}));
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(upstream.status);
          res.end(JSON.stringify(data)); // movimentos/vendas já saem no mesmo shape dos dois PDVs — sem tradução
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: `Erro ao buscar ${acao} do PDV: ` + e.message }));
        }
      })();
      return;
    }

    // POST /api/estoque-pdv/:id/ajuste  body:{empresa,tipo:'contagem'|'perda',valor,motivo}
    if (req.method === 'POST' && partes[3] === 'ajuste') {
      const id = partes[2];
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const { empresa: empresaRaw, tipo, valor, motivo } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const empresa = String(empresaRaw || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
          if (!['contagem', 'perda'].includes(tipo)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Tipo inválido' })); return; }
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          let upstream, data;
          if (empresa === 'CONFRARIA') {
            upstream = await fetch(`${base}/api/stock/${id}/ajuste`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ tipo, valor, motivo }),
            });
            data = await upstream.json().catch(() => ({}));
            res.setHeader('Content-Type', 'application/json'); res.writeHead(upstream.status);
            res.end(JSON.stringify(data));
          } else {
            upstream = await fetch(`${base}/api/stock/${id}/movement`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ type: tipo === 'contagem' ? 'ajuste' : 'perda', quantity: valor, reason: motivo }),
            });
            data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) { res.writeHead(upstream.status); res.end(JSON.stringify(data)); return; }
            res.setHeader('Content-Type', 'application/json'); res.writeHead(200);
            res.end(JSON.stringify({ ok: true, saldo: data.stock_qty }));
          }
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao ajustar estoque: ' + e.message }));
        }
      });
      return;
    }

    // GET /api/estoque-pdv/entradas | /margens | /vinculos — os três já saem
    // no mesmo formato dos dois PDVs, sem precisar de tradução (ver comentário
    // de normalização no início do arquivo).
    if (req.method === 'GET' && partes.length === 3 && ['entradas', 'margens', 'vinculos'].includes(partes[2])) {
      const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstreamPath = partes[2] === 'vinculos' ? '/api/supply/links' : `/api/stock/${partes[2]}`;
          const qs = new URLSearchParams(query); qs.delete('empresa');
          const suffix = qs.toString() ? `?${qs.toString()}` : '';
          const upstream = await fetch(`${base}${upstreamPath}${suffix}`, { headers: { Authorization: 'Bearer ' + token } });
          const data = await upstream.json().catch(() => ({}));
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(upstream.status);
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: `Erro ao buscar ${partes[2]} do PDV: ` + e.message }));
        }
      })();
      return;
    }

    // POST /api/estoque-pdv/vinculos  body:{empresa,source_name,product_id,factor} — cria o vínculo
    if (req.method === 'POST' && urlPath === '/api/estoque-pdv/vinculos') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const { empresa: empresaRaw, source_name, product_id, factor } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const empresa = String(empresaRaw || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstream = await fetch(`${base}/api/supply/links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ source_name, product_id, factor }),
          });
          const data = await upstream.json().catch(() => ({}));
          res.setHeader('Content-Type', 'application/json'); res.writeHead(upstream.status);
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao vincular: ' + e.message }));
        }
      });
      return;
    }

    // POST /api/estoque-pdv/classificar  body:{empresa,kind,source_names} — classifica em massa
    if (req.method === 'POST' && urlPath === '/api/estoque-pdv/classificar') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const { empresa: empresaRaw, kind, source_names } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const empresa = String(empresaRaw || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstream = await fetch(`${base}/api/supply/classify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ kind, source_names }),
          });
          const data = await upstream.json().catch(() => ({}));
          res.setHeader('Content-Type', 'application/json'); res.writeHead(upstream.status);
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao classificar: ' + e.message }));
        }
      });
      return;
    }

    // PATCH /api/estoque-pdv/entradas/:id?empresa=  body:{quantidade?,custo_unitario?} — corrige uma entrada
    if (req.method === 'PATCH' && partes[2] === 'entradas' && partes.length === 4) {
      const id = partes[3];
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstream = await fetch(`${base}/api/stock/entradas/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(payload),
          });
          const data = await upstream.json().catch(() => ({}));
          res.setHeader('Content-Type', 'application/json'); res.writeHead(upstream.status);
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao corrigir entrada: ' + e.message }));
        }
      });
      return;
    }

    // DELETE /api/estoque-pdv/vinculos?empresa=&nome= — descarta um pendente
    // preso (item que não casa com nada, nome corrompido em compra antiga
    // etc.), sem vincular nem classificar.
    if (req.method === 'DELETE' && urlPath === '/api/estoque-pdv/vinculos') {
      const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';
      const nome = query.get('nome') || '';
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const upstream = await fetch(`${base}/api/supply/pending?nome=${encodeURIComponent(nome)}`, {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
          });
          const data = await upstream.json().catch(() => ({}));
          res.setHeader('Content-Type', 'application/json'); res.writeHead(upstream.status);
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Erro ao descartar: ' + e.message }));
        }
      })();
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'Rota de estoque não encontrada' }));
    return;
  }

  // ── Configurações de PDV (Adicionais, Usuários, Sangria, Fechamento) ──
  // Confraria (delivery-backend) e Seama (seama-backend) têm APIs diferentes
  // pra cada uma dessas áreas — cada rota abaixo traduz pro mesmo shape antes
  // de devolver pro navegador, igual o estoque acima. Empresa sempre vem em
  // ?empresa= na query string, mesmo em POST/PATCH/DELETE, pra não precisar
  // ler o corpo antes de saber qual PDV chamar.
  if (urlPath.startsWith('/api/pdv-config')) {
    res.setHeader('Cache-Control', 'no-store');
    const partes = urlPath.split('/').filter(Boolean); // ["api","pdv-config", area, ...]
    const query = new URLSearchParams(req.url.split('?')[1] || '');
    const area = partes[2];
    const empresa = String(query.get('empresa') || 'SEAMA').toUpperCase() === 'CONFRARIA' ? 'CONFRARIA' : 'SEAMA';

    const lerBody = () => new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')); } catch (e) { reject(e); } });
    });
    const enviarJson = (status, obj) => { res.setHeader('Content-Type', 'application/json'); res.writeHead(status); res.end(JSON.stringify(obj)); };
    const enviarErro = (msg) => enviarJson(500, { error: msg });

    // ---- Adicionais ----
    if (area === 'adicionais') {
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const headers = { Authorization: 'Bearer ' + token };

          if (req.method === 'GET' && partes.length === 3) {
            const upstream = await fetch(`${base}${empresa === 'CONFRARIA' ? '/api/addon-groups' : '/api/addons'}`, { headers });
            const data = await upstream.json().catch(() => []);
            if (!upstream.ok) return enviarJson(upstream.status, data);
            const grupos = (Array.isArray(data) ? data : []).map(g => empresa === 'CONFRARIA' ? ({
              id: g.id, nome: g.name, maxSelecao: g.max_select, ativo: g.active,
              opcoes: (g.options || []).map(o => ({ id: o.id, nome: o.name, preco: parseFloat(o.price) || 0, ativo: o.active })),
              nProdutos: (g.products || []).length,
            }) : ({
              id: g.id, nome: g.name, maxSelecao: g.max_per_item, ativo: g.active,
              opcoes: (g.options || []).map(o => ({ id: o.id, nome: o.name, preco: parseFloat(o.price) || 0, ativo: o.active })),
              nProdutos: (g.product_ids || []).length,
            }));
            return enviarJson(200, { grupos, podeExcluirGrupo: empresa === 'SEAMA' });
          }

          if (req.method === 'POST' && partes[3] === 'grupos' && partes.length === 4) {
            const body = await lerBody();
            const nome = String(body.nome || '').trim();
            if (!nome) return enviarJson(400, { error: 'Informe o nome do grupo' });
            const max = parseInt(body.maxSelecao, 10) || 1;
            const upstreamPath = empresa === 'CONFRARIA' ? '/api/addon-groups' : '/api/addons/groups';
            const payload = empresa === 'CONFRARIA' ? { name: nome, max_select: max } : { name: nome, max_per_item: max };
            const upstream = await fetch(`${base}${upstreamPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          if (req.method === 'PATCH' && partes[3] === 'grupos' && partes.length === 5) {
            const body = await lerBody();
            const payload = {};
            if (body.nome !== undefined) payload.name = body.nome;
            if (body.ativo !== undefined) payload.active = !!body.ativo;
            if (body.maxSelecao !== undefined) payload[empresa === 'CONFRARIA' ? 'max_select' : 'max_per_item'] = parseInt(body.maxSelecao, 10) || 1;
            const upstreamPath = (empresa === 'CONFRARIA' ? '/api/addon-groups/' : '/api/addons/groups/') + partes[4];
            const upstream = await fetch(`${base}${upstreamPath}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          if (req.method === 'POST' && partes[3] === 'grupos' && partes[5] === 'opcoes' && partes.length === 6) {
            const body = await lerBody();
            const nome = String(body.nome || '').trim();
            if (!nome) return enviarJson(400, { error: 'Informe o nome da opção' });
            const preco = parseFloat(String(body.preco ?? 0).replace(',', '.')) || 0;
            const upstreamPath = (empresa === 'CONFRARIA' ? '/api/addon-groups/' : '/api/addons/groups/') + partes[4] + '/options';
            const upstream = await fetch(`${base}${upstreamPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nome, price: preco }) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          if (req.method === 'PATCH' && partes[3] === 'opcoes' && partes.length === 5) {
            const body = await lerBody();
            const payload = {};
            if (body.nome !== undefined) payload.name = body.nome;
            if (body.preco !== undefined) payload.price = parseFloat(String(body.preco).replace(',', '.')) || 0;
            if (body.ativo !== undefined) payload.active = !!body.ativo;
            const upstreamPath = (empresa === 'CONFRARIA' ? '/api/addon-groups/options/' : '/api/addons/options/') + partes[4];
            const upstream = await fetch(`${base}${upstreamPath}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          if (req.method === 'DELETE' && partes[3] === 'opcoes' && partes.length === 5) {
            const upstreamPath = (empresa === 'CONFRARIA' ? '/api/addon-groups/options/' : '/api/addons/options/') + partes[4];
            const upstream = await fetch(`${base}${upstreamPath}`, { method: 'DELETE', headers });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          enviarJson(404, { error: 'Rota de adicionais não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com adicionais do PDV: ' + e.message);
        }
      })();
      return;
    }

    // ---- Usuários do PDV ----
    if (area === 'usuarios') {
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const headers = { Authorization: 'Bearer ' + token };

          if (req.method === 'GET' && partes.length === 3) {
            const upstream = await fetch(`${base}${empresa === 'CONFRARIA' ? '/api/users' : '/api/auth/users'}`, { headers });
            const data = await upstream.json().catch(() => []);
            if (!upstream.ok) return enviarJson(upstream.status, data);
            const usuarios = (Array.isArray(data) ? data : []).map(u => empresa === 'CONFRARIA' ? ({
              id: u.id, nome: u.name, cargo: u.role, ativo: u.active, temPin: !!u.tem_pin, detalhe: u.email,
            }) : ({
              id: u.id, nome: u.username, cargo: u.role, ativo: u.active !== false, temPin: true,
              detalhe: u.sangria_limit != null ? `sangria até R$ ${Number(u.sangria_limit).toFixed(2)}` : 'sem limite de sangria',
            }));
            return enviarJson(200, { usuarios });
          }

          if (req.method === 'POST' && partes.length === 3) {
            const body = await lerBody();
            const nome = String(body.nome || '').trim();
            if (!nome) return enviarJson(400, { error: 'Informe o nome do operador' });
            let upstream;
            if (empresa === 'CONFRARIA') {
              if (!body.senha || String(body.senha).length < 6) return enviarJson(400, { error: 'Informe uma senha com pelo menos 6 caracteres' });
              upstream = await fetch(`${base}/api/users`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nome, password: body.senha, role: body.cargo || 'atendente' }) });
            } else {
              if (!/^\d{4,6}$/.test(String(body.pin || ''))) return enviarJson(400, { error: 'Informe um PIN de 4 a 6 dígitos' });
              upstream = await fetch(`${base}/api/auth/users`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: nome, pin: body.pin, role: body.cargo || 'operador' }) });
            }
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          if (req.method === 'PATCH' && partes.length === 4) {
            const body = await lerBody();
            const payload = {};
            if (body.ativo !== undefined) payload.active = !!body.ativo;
            if (body.cargo !== undefined) payload.role = body.cargo;
            if (empresa === 'CONFRARIA' && body.senha !== undefined) payload.password = body.senha;
            if (empresa === 'SEAMA' && body.pin !== undefined) payload.pin = body.pin;
            const upstreamPath = (empresa === 'CONFRARIA' ? '/api/users/' : '/api/auth/users/') + partes[3];
            const upstream = await fetch(`${base}${upstreamPath}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          enviarJson(404, { error: 'Rota de usuários do PDV não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com usuários do PDV: ' + e.message);
        }
      })();
      return;
    }

    // ---- Sangria (categorias) ----
    if (area === 'sangria') {
      (async () => {
        try {
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const headers = { Authorization: 'Bearer ' + token };

          if (req.method === 'GET') {
            if (empresa === 'CONFRARIA') {
              const upstream = await fetch(`${base}/api/settings/sangria-categories`, { headers });
              const data = await upstream.json().catch(() => ({ categorias: [] }));
              return enviarJson(upstream.status, data);
            }
            const upstream = await fetch(`${base}/api/settings`, { headers });
            const data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, data);
            let categorias = [];
            try { categorias = JSON.parse(data.sangria_categories || '[]'); } catch {}
            return enviarJson(200, { categorias: Array.isArray(categorias) ? categorias : [] });
          }

          if (req.method === 'PUT') {
            const body = await lerBody();
            const categorias = Array.isArray(body.categorias) ? body.categorias : [];
            if (empresa === 'CONFRARIA') {
              const upstream = await fetch(`${base}/api/settings/sangria-categories`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ categorias }) });
              const data = await upstream.json().catch(() => ({}));
              return enviarJson(upstream.status, data);
            }
            const upstream = await fetch(`${base}/api/settings`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sangria_categories: JSON.stringify(categorias) }) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, { ...data, categorias });
          }

          enviarJson(404, { error: 'Rota de sangria não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com categorias de sangria: ' + e.message);
        }
      })();
      return;
    }

    // ---- Fechamento (regras hoje só existem no PDV da Seama) ----
    if (area === 'fechamento') {
      (async () => {
        try {
          if (req.method === 'GET') {
            if (empresa === 'CONFRARIA') return enviarJson(200, { disponivel: false });
            const token = await getServiceToken(empresa);
            const base = pdvDaEmpresa(empresa).base;
            const upstream = await fetch(`${base}/api/settings`, { headers: { Authorization: 'Bearer ' + token } });
            const data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, data);
            return enviarJson(200, {
              disponivel: true,
              tolerancia: data.fechamento_tolerancia != null ? parseFloat(data.fechamento_tolerancia) : 0.01,
              maquina1Nome: data.fechamento_maquina1_nome || 'Máquina 1',
              maquina2Nome: data.fechamento_maquina2_nome || 'Máquina 2',
              obsObrigatoria: data.fechamento_obs_obrigatoria === 'true',
              limiteAprovacao: data.fechamento_limite_aprovacao ? parseFloat(data.fechamento_limite_aprovacao) : null,
              maquinasObrigatorio: data.fechamento_maquinas_obrigatorio !== 'false',
              pixSomado: data.fechamento_pix_somado !== 'false',
            });
          }

          if (req.method === 'PUT') {
            if (empresa === 'CONFRARIA') return enviarJson(400, { error: 'Regras de fechamento ainda não existem no PDV da Confraria' });
            const body = await lerBody();
            const token = await getServiceToken(empresa);
            const base = pdvDaEmpresa(empresa).base;
            const payload = {
              fechamento_tolerancia: String(body.tolerancia ?? 0.01),
              fechamento_maquina1_nome: String(body.maquina1Nome || 'Máquina 1'),
              fechamento_maquina2_nome: String(body.maquina2Nome || 'Máquina 2'),
              fechamento_obs_obrigatoria: body.obsObrigatoria ? 'true' : 'false',
              fechamento_maquinas_obrigatorio: body.maquinasObrigatorio === false ? 'false' : 'true',
              fechamento_pix_somado: body.pixSomado === false ? 'false' : 'true',
            };
            if (body.limiteAprovacao != null && body.limiteAprovacao !== '') payload.fechamento_limite_aprovacao = String(body.limiteAprovacao);
            const upstream = await fetch(`${base}/api/settings`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          enviarJson(404, { error: 'Rota de fechamento não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com regras de fechamento: ' + e.message);
        }
      })();
      return;
    }

    // ---- Aparência (cor de categoria, grade de produtos, tamanho de letra —
    // só existe no PDV da Seama hoje) ----
    if (area === 'aparencia') {
      (async () => {
        try {
          if (req.method === 'GET') {
            if (empresa === 'CONFRARIA') return enviarJson(200, { disponivel: false });
            const token = await getServiceToken(empresa);
            const base = pdvDaEmpresa(empresa).base;
            const upstream = await fetch(`${base}/api/settings`, { headers: { Authorization: 'Bearer ' + token } });
            const data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, data);
            let layout = {}; try { layout = JSON.parse(data.ui_layout || '{}'); } catch {}
            let fontes = {}; try { fontes = JSON.parse(data.ui_font_sizes || '{}'); } catch {}
            return enviarJson(200, { disponivel: true, corCategoria: data.cat_active_color || 'verde', layout, fontes });
          }

          if (req.method === 'PUT') {
            if (empresa === 'CONFRARIA') return enviarJson(400, { error: 'Aparência ainda não existe no PDV da Confraria' });
            const body = await lerBody();
            const token = await getServiceToken(empresa);
            const base = pdvDaEmpresa(empresa).base;
            const payload = {};
            if (body.corCategoria !== undefined) payload.cat_active_color = String(body.corCategoria);
            if (body.layout !== undefined) payload.ui_layout = JSON.stringify(body.layout);
            if (body.fontes !== undefined) payload.ui_font_sizes = JSON.stringify(body.fontes);
            if (!Object.keys(payload).length) return enviarJson(400, { error: 'Nada para salvar' });
            const upstream = await fetch(`${base}/api/settings`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, data);
          }

          enviarJson(404, { error: 'Rota de aparência não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com aparência do PDV: ' + e.message);
        }
      })();
      return;
    }

    // ---- Tema do totem (kiosk.html) — só existe pra Confraria hoje; a
    // Seama não tem tela de autoatendimento. Mesma tabela settings
    // (key/value) já usada pelo tempo de descanso de tela do totem. ----
    if (area === 'tema') {
      (async () => {
        try {
          if (empresa !== 'CONFRARIA') return enviarJson(200, { disponivel: false });
          const token = await getServiceToken('CONFRARIA');
          const base = pdvDaEmpresa('CONFRARIA').base;
          const headers = { Authorization: 'Bearer ' + token };

          if (req.method === 'GET' && partes.length === 3) {
            const upstream = await fetch(`${base}/api/settings`, { headers });
            const data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, data);
            return enviarJson(200, { disponivel: true, kiosk_theme: data.kiosk_theme === 'escuro' ? 'escuro' : 'claro' });
          }

          if (req.method === 'PATCH' && partes.length === 3) {
            const body = await lerBody();
            const tema = body.kiosk_theme === 'escuro' ? 'escuro' : 'claro';
            const upstream = await fetch(`${base}/api/settings`, {
              method: 'PATCH',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ kiosk_theme: tema }),
            });
            const data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, data);
            return enviarJson(200, { disponivel: true, kiosk_theme: tema });
          }

          enviarJson(404, { error: 'Rota de tema do totem não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com o totem: ' + e.message);
        }
      })();
      return;
    }

    // ---- Relatório (Vendas, Produtos, Consulta — só existe de verdade no
    // PDV da Seama hoje; Confraria só tem um /api/reports/daily bem mais
    // simples, sem período nem ranking, então fica de fora por enquanto) ----
    if (area === 'relatorio') {
      (async () => {
        try {
          if (empresa === 'CONFRARIA') return enviarJson(200, { disponivel: false });
          const token = await getServiceToken(empresa);
          const base = pdvDaEmpresa(empresa).base;
          const headers = { Authorization: 'Bearer ' + token };
          const sub = partes[3];

          const periodoQs = () => {
            const qs = new URLSearchParams();
            if (query.get('from')) qs.set('from', query.get('from'));
            if (query.get('to')) qs.set('to', query.get('to'));
            return qs.toString() ? `?${qs.toString()}` : '';
          };

          if (req.method === 'GET' && sub === 'vendas' && partes.length === 4) {
            const suffix = periodoQs();
            const [rSum, rPat] = await Promise.all([
              fetch(`${base}/api/reports/summary${suffix}`, { headers }),
              fetch(`${base}/api/reports/patterns${suffix}`, { headers }),
            ]);
            const summary = await rSum.json().catch(() => ({}));
            if (!rSum.ok) return enviarJson(rSum.status, summary);
            const patterns = await rPat.json().catch(() => ({}));
            return enviarJson(200, { disponivel: true, ...summary, porHora: patterns.porHora || [] });
          }

          if (req.method === 'GET' && sub === 'produtos' && partes.length === 4) {
            const upstream = await fetch(`${base}/api/reports/products${periodoQs()}`, { headers });
            const data = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, data);
            return enviarJson(200, { disponivel: true, ...data });
          }

          if (req.method === 'GET' && sub === 'consulta' && partes.length === 4) {
            const data = query.get('data') || '';
            const upstream = await fetch(`${base}/api/sales?date=${encodeURIComponent(data)}`, { headers });
            const d = await upstream.json().catch(() => ({}));
            if (!upstream.ok) return enviarJson(upstream.status, d);
            return enviarJson(200, { disponivel: true, ...d });
          }

          if (req.method === 'GET' && sub === 'consulta' && partes.length === 5) {
            const upstream = await fetch(`${base}/api/sales/${partes[4]}`, { headers });
            const d = await upstream.json().catch(() => ({}));
            return enviarJson(upstream.status, d);
          }

          enviarJson(404, { error: 'Rota de relatório não encontrada' });
        } catch (e) {
          enviarErro('Erro ao falar com relatório do PDV: ' + e.message);
        }
      })();
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'Área de configuração de PDV não encontrada' }));
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

        // A guarda de rate limit existia só no ciclo automático — o botão de
        // sincronizar manual ia direto pra SEFAZ. Durante a punição de 1 hora,
        // cada clique era mais uma requisição indevida, e a SEFAZ conta essas
        // tentativas. Quem tentava resolver o bloqueio era quem o prolongava.
        const mNsu = getNsuMap();
        const bloqAte = mNsu[`rateLimitUntil_${empresa}`];
        if (bloqAte && Date.now() < bloqAte) {
          const min = Math.ceil((bloqAte - Date.now()) / 60000);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(429);
          res.end(JSON.stringify({
            error: `SEFAZ bloqueou as consultas por consumo indevido. Faltam ${min} min. Tentar antes disso conta como nova tentativa indevida — a varredura automática roda sozinha quando liberar.`,
            rateLimited: true, minutosRestantes: min,
          }));
          return;
        }
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

  // NF-e: manifestar + buscar completa
  if (req.method === 'POST' && urlPath === '/api/nfe-manifestar') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { empresa, chNFe } = JSON.parse(body);
        if (!['CONFRARIA', 'SEAMA'].includes(empresa)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Empresa inválida' })); return; }
        if (!chNFe || chNFe.length !== 44) { res.writeHead(400); res.end(JSON.stringify({ error: 'chNFe inválida' })); return; }
        const isNFCe = chNFe.substring(20, 22) === '65';
        let manifestResult = null;
        let jaManifestada = false;
        if (!isNFCe) {
          try {
            manifestResult = await sefazManifestar(empresa, chNFe);
            console.log(`[SEFAZ] Manifestação enviada para ...${chNFe.slice(-8)}`);
          } catch (me) {
            if ((me.message || '').includes('573')) {
              jaManifestada = true;
              console.log(`[SEFAZ] NF-e ...${chNFe.slice(-8)} já manifestada (573)`);
            } else {
              console.log(`[SEFAZ] Manifestação falhou: ${me.message}`);
            }
          }
        } else {
          console.log(`[SEFAZ] NFC-e detectada — pulando manifestação`);
        }
        // Única tentativa após breve espera (evita timeout HTTP do browser)
        const waitMs = jaManifestada ? 2000 : 3000;
        console.log(`[SEFAZ] Aguardando ${waitMs/1000}s antes de buscar XML...`);
        await delay(waitMs);
        let result = null;
        let limiteAtingido = false;
        try {
          result = await sefazFetchByChave(empresa, chNFe);
          if ((result.itens || []).length > 0) {
            console.log(`[SEFAZ] ✅ NF-e ...${chNFe.slice(-8)} completa (${result.itens.length} itens)`);
          } else {
            result = null;
          }
        } catch (e2) {
          console.log(`[SEFAZ] Busca após manifestação: ${e2.message}`);
          if ((e2.message || '').includes('656')) limiteAtingido = true;
        }
        if (!result || (result.itens || []).length === 0) {
          const msg = limiteAtingido
            ? 'SEFAZ limitou consultas (máx. 20/hora). Aguarde 1 hora antes de tentar novamente.'
            : jaManifestada
            ? 'NF-e já manifestada. SEFAZ ainda não disponibilizou o XML completo — tente novamente em alguns minutos.'
            : 'Manifestação enviada. O XML completo pode levar minutos para ficar disponível — tente novamente em breve.';
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ itens: [], tipoDoc: 'resumo', pendente: true, jaManifestada: true, limiteAtingido, message: msg, manifestacao: manifestResult }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ ...result, manifestacao: manifestResult }));
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // NF-e: baixar nota rápido — tenta fetch direto, manifesta só se necessário
  if (req.method === 'POST' && urlPath === '/api/nfe-baixar') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { empresa, chNFe } = JSON.parse(body);
        if (!['CONFRARIA', 'SEAMA'].includes(empresa)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Empresa inválida' })); return; }
        const ch = (chNFe || '').replace(/\D/g, '');
        if (ch.length !== 44) { res.writeHead(400); res.end(JSON.stringify({ error: 'Chave de acesso inválida (44 dígitos)' })); return; }
        const isNFCe = ch.substring(20, 22) === '65';

        // --- Caminho rápido: tenta buscar sem manifestar (funciona se já manifestada) ---
        try {
          const fast = await sefazFetchByChave(empresa, ch);
          if ((fast.itens || []).length > 0) {
            console.log(`[SEFAZ] ⚡ Baixar rápido OK (caminho direto) ...${ch.slice(-8)}`);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ ...fast, rápido: true }));
            return;
          }
        } catch (_) { /* não disponível ainda — vai manifestar */ }

        // --- Caminho completo: manifesta e tenta novamente ---
        let manifestOk = isNFCe;
        if (!isNFCe) {
          try {
            await sefazManifestar(empresa, ch);
            manifestOk = true;
            console.log(`[SEFAZ] ⚡ Manifestação OK ...${ch.slice(-8)}`);
          } catch (me) {
            if ((me.message || '').includes('573')) manifestOk = true; // já manifestada
            else console.log(`[SEFAZ] ⚡ Manifestação: ${me.message}`);
          }
        }

        await delay(2000);

        try {
          const result = await sefazFetchByChave(empresa, ch);
          if ((result.itens || []).length > 0) {
            console.log(`[SEFAZ] ⚡ Baixar rápido OK (após manifestação) ...${ch.slice(-8)}`);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify(result));
            return;
          }
          // Ainda só resumo
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({
            itens: [], tipoDoc: 'resumo', pendente: true,
            message: manifestOk
              ? 'Manifestação enviada. SEFAZ ainda processando — tente novamente em 1–2 minutos.'
              : 'Não foi possível manifestar. Verifique o certificado e tente novamente.',
          }));
        } catch (e2) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({
            itens: [], tipoDoc: 'resumo', pendente: true,
            message: e2.message || 'SEFAZ não retornou o XML completo. Tente novamente.',
          }));
        }
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // NF-e: buscar XML completo por chave de acesso
  if (req.method === 'POST' && urlPath === '/api/nfe-fetch-chave') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { empresa, chNFe } = JSON.parse(body);
        if (!['CONFRARIA', 'SEAMA'].includes(empresa)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Empresa inválida' })); return; }
        if (!chNFe || chNFe.length !== 44) { res.writeHead(400); res.end(JSON.stringify({ error: 'chNFe inválida' })); return; }
        let result;
        try {
          result = await sefazFetchByChave(empresa, chNFe);
        } catch (sefazErr) {
          // SEFAZ still returning only resumo — inform frontend to retry later
          const msg = sefazErr.message || 'Erro ao buscar NF-e';
          const isResumo = msg.includes('resumo') || msg.includes('137') || msg.includes('não encontrada');
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({
            itens: [], tipoDoc: 'resumo', pendente: true, jaManifestada: true,
            message: isResumo
              ? 'NF-e ainda não disponível no SEFAZ. Aguarde 5–10 minutos e tente novamente.'
              : msg,
          }));
          return;
        }
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
  // Versão do documento — usada pelo polling da Lista de Compras pra saber SE
  // vale a pena baixar, antes de baixar.
  //
  // O polling buscava os documentos inteiros (CONFRARIA tem 3 MB, SEAMA 1 MB) a
  // cada 300ms. Como cada busca leva ~2s, as requisições se empilhavam e
  // estouravam o timeout — a lista simplesmente parava de atualizar entre os
  // usuários. Aqui só se olha data e tamanho do arquivo (statSync, sem ler o
  // conteúdo e sem fazer parse), o que devolve ~40 bytes e não bloqueia o
  // event loop como o readFileSync de 3 MB fazia várias vezes por segundo.
  //
  // Precisa vir ANTES do handler de /api/dados/ abaixo: aquele usa startsWith e
  // capturaria esta rota, devolvendo o documento inteiro.
  if (req.method === 'GET' && /^\/api\/dados\/[^/]+\/versao$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const st = fs.statSync(path.join(DADOS_DIR, `${emp.toLowerCase()}.json`));
      res.writeHead(200);
      res.end(JSON.stringify({ v: `${st.mtimeMs}-${st.size}` }));
    } catch {
      // Arquivo ainda não existe: versão fixa, pra não disparar download em loop.
      res.writeHead(200);
      res.end(JSON.stringify({ v: '0-0' }));
    }
    return;
  }

  // Painel Ao Vivo (TV pública, sem login): o link já carrega um token
  // aleatório embutido — quem abre o link entra direto, sem digitar senha.
  // O token fica num arquivo próprio (não faz parte do db de nenhuma
  // empresa, já que o painel mostra as duas juntas) e o admin pode gerar um
  // novo a qualquer momento, invalidando o link antigo na hora.
  const PAINEL_TV_TOKEN_FILE = path.join(DADOS_DIR, 'painel_tv_token.json');
  const painelTvToken = () => {
    try { return JSON.parse(fs.readFileSync(PAINEL_TV_TOKEN_FILE, 'utf-8')).token || null; } catch { return null; }
  };
  const painelTvGerarToken = () => {
    const token = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(DADOS_DIR, { recursive: true });
    fs.writeFileSync(PAINEL_TV_TOKEN_FILE, JSON.stringify({ token, criadoEm: new Date().toISOString() }));
    return token;
  };
  const painelTvHoje = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  // Mesmos números que o Painel Ao Vivo autenticado mostra, só que calculados
  // aqui no servidor a partir do JSON completo da empresa — NUNCA devolve o
  // documento inteiro (que tem contas, folha de pagamento, fornecedores
  // etc.) pro link público, só os agregados de hoje/ontem que a tela usa.
  // Espelha o mergeVendasDoDia do App.tsx: um dia pode ter mais de um
  // registro de vendas em coexistência de propósito (manual + PDV + recibo
  // de venda + recibo de entrega — mergeDocument.js funde por data+origem,
  // não só por data). Um .find() simples aqui pegava só o primeiro que
  // aparecesse no array e ignorava os outros — o Painel TV (link público,
  // sem login) mostrava um total menor que o painel de dentro do app, que já
  // soma todos. Sem isso o operador via dois números diferentes pro "mesmo"
  // faturamento do dia, dependendo de qual tela estava olhando.
  const CAMPOS_VENDA_NUM_TV = ['maquininha', 'dinheiro', 'ifood', 'ifoodLiq', '99food', 'nfoodLiq', 'delivery', 'entregasClientes', 'total'];
  const mergeVendasDoDiaServer = (vendas, data) => {
    const dias = (vendas || []).filter(v => v && v.data === data);
    if (!dias.length) return null;
    if (dias.length === 1) return dias[0];
    const merged = { ...dias[0] };
    CAMPOS_VENDA_NUM_TV.forEach(k => { merged[k] = dias.reduce((s, v) => s + (Number(v[k]) || 0), 0); });
    const porHoraMap = {};
    dias.forEach(v => (Array.isArray(v.porHora) ? v.porHora : []).forEach(p => { porHoraMap[p.hora] = (porHoraMap[p.hora] || 0) + (Number(p.valor) || 0); }));
    merged.porHora = Object.keys(porHoraMap).map(h => ({ hora: Number(h), valor: porHoraMap[h] })).sort((a, b) => a.hora - b.hora);
    return merged;
  };

  const painelTvAgregado = (emp) => {
    const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
    let doc = {};
    try { doc = JSON.parse(fs.readFileSync(file, 'utf-8')) || {}; } catch { doc = {}; }
    const hoje = painelTvHoje();
    const d = new Date(); d.setDate(d.getDate() - 1);
    const ontem = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(d);
    const vendas = Array.isArray(doc.vendas) ? doc.vendas : [];
    const vHoje = mergeVendasDoDiaServer(vendas, hoje);
    const vOntem = mergeVendasDoDiaServer(vendas, ontem);
    const canaisChaves = ['maquininha', 'dinheiro', 'ifood', '99food', 'delivery', 'entregasClientes'];
    const canais = {};
    canaisChaves.forEach(k => { canais[k] = (vHoje && Number(vHoje[k])) || 0; });
    const recibosHoje = (Array.isArray(doc.recibosVenda) ? doc.recibosVenda : []).filter(r => r && r.data === hoje);
    const nRecibos = recibosHoje.length;
    const ticketMedio = nRecibos ? recibosHoje.reduce((s, r) => s + (Number(r.total) || 0), 0) / nRecibos : 0;
    const comprasHoje = (Array.isArray(doc.compras) ? doc.compras : [])
      .filter(c => c && (c.data || '') === hoje)
      .reduce((s, c) => s + (parseFloat(String(c.valor).replace(',', '.')) || 0), 0);
    // Budget de Compras: mesma % configurada em Configurações (o teto de
    // compras do Dashboard), aqui invertida — compras de hoje ÷ meta de CMV
    // = quanto precisa vender hoje pra cobrir o que já foi comprado hoje.
    const budgetCompraPct = (doc.config && doc.config.dashboardPdv && doc.config.dashboardPdv.aparencia && doc.config.dashboardPdv.aparencia.budgetCompraPct) || 30;
    return {
      totalHoje: (vHoje && Number(vHoje.total)) || 0,
      totalOntem: (vOntem && Number(vOntem.total)) || 0,
      porHora: (vHoje && Array.isArray(vHoje.porHora)) ? vHoje.porHora : [],
      canais, nRecibos, ticketMedio, comprasHoje, budgetCompraPct,
    };
  };

  if (req.method === 'GET' && urlPath === '/api/painel-tv-token') {
    let token = painelTvToken();
    if (!token) token = painelTvGerarToken();
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ token }));
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/painel-tv-token/regenerar') {
    const token = painelTvGerarToken();
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ token }));
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/painel-tv-dados') {
    const tokenAtual = painelTvToken();
    const tokenRecebido = new URLSearchParams(req.url.split('?')[1] || '').get('token') || '';
    if (!tokenAtual || tokenRecebido !== tokenAtual) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Link inválido ou expirado — peça um link novo ao administrador.' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200);
    res.end(JSON.stringify({ CONFRARIA: painelTvAgregado('CONFRARIA'), SEAMA: painelTvAgregado('SEAMA') }));
    return;
  }

  if (req.method === 'GET' && urlPath.startsWith('/api/dados/')) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('null'); return; }
    const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
    try {
      const data = fs.readFileSync(file, 'utf-8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.writeHead(200);
      res.end(data);
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200);
      res.end('null');
    }
    return;
  }

  // Varredura específica por data (14/06/2026) e locais de backup de hospedagem
  if (req.method === 'GET' && urlPath === '/api/scan-date') {
    const results = { byDate: [], pmLogs: [], hostingDirs: [], dbDumps: [] };
    const TARGET_DATE = '2026-06-14';
    const TARGET_TS_START = new Date('2026-06-14T00:00:00Z').getTime();
    const TARGET_TS_END   = new Date('2026-06-14T23:59:59Z').getTime();

    const tryParseJson = (filePath) => {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < 20 || stat.size > 100 * 1024 * 1024) return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        const d = JSON.parse(content);
        if (typeof d !== 'object' || Array.isArray(d)) return null;
        const contas = (d.contas || []).length;
        const vendas = (d.vendas || []).length;
        const compras = (d.compras || []).length;
        const funcionarios = (d.funcionarios || []).length;
        return { contas, vendas, compras, funcionarios, size: stat.size, mtime: stat.mtime };
      } catch { return null; }
    };

    // 1. Varrer JSON modificados em 14/06/2026 no projeto e arredores
    const scanForDate = (dir, depth = 0) => {
      if (depth > 4) return;
      try {
        for (const entry of fs.readdirSync(dir)) {
          if (['node_modules','.git','dist'].includes(entry)) continue;
          const full = path.join(dir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) { scanForDate(full, depth + 1); continue; }
            const mts = stat.mtimeMs;
            const isTargetDate = mts >= TARGET_TS_START && mts <= TARGET_TS_END;
            if (!entry.endsWith('.json') && !entry.endsWith('.bak') && !isTargetDate) continue;
            const info = tryParseJson(full);
            if (info && (info.contas + info.vendas + info.compras > 0)) {
              results.byDate.push({ path: full, ...info });
            }
          } catch {}
        }
      } catch {}
    };
    [__dirname, path.join(__dirname, '..'), '/tmp', '/var/tmp'].forEach(d => { try { scanForDate(d); } catch {} });

    // 2. Locais comuns de backup de hospedagem
    const hostingPaths = [
      '/home', '/var/backups', '/backup', '/backups',
      '/home/backup', '/root/backup', '/root/backups',
      path.join(__dirname, '../../backup'),
      path.join(__dirname, '../../backups'),
    ];
    const scanHosting = (dir) => {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const full = path.join(dir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory() && fs.readdirSync(full).length < 200) {
              scanHosting(full);
            } else if (entry.endsWith('.json') || entry.endsWith('.tar') || entry.endsWith('.tar.gz') || entry.endsWith('.zip')) {
              const info = entry.endsWith('.json') ? tryParseJson(full) : null;
              if (info && (info.contas + info.vendas + info.compras > 0)) {
                results.hostingDirs.push({ path: full, ...info });
              } else if (!entry.endsWith('.json') && stat.size > 1000) {
                results.hostingDirs.push({ path: full, size: stat.size, mtime: stat.mtime, type: 'archive' });
              }
            }
          } catch {}
        }
      } catch {}
    };
    hostingPaths.forEach(p => { try { if (fs.existsSync(p)) scanHosting(p); } catch {} });

    // 3. pm2 logs — extrair qualquer bloco JSON de dados
    const pm2LogDirs = [
      '/root/.pm2/logs',
      path.join(process.env.HOME || '/root', '.pm2/logs'),
    ];
    pm2LogDirs.forEach(logDir => {
      try {
        if (!fs.existsSync(logDir)) return;
        for (const f of fs.readdirSync(logDir)) {
          if (!f.endsWith('.log')) continue;
          const full = path.join(logDir, f);
          try {
            const stat = fs.statSync(full);
            results.pmLogs.push({ path: full, size: stat.size, mtime: stat.mtime });
          } catch {}
        }
      } catch {}
    });

    // 4. Arquivos de sistema que podem conter backups de DB
    const dbPaths = [
      '/var/lib/mysql', '/var/lib/postgresql', '/var/lib/mongodb',
      '/etc/cron.daily', '/etc/cron.weekly',
    ];
    dbPaths.forEach(p => {
      try {
        if (fs.existsSync(p)) results.dbDumps.push({ path: p, exists: true });
      } catch {}
    });

    results.byDate.sort((a, b) => (b.contas + b.vendas + b.compras) - (a.contas + a.vendas + a.compras));
    results.hostingDirs.sort((a, b) => ((b.contas||0) + (b.vendas||0) + (b.compras||0)) - ((a.contas||0) + (a.vendas||0) + (a.compras||0)));

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(results));
    return;
  }

  // Varredura de recuperação: busca qualquer JSON com dados de empresa
  if (req.method === 'GET' && urlPath === '/api/scan-recovery') {
    const found = [];
    const scanDirs = [
      DADOS_DIR,
      path.join(__dirname),
      '/tmp',
      path.join(__dirname, '..'),
    ];
    const tryParse = (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.length < 20) return null;
        const d = JSON.parse(content);
        if (typeof d !== 'object' || Array.isArray(d)) return null;
        const contas = (d.contas || []).length;
        const vendas = (d.vendas || []).length;
        const compras = (d.compras || []).length;
        const funcionarios = (d.funcionarios || []).length;
        if (contas + vendas + compras + funcionarios === 0) return null;
        return { contas, vendas, compras, funcionarios, size: content.length };
      } catch { return null; }
    };
    const scanDir = (dir, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
          const full = path.join(dir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) { scanDir(full, depth + 1); continue; }
            if (!entry.endsWith('.json') && !entry.endsWith('.bak') && !entry.endsWith('.tmp')) continue;
            if (stat.size < 50 || stat.size > 50 * 1024 * 1024) continue;
            const preview = tryParse(full);
            if (preview) found.push({ path: full, mtime: stat.mtime, ...preview });
          } catch {}
        }
      } catch {}
    };
    scanDirs.forEach(d => scanDir(d));
    found.sort((a, b) => (b.contas + b.vendas + b.compras) - (a.contas + a.vendas + a.compras));
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(found));
    return;
  }

  // Restaurar a partir de um path absoluto encontrado na varredura
  if (req.method === 'POST' && urlPath === '/api/restore-from-path') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { emp, filePath } = JSON.parse(body);
        if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
        if (!filePath || filePath.includes('..')) { res.writeHead(400); res.end('{"error":"invalid path"}'); return; }
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON inválido');
        const mainFile = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
        fs.writeFileSync(mainFile, content);
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

  // Excluir um backup específico
  if (req.method === 'DELETE' && urlPath.startsWith('/api/backups/')) {
    const parts = urlPath.split('/');
    const emp = (parts[3] || '').toUpperCase();
    const fileName = parts[4] || '';
    if (!['CONFRARIA','SEAMA'].includes(emp) || !fileName) { res.writeHead(400); res.end('{}'); return; }
    const backFile = path.join(DADOS_DIR, 'backups', emp.toLowerCase(), fileName);
    try {
      fs.unlinkSync(backFile);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end('{"ok":true}');
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
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

  // Cardápio TV — todas as telas da empresa, com seus banners (painel admin usa isto pra gerenciar)
  if (req.method === 'GET' && /^\/api\/cardapio-tv\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.writeHead(200);
    res.end(JSON.stringify(loadCardapioTv(emp)));
    return;
  }

  // Cardápio TV — banners de UMA tela específica (o que a TV em si consome).
  // telaId que não bate com nenhuma tela cadastrada cai na primeira da lista —
  // é assim que o link antigo sem tela (/tv/confraria) continua funcionando.
  if (req.method === 'GET' && /^\/api\/cardapio-tv\/[^/]+\/[^/]+$/.test(urlPath)) {
    const partes = urlPath.split('/');
    const emp = (partes[3] || '').toUpperCase();
    const telaId = partes[4] || '';
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    const tela = encontrarTela(loadCardapioTv(emp), telaId);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.writeHead(200);
    // ladoPar (esquerda/direita) só existe quando a tela está pareada com
    // outra — é o que diz pro CardapioTV.tsx qual metade de um banner "2
    // telas" desenhar aqui.
    res.end(JSON.stringify({ banners: tela?.banners || [], ladoPar: tela?.ladoPar || null }));
    return;
  }

  // Cardápio TV — canal ao vivo: a TV mantém esta conexão aberta e recebe um
  // "refresh" assim que o painel salva algo, sem precisar ficar perguntando.
  if (req.method === 'GET' && /^\/api\/cardapio-tv-events\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // pede pro Nginx não bufferizar — sem isso o "instantâneo" só chega quando o buffer dele encher
    });
    res.write(': conectado\n\n');
    sseClients[emp].add(res);
    // Nginx (e alguns proxies) derrubam conexão HTTP ociosa — um comentário
    // periódico mantém o canal vivo sem disparar o listener onmessage da TV.
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(heartbeat); sseClients[emp].delete(res); });
    return;
  }

  // Cardápio TV — quantas TVs estão com o canal aberto agora (selo no painel)
  if (req.method === 'GET' && /^\/api\/cardapio-tv-status\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200);
    res.end(JSON.stringify({ conectadas: sseClients[emp].size }));
    return;
  }

  // Cardápio TV — salvar todas as telas (o painel admin manda a lista inteira)
  if (req.method === 'POST' && /^\/api\/cardapio-tv\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    const bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(bodyChunks).toString('utf-8');
        const incoming = JSON.parse(body);
        if (!Array.isArray(incoming.telas)) throw new Error('telas deve ser um array');
        // Antes de sobrescrever, guarda uma cópia do que tinha — diferente do
        // dados/<empresa>.json (que já tem backup rotativo), esse arquivo
        // nunca teve, então uma exclusão de tela por engano não tinha volta.
        const file = cardapioTvFile(emp);
        try {
          if (fs.existsSync(file)) {
            const backDir = path.join(DADOS_DIR, 'backups', `cardapio-tv-${emp.toLowerCase()}`);
            fs.mkdirSync(backDir, { recursive: true });
            fs.writeFileSync(path.join(backDir, `backup_${Date.now()}.json`), fs.readFileSync(file));
            const backups = fs.readdirSync(backDir).filter(f => f.startsWith('backup_')).sort();
            if (backups.length > 30) backups.slice(0, backups.length - 30).forEach(f => { try { fs.unlinkSync(path.join(backDir, f)); } catch {} });
          }
        } catch (e) { console.error(`[Cardápio TV ${emp}] falha ao fazer backup (salvamento seguiu normalmente):`, e.message); }
        fs.writeFileSync(file, JSON.stringify({ telas: incoming.telas }));
        broadcastCardapioTv(emp);
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

  // Cardápio TV — lista os backups de telas salvos (pra restaurar depois de
  // uma exclusão por engano, como a que motivou este endpoint existir).
  if (req.method === 'GET' && /^\/api\/cardapio-tv-backups\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('[]'); return; }
    const backDir = path.join(DADOS_DIR, 'backups', `cardapio-tv-${emp.toLowerCase()}`);
    let lista = [];
    try {
      lista = fs.readdirSync(backDir).filter(f => f.startsWith('backup_')).sort().reverse().map(f => {
        let telas = [];
        try { telas = JSON.parse(fs.readFileSync(path.join(backDir, f), 'utf-8')).telas || []; } catch {}
        return { arquivo: f, quando: parseInt(f.replace('backup_', '').replace('.json', '')) || 0, telas: telas.map(t => t.nome) };
      });
    } catch { lista = []; }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(lista));
    return;
  }

  // Cardápio TV — restaura um backup específico (substitui o estado atual)
  if (req.method === 'POST' && /^\/api\/cardapio-tv-backups\/[^/]+\/restaurar$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    const bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const { arquivo } = JSON.parse(Buffer.concat(bodyChunks).toString('utf-8'));
        if (!/^backup_\d+\.json$/.test(arquivo || '')) throw new Error('backup inválido');
        const backDir = path.join(DADOS_DIR, 'backups', `cardapio-tv-${emp.toLowerCase()}`);
        const origem = path.join(backDir, arquivo);
        if (!fs.existsSync(origem)) throw new Error('backup não encontrado');
        fs.writeFileSync(cardapioTvFile(emp), fs.readFileSync(origem));
        broadcastCardapioTv(emp);
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

  // Cardápio TV — arquivos de banner (imagem/vídeo) que estão no disco mas não
  // são mais referenciados por nenhuma tela. Excluir uma tela nunca apaga os
  // arquivos em si, só a lista que apontava pra eles — isso lista o que
  // sobrou pra dar pra recolocar sem precisar subir tudo de novo.
  if (req.method === 'GET' && /^\/api\/cardapio-tv-orfaos\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('[]'); return; }
    const dir = path.join(BANNERS_DIR, emp.toLowerCase());
    let arquivos = [];
    try { arquivos = fs.readdirSync(dir); } catch { arquivos = []; }
    const usados = new Set();
    (loadCardapioTv(emp).telas || []).forEach(t => (t.banners || []).forEach(b => { if (b.arquivo) usados.add(b.arquivo); }));
    const VIDEO_EXT = ['mp4', 'webm', 'mov'];
    const orfaos = arquivos.filter(f => !usados.has(f)).map(f => {
      let stat = null;
      try { stat = fs.statSync(path.join(dir, f)); } catch {}
      const ext = (f.split('.').pop() || '').toLowerCase();
      return { arquivo: f, tipo: VIDEO_EXT.includes(ext) ? 'video' : 'imagem', mtime: stat ? stat.mtimeMs : 0 };
    }).sort((a, b) => b.mtime - a.mtime);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(orfaos));
    return;
  }

  // Cardápio TV — upload de banner, imagem ou vídeo (base64, mesmo padrão do Cupom IA)
  if (req.method === 'POST' && /^\/api\/cardapio-tv-upload\/[^/]+$/.test(urlPath)) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA', 'SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    const EXT_PERMITIDAS = ['jpg', 'mp4', 'webm', 'mov'];
    const LIMITE = 80 * 1024 * 1024; // folga pro base64 (~+33%) de um vídeo de até ~60MB
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > LIMITE) { res.writeHead(413); res.end(JSON.stringify({ error: 'Arquivo muito grande (máx. ~60MB de vídeo).' })); req.destroy(); } });
    req.on('end', () => {
      try {
        const { arquivoBase64, extensao } = JSON.parse(body);
        if (!arquivoBase64) throw new Error('arquivoBase64 ausente');
        const ext = EXT_PERMITIDAS.includes(extensao) ? extensao : 'jpg';
        const empDir = path.join(BANNERS_DIR, emp.toLowerCase());
        fs.mkdirSync(empDir, { recursive: true });
        const arquivo = `${crypto.randomUUID()}.${ext}`;
        fs.writeFileSync(path.join(empDir, arquivo), Buffer.from(arquivoBase64, 'base64'));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ arquivo }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Dados da empresa — POST (salvar)
  if (req.method === 'POST' && urlPath.startsWith('/api/dados/')) {
    const emp = (urlPath.split('/')[3] || '').toUpperCase();
    if (!['CONFRARIA','SEAMA'].includes(emp)) { res.writeHead(400); res.end('{}'); return; }
    const file = path.join(DADOS_DIR, `${emp.toLowerCase()}.json`);
    // Acumula os chunks como Buffer bruto e só decodifica UTF-8 UMA VEZ no
    // final. Fazer `body += chunk` decodifica cada chunk isoladamente — se um
    // caractere acentuado (ç, ã, õ...) cair bem na fronteira entre dois
    // chunks TCP (bem provável num payload grande, como o estado inteiro do
    // app), cada metade vira lixo (U+FFFD) e corrompe o texto salvo.
    const bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(bodyChunks).toString('utf-8');
        let incoming = JSON.parse(body);
        // Rotating backup: keep last 48 backups (hourly over 2 days)
        const backDir = path.join(DADOS_DIR, 'backups', emp.toLowerCase());
        fs.mkdirSync(backDir, { recursive: true });
        if (fs.existsSync(file)) {
          let existing = null;
          try {
            existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
          } catch (e) {
            console.error(`[POST ${emp}] arquivo atual ilegível, salvando payload do cliente sem fusão:`, e.message);
          }
          // A fusão é a única coisa que protege o que já está no arquivo. Se ela
          // falhar, o comportamento antigo (catch vazio) era seguir adiante e
          // gravar o payload cru do cliente por cima — apagando em silêncio o
          // que os outros aparelhos já tinham salvo, sem nada no log. Agora a
          // falha é registrada, o arquivo bom é preservado numa cópia e o POST
          // é recusado, para o cliente tentar de novo (o dado continua nele).
          if (existing) {
            try {
              incoming = mergeDocument(existing, incoming);
            } catch (e) {
              console.error(`[POST ${emp}] FUSÃO FALHOU — POST recusado, arquivo preservado:`, e);
              try {
                fs.writeFileSync(path.join(backDir, `mergefail_${Date.now()}.json`), fs.readFileSync(file));
              } catch {}
              res.setHeader('Content-Type', 'application/json');
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'Falha ao fundir com os dados do servidor. Nada foi gravado.' }));
              return;
            }
          }
          // Daqui pra baixo é só backup/rotação: falhar aqui não pode recusar
          // um POST legítimo (disco cheio, permissão), então segue com log.
          try {
            const existingContas = (existing?.contas||[]).length;
            const incomingContas = (incoming.contas||[]).length;
            const existingVendas = (existing?.vendas||[]).length;
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
          } catch (e) {
            console.error(`[POST ${emp}] falha na rotina de backup (salvamento seguiu normalmente):`, e.message);
          }
        }
        fs.writeFileSync(file, JSON.stringify(incoming));
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

  // NF-e diagnóstico: retorna cStat bruto do SEFAZ sem processar
  if (req.method === 'POST' && urlPath === '/api/nfe-debug') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { empresa, chNFe } = JSON.parse(body);
        if (!['CONFRARIA','SEAMA'].includes(empresa)) { res.writeHead(400); res.end('{}'); return; }
        const pfxPath  = path.join(CERTS_DIR, `${empresa.toLowerCase()}.pfx`);
        const keyPath  = path.join(CERTS_DIR, `${empresa.toLowerCase()}_key.pem`);
        const certPath = path.join(CERTS_DIR, `${empresa.toLowerCase()}_cert.pem`);
        const hasPem = fs.existsSync(keyPath) && fs.existsSync(certPath);
        const hasPfx = fs.existsSync(pfxPath);
        if (!hasPem && !hasPfx) { res.writeHead(503); res.end(JSON.stringify({error:'Certificado não encontrado'})); return; }
        const passphrase = process.env[`CERT_${empresa}_PASS`] || '';
        const cnpj = (process.env[`CNPJ_${empresa}`]||'').replace(/\D/g,'');
        const uf   = process.env[`UF_${empresa}`] || '35';
        const tlsOpts = hasPem ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : { pfx: fs.readFileSync(pfxPath), passphrase };
        const soapBody = buildChaveEnvelope(cnpj, uf, chNFe);
        const bodyBuf  = Buffer.from(soapBody, 'utf-8');
        const opts = { hostname:'www1.nfe.fazenda.gov.br', path:'/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', method:'POST',
          headers:{'Content-Type':'application/soap+xml; charset=utf-8','Content-Length':bodyBuf.length,'SOAPAction':''},
          ...tlsOpts, rejectUnauthorized:true, timeout:30000 };
        const apiReq = https.request(opts, apiRes => {
          const chunks = [];
          apiRes.on('data', c => chunks.push(c));
          apiRes.on('end', () => {
            const rawXml = Buffer.concat(chunks).toString('utf-8');
            const stripped = rawXml.replace(/<(\/?)([a-zA-Z0-9]+):/g,'<$1');
            const cStat = getTag(stripped,'cStat');
            const xMotivo = getTag(stripped,'xMotivo');
            const dhResp = getTag(stripped,'dhResp');
            const docCount = (rawXml.match(/<docZip/g)||[]).length;
            const docTypes = [];
            const docZipRe = /<docZip[^>]*>([\s\S]*?)<\/docZip>/g;
            let m;
            while((m=docZipRe.exec(stripped))!==null){
              try{const d=zlib.gunzipSync(Buffer.from(m[1].trim(),'base64')).toString('utf-8');
                if(d.includes('<infNFe')||d.includes('<procNFe'))docTypes.push('procNFe');
                else if(d.includes('<resNFe'))docTypes.push('resNFe');
                else docTypes.push('outro:'+d.slice(0,60));
              }catch(e){docTypes.push('gunzip_err:'+e.message);}
            }
            res.setHeader('Content-Type','application/json');
            res.writeHead(200);
            res.end(JSON.stringify({cStat,xMotivo,dhResp,docCount,docTypes,cnpj,uf,chNFe}));
          });
        });
        apiReq.on('error',e=>{res.writeHead(500);res.end(JSON.stringify({error:e.message}));});
        apiReq.on('timeout',()=>{apiReq.destroy();res.writeHead(504);res.end(JSON.stringify({error:'timeout'}));});
        apiReq.write(bodyBuf); apiReq.end();
      } catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/nfe-manifest-debug') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { empresa, chNFe, ambiente } = JSON.parse(body);
        if (!['CONFRARIA','SEAMA'].includes(empresa)) { res.writeHead(400); res.end(JSON.stringify({error:'Empresa inválida'})); return; }
        const pem = ensurePemFiles(empresa);
        if (!pem) { res.writeHead(503); res.end(JSON.stringify({error:'Certificado PEM não disponível'})); return; }
        const cnpj = (process.env[`CNPJ_${empresa}`]||'').replace(/\D/g,'');
        const uf   = process.env[`UF_${empresa}`] || '35';
        if (!cnpj) { res.writeHead(400); res.end(JSON.stringify({error:`CNPJ_${empresa} não configurado`})); return; }
        const isHom = ambiente === 'homologacao';
        const privateKeyPem = fs.readFileSync(pem.keyPath, 'utf-8');
        const certPem = fs.readFileSync(pem.certPath, 'utf-8');
        const soapBody = buildManifestacaoSoap(cnpj, uf, chNFe, privateKeyPem, certPem, isHom ? '2' : '1');
        const bodyBuf = Buffer.from(soapBody, 'utf-8');
        const tlsOpts = { key: fs.readFileSync(pem.keyPath), cert: fs.readFileSync(pem.certPath) };
        const opts = {
          hostname: isHom ? 'hom1.nfe.fazenda.gov.br' : 'www.nfe.fazenda.gov.br',
          path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
          method: 'POST',
          headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF"', 'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF', 'Content-Length': bodyBuf.length },
          ...tlsOpts, rejectUnauthorized: false, timeout: 30000,
        };
        const apiReq = https.request(opts, apiRes => {
          const chunks = [];
          apiRes.on('data', c => chunks.push(c));
          apiRes.on('end', () => {
            const rawXml = Buffer.concat(chunks).toString('utf-8');
            const stripped = rawXml.replace(/<(\/?)([a-zA-Z0-9]+):/g,'<$1');
            const cStat = getTag(stripped,'cStat');
            const xMotivo = getTag(stripped,'xMotivo');
            const dhReg = getTag(stripped,'dhRegEvento') || getTag(stripped,'dhEvento');
            res.setHeader('Content-Type','application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ cStat, xMotivo, dhReg, cnpj, uf, chNFe, signDebug: _signDebug, rawSnippet: rawXml.slice(0,2000), sentSoapSnippet: soapBody }));
          });
        });
        apiReq.on('error', e => { res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
        apiReq.on('timeout', () => { apiReq.destroy(); res.writeHead(504); res.end(JSON.stringify({error:'timeout'})); });
        apiReq.write(bodyBuf); apiReq.end();
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
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

  // Banners do Cardápio TV (persiste entre builds, fora de dist/)
  if (urlPath.startsWith('/banners/')) {
    const bannerFile = path.join(BANNERS_DIR, urlPath.replace('/banners/', ''));
    if (bannerFile.startsWith(BANNERS_DIR) && fs.existsSync(bannerFile)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return serveFile(bannerFile, res);
    }
    res.writeHead(404); res.end('Banner not found'); return;
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
    if (isRateLimited(emp)) continue;
    console.log(`[AutoSync] Iniciando sync SEFAZ para ${emp} (CNPJ key: ${key})...`);
    try {
      // FASE A — varrer tudo que a SEFAZ tem pra entregar neste ciclo.
      const result = await sefazSync(emp);
      const cache = loadCache();
      const existing = cache[key]?.nfes || [];

      // FASE C (do ciclo anterior) — o `nfeProc` completo chega num NSU novo e
      // aqui promove o resumo correspondente, casando pela chave.
      const antesCompletas = existing.filter(n => n.estado === 'completo').length;
      const notas = fundirNotas(existing, result.nfes || []);
      const promovidas = notas.filter(n => n.estado === 'completo').length - antesCompletas;

      // FASE B — manifestar o que chegou novo. Sem espera de 5s e sem consulta
      // por chave: o completo virá sozinho numa varredura seguinte.
      //
      // Se a varredura parou por limite da SEFAZ, nao manifesta neste ciclo:
      // ja estamos sendo barrados, e insistir so alimenta o bloqueio. O que
      // veio fica salvo e a manifestacao acontece no proximo ciclo.
      const manif = result.erroParcial
        ? { enviadas: 0, aceitas: 0, recusadas: 0 }
        : await manifestarPendentes(emp, notas);

      // Guarda mais que as 50 antigas: nota aguardando XML precisa sobreviver
      // até a varredura que traz o completo, que pode ser horas depois.
      const merged = notas.slice(0, 200);
      cache[key] = { nfes: merged, timestamp: new Date().toISOString(), ultNSU: result.ultNSU, empresa: emp };
      saveCache(cache);

      const porEstado = merged.reduce((a, n) => { a[n.estado || '?'] = (a[n.estado || '?'] || 0) + 1; return a; }, {});
      console.log(`[AutoSync] ${emp}: varredura ultNSU=${result.ultNSU} · ${promovidas} promovida(s) a completa · `
        + `manifestações: ${manif.aceitas} aceita(s), ${manif.recusadas} recusada(s) · estados: ${JSON.stringify(porEstado)}`);
      // O 656 é tratado aqui, DEPOIS do saveCache: o que a varredura alcançou
      // antes de ser barrada já está guardado. Antes o erro subia direto pro
      // catch e levava as notas junto.
      if (result.erroParcial) {
        const msg = result.erroParcial.message || "";
        if (msg.includes("656")) {
          setRateLimit(emp, 70);
          console.log(`[AutoSync] ${emp}: varredura interrompida por limite da SEFAZ (656) — `
            + `${(result.nfes || []).length} nota(s) coletada(s) antes disso foram salvas. Bloqueado por 70min.`);
        } else {
          console.error(`[AutoSync] ${emp}: varredura interrompida — ${msg}`);
        }
      }
      if (manif.recusadas > 0) {
        console.log(`[AutoSync] ${emp}: ⚠️ manifestação sendo recusada pela SEFAZ — o XML completo não será liberado enquanto isso. Veja o cStat em /api/nfe-cache.`);
      }
    } catch (e) {
      if (e.message && e.message.includes('656')) {
        setRateLimit(emp, 70);
        console.log(`[AutoSync] ${emp}: rate limit SEFAZ (656). Bloqueado por 70min.`);
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
