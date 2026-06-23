import http from 'http';
import https from 'https';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import webPush from 'web-push';

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
    const apiReq = https.request(options, apiRes => {
      const chunks = [];
      apiRes.on('data', c => chunks.push(c));
      apiRes.on('end', () => {
        try {
          let xml = Buffer.concat(chunks).toString('utf-8');
          xml = xml.replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1');
          const cStat = getTag(xml, 'cStat');
          const xMotivo = getTag(xml, 'xMotivo');
          if (cStat && cStat !== '138') return reject(new Error(`SEFAZ cStat ${cStat}: ${xMotivo}`));
          const docZipRe = /<docZip[^>]*>([\s\S]*?)<\/docZip>/g;
          let match;
          while ((match = docZipRe.exec(xml)) !== null) {
            try {
              const decompressed = zlib.gunzipSync(Buffer.from(match[1].trim(), 'base64')).toString('utf-8');
              if (decompressed.includes('<infNFe') || decompressed.includes('<NFe')) {
                const parsed = parseNFeXml(decompressed);
                return resolve({ ...parsed, tipoDoc: 'completo' });
              }
            } catch {}
          }
          reject(new Error('NF-e completa não encontrada na resposta SEFAZ'));
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

function signXmlInfEvento(infEventoXml, privateKeyPem, certPem) {
  const c14n = infEventoXml.replace(/\r?\n/g,'').replace(/>\s+</g,'><').trim();
  const idMatch = infEventoXml.match(/Id="([^"]+)"/);
  const refUri = idMatch ? `#${idMatch[1]}` : '';
  const digest = crypto.createHash('sha256').update(c14n, 'utf8').digest('base64');
  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><Reference URI="${refUri}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signedInfoXml);
  const signatureValue = signer.sign(privateKeyPem, 'base64');
  const x509 = getX509CertBase64(certPem);
  return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature>`;
}

function buildManifestacaoSoap(cnpj, uf, chNFe, privateKeyPem, certPem) {
  const tpEvento = '210210';
  const nSeqEvento = '1';
  const evId = `ID${tpEvento}${chNFe}0${nSeqEvento}`;
  const dhEvento = new Date().toISOString().replace(/\.\d{3}Z/, '-03:00');
  const cOrgao = '91';
  const infEventoXml = `<infEvento Id="${evId}" xmlns="http://www.portalfiscal.inf.br/nfe"><cOrgao>${cOrgao}</cOrgao><tpAmb>1</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chNFe}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeqEvento}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>`;
  const signature = signXmlInfEvento(infEventoXml, privateKeyPem, certPem);
  const eventoXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEventoXml}${signature}</evento>`;
  const envEvento = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${eventoXml}</envEvento>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><nfeDadosMsg>${envEvento}</nfeDadosMsg></nfeRecepcaoEvento></soap12:Body></soap12:Envelope>`;
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
    const bodyBuf = Buffer.from(soapBody, 'utf-8');
    const hasPem = fs.existsSync(pem.keyPath) && fs.existsSync(pem.certPath);
    const tlsOpts = hasPem
      ? { key: fs.readFileSync(pem.keyPath), cert: fs.readFileSync(pem.certPath) }
      : { pfx: fs.readFileSync(pfxPath), passphrase };
    const options = {
      hostname: 'www.nfe.fazenda.gov.br',
      path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': bodyBuf.length },
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

async function sefazSync(emp) {
  const result = await sefazDistDFe(emp);
  const resumos = (result.nfes || []).filter(n => n.tipoDoc === 'resumo' && n.chNFe && n.chNFe.length === 44);
  if (resumos.length > 0) {
    console.log(`[SEFAZ ${emp}] ${resumos.length} resumo(s) encontrado(s) — buscando documentos completos...`);
    for (const resumo of resumos) {
      const isNFCe = resumo.chNFe.length >= 22 && resumo.chNFe.substring(20, 22) === '65';
      const tipoLabel = isNFCe ? 'NFC-e' : 'NF-e';
      try {
        await delay(1000);
        if (!isNFCe) {
          try { await sefazManifestar(emp, resumo.chNFe); } catch (me) {
            console.log(`[SEFAZ ${emp}] Manifestação ${tipoLabel} ${resumo.chNFe.slice(-8)}: ${me.message} (continuando...)`);
          }
        } else {
          console.log(`[SEFAZ ${emp}] ${tipoLabel} ${resumo.chNFe.slice(-8)} — pulando manifestação (não se aplica a NFC-e)`);
        }
        for (let tentativa = 1; tentativa <= 3; tentativa++) {
          await delay(tentativa === 1 ? 3000 : 5000);
          try {
            const completa = await sefazFetchByChave(emp, resumo.chNFe);
            if ((completa.itens || []).length > 0) {
              const idx = result.nfes.findIndex(n => n.nsu === resumo.nsu);
              if (idx >= 0) {
                result.nfes[idx] = { ...completa, nsu: resumo.nsu, tipoDoc: 'completo', modelo: isNFCe ? '65' : (completa.modelo || '55') };
                console.log(`[SEFAZ ${emp}] ✅ ${tipoLabel} ${resumo.chNFe.slice(-8)} completada (${(completa.itens||[]).length} itens, tentativa ${tentativa})`);
              }
              break;
            }
          } catch (e2) {
            console.log(`[SEFAZ ${emp}] Tentativa ${tentativa}/3 ${tipoLabel} ${resumo.chNFe.slice(-8)}: ${e2.message}`);
          }
        }
      } catch (e) {
        console.log(`[SEFAZ ${emp}] ⚠️ Falha ao buscar ${tipoLabel} ${resumo.chNFe.slice(-8)}: ${e.message}`);
      }
    }
  }
  return result;
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
        if (!isNFCe) {
          try { manifestResult = await sefazManifestar(empresa, chNFe); } catch (me) {
            console.log(`[SEFAZ] Manifestação falhou: ${me.message}`);
          }
        } else {
          console.log(`[SEFAZ] NFC-e detectada — pulando manifestação`);
        }
        let result = null;
        for (let t = 1; t <= 3; t++) {
          await delay(t === 1 ? 3000 : 5000);
          try {
            result = await sefazFetchByChave(empresa, chNFe);
            if ((result.itens || []).length > 0) break;
          } catch (e2) {
            if (t === 3) throw e2;
            console.log(`[SEFAZ] Tentativa ${t}/3: ${e2.message}`);
          }
        }
        if (!result) throw new Error('Não foi possível obter a NF-e completa');
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

  // NF-e: buscar XML completo por chave de acesso
  if (req.method === 'POST' && urlPath === '/api/nfe-fetch-chave') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { empresa, chNFe } = JSON.parse(body);
        if (!['CONFRARIA', 'SEAMA'].includes(empresa)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Empresa inválida' })); return; }
        if (!chNFe || chNFe.length !== 44) { res.writeHead(400); res.end(JSON.stringify({ error: 'chNFe inválida' })); return; }
        const result = await sefazFetchByChave(empresa, chNFe);
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
      // Upgrade existing resumos to completo if the new sync brought the full version
      const upgradedExisting = existing.map(ex => {
        if (ex.tipoDoc === 'resumo' && ex.chNFe) {
          const full = (result.nfes||[]).find(n => n.chNFe === ex.chNFe && n.tipoDoc === 'completo');
          if (full) return { ...full, nsu: ex.nsu };
        }
        return ex;
      });
      const merged = [...novas, ...upgradedExisting]
        .sort((a,b) => (b.data||'').localeCompare(a.data||''))
        .slice(0, 50);
      cache[key] = { nfes: merged, timestamp: new Date().toISOString(), ultNSU: result.ultNSU, empresa: emp };
      // Also resolve any old resumos still in cache
      const oldResumos = merged.filter(n => n.tipoDoc === 'resumo' && n.chNFe && n.chNFe.length === 44);
      if (oldResumos.length > 0) {
        console.log(`[AutoSync] ${emp}: resolvendo ${oldResumos.length} resumo(s) antigo(s) no cache...`);
        for (const resumo of oldResumos) {
          try {
            await delay(1500);
            try { await sefazManifestar(emp, resumo.chNFe); } catch (me) {
              console.log(`[AutoSync] ${emp}: manifestação ${resumo.chNFe.slice(-8)}: ${me.message}`);
            }
            await delay(2000);
            const completa = await sefazFetchByChave(emp, resumo.chNFe);
            const idx = cache[key].nfes.findIndex(n => n.nsu === resumo.nsu);
            if (idx >= 0) {
              cache[key].nfes[idx] = { ...completa, nsu: resumo.nsu, tipoDoc: 'completo' };
              console.log(`[AutoSync] ${emp}: ✅ resumo ${resumo.chNFe.slice(-8)} → completa (${(completa.itens||[]).length} itens)`);
            }
          } catch (e2) {
            console.log(`[AutoSync] ${emp}: ⚠️ falha ao resolver resumo ${resumo.chNFe.slice(-8)}: ${e2.message}`);
          }
        }
        saveCache(cache);
      } else {
        saveCache(cache);
      }
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
