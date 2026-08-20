const http = require('http');
const { URL } = require('url');
const pool = require('../db/pool');

// Evolution API (WhatsApp self-hosted, sessão via Baileys). URL/apikey/instância
// eram fixos dentro de orders.js — centralizados aqui com fallback pros mesmos
// valores de antes, então nada muda pra quem não configurar as env vars.
const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8081';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || 'confraria2024';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'confraria';

function evoRequest(method, path) {
  return new Promise((resolve) => {
    const url = new URL(EVOLUTION_URL + path);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { apikey: EVOLUTION_KEY },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* resposta não-JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', (e) => { console.error('[whatsapp/evo]', e.message); resolve({ status: null, json: null }); });
    req.end();
  });
}

async function sendWhatsApp(phone, message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ number: `55${phone}`, text: message });
    const url = new URL(EVOLUTION_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `/message/sendText/${EVOLUTION_INSTANCE}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', (e) => { console.error('[whatsapp]', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// state: "open" (conectado), "close" (desconectado) ou "connecting"
async function connectionState() {
  const { json } = await evoRequest('GET', `/instance/connectionState/${EVOLUTION_INSTANCE}`);
  return json?.instance?.state || 'close';
}

async function requestQrCode() {
  const { json } = await evoRequest('GET', `/instance/connect/${EVOLUTION_INSTANCE}`);
  return { code: json?.code || null, base64: json?.base64 || null };
}

async function logoutInstance() {
  const { status } = await evoRequest('DELETE', `/instance/logout/${EVOLUTION_INSTANCE}`);
  return status;
}

// ---- Mensagens automáticas por status do pedido ----
// "pronto" e "saiu_para_entrega" continuam com texto próprio pra retirada
// (não editável — evita confundir "vem buscar" com "saiu pra entrega" se
// alguém digitar o template errado); só a variante de entrega vira editável.
const TEMPLATE_STATUSES = ['confirmado', 'em_preparo', 'pronto', 'saiu_para_entrega', 'cancelado'];

const DEFAULT_TEMPLATES = {
  confirmado:        { enabled: false, text: '✅ *Pedido #{{numero}} confirmado!*\n\nOlá {{nome}}! Recebemos seu pedido e já estamos cuidando de tudo. Logo logo estará pronto! ☕🎉' },
  em_preparo:        { enabled: false, text: '👨‍🍳 *Pedido #{{numero}} em preparo!*\n\nOlá {{nome}}! Seu pedido está sendo preparado com carinho. Em breve estará pronto! ☕' },
  pronto:            { enabled: true,  text: '🎉 *Pedido #{{numero}} pronto!*\n\nOlá {{nome}}! Seu pedido está pronto e logo sairá para entrega. Aguarde! ☕' },
  saiu_para_entrega: { enabled: true,  text: '🛵 *Pedido #{{numero}} saiu para entrega!*\n\nOlá {{nome}}! Seu pedido saiu e está a caminho. Logo chegará aí! 🎉' },
  cancelado:         { enabled: true,  text: '❌ *Pedido #{{numero}} cancelado*\n\nOlá {{nome}}! Infelizmente precisamos cancelar seu pedido.' },
};

// Lista fixa (não vem de input do usuário) interpolada direto na query — o
// wrapper de pool deste projeto (ver services/whatsapp.js vs settings.js)
// substitui $N por valor escalar escapado, não por array; um array vira
// "'a,b,c'" (string única) e quebra o ANY(). Mesma solução já usada em
// settings.js pra PUBLIC_KEYS.
const TEMPLATE_KEYS_SQL_LIST = TEMPLATE_STATUSES
  .flatMap((s) => [`wa_tmpl_${s}_text`, `wa_tmpl_${s}_enabled`])
  .map((k) => `'${k}'`)
  .join(',');

async function getTemplates() {
  const result = await pool.query(`SELECT key, value FROM settings WHERE key IN (${TEMPLATE_KEYS_SQL_LIST})`);
  const map = Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
  const templates = {};
  for (const s of TEMPLATE_STATUSES) {
    const savedText = map[`wa_tmpl_${s}_text`];
    const savedEnabled = map[`wa_tmpl_${s}_enabled`];
    templates[s] = {
      text: savedText != null && savedText !== '' ? savedText : DEFAULT_TEMPLATES[s].text,
      enabled: savedEnabled != null ? savedEnabled === 'true' : DEFAULT_TEMPLATES[s].enabled,
    };
  }
  return templates;
}

async function saveTemplates(templates) {
  for (const s of TEMPLATE_STATUSES) {
    const t = templates[s];
    if (!t) continue;
    if (typeof t.text === 'string' && t.text.trim()) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [`wa_tmpl_${s}_text`, t.text]
      );
    }
    if (typeof t.enabled === 'boolean') {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [`wa_tmpl_${s}_enabled`, t.enabled ? 'true' : 'false']
      );
    }
  }
}

function renderTemplate(text, vars) {
  return String(text || '')
    .replace(/\{\{\s*numero\s*\}\}/g, vars.numero ?? '')
    .replace(/\{\{\s*nome\s*\}\}/g, vars.nome ?? '');
}

// ---- Campanhas (disparo em massa pra clientes já cadastrados) ----
const AUDIENCE_FILTERS = {
  // customers.phone é NOT NULL — todo cliente que já pediu tem WhatsApp.
  all: `SELECT c.id, c.name, c.phone FROM customers c WHERE c.active = true`,
  '30d': `SELECT c.id, c.name, c.phone FROM customers c
          JOIN orders o ON o.customer_id = c.id
          WHERE c.active = true
          GROUP BY c.id
          HAVING MAX(o.created_at) >= NOW() - INTERVAL '30 days'`,
  '60d_inactive': `SELECT c.id, c.name, c.phone FROM customers c
          JOIN orders o ON o.customer_id = c.id
          WHERE c.active = true
          GROUP BY c.id
          HAVING MAX(o.created_at) < NOW() - INTERVAL '60 days'`,
};

async function audienceList(filter) {
  const sql = AUDIENCE_FILTERS[filter];
  if (!sql) throw { status: 400, message: 'Filtro de público inválido' };
  const result = await pool.query(sql);
  return result.rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Roda em background (não é aguardado pela rota) — espaça os envios em 5-10s
// aleatórios pra não levar a instância a um bloqueio por comportamento de spam.
// Se o processo reiniciar no meio, a campanha fica "em_andamento" parada; dá
// pra ver isso no histórico, mas não há retomada automática (aceitável pro
// volume de uma campanha manual; não é fila persistente).
async function runCampaign(campaignId, recipients, message) {
  for (const r of recipients) {
    const firstName = (r.name || '').split(' ')[0];
    const text = message.replace(/\{\{\s*nome\s*\}\}/g, firstName);
    const status = await sendWhatsApp(String(r.phone || '').replace(/\D/g, ''), text);
    const ok = typeof status === 'number' && status >= 200 && status < 300;
    await pool.query(
      `UPDATE whatsapp_campaigns SET sent_count = sent_count + $1, failed_count = failed_count + $2 WHERE id = $3`,
      [ok ? 1 : 0, ok ? 0 : 1, campaignId]
    );
    await sleep(5000 + Math.random() * 5000);
  }
  await pool.query(`UPDATE whatsapp_campaigns SET status = 'concluida', finished_at = NOW() WHERE id = $1`, [campaignId]);
}

async function startCampaign({ name, message, filter, createdBy }) {
  const recipients = await audienceList(filter);
  const result = await pool.query(
    `INSERT INTO whatsapp_campaigns (name, message, audience_filter, total, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, message, filter, recipients.length, createdBy || null]
  );
  const campaign = result.rows[0];
  if (recipients.length) {
    runCampaign(campaign.id, recipients, message).catch((e) => {
      console.error('[whatsapp/campaign]', e.message);
      pool.query(`UPDATE whatsapp_campaigns SET status = 'erro', finished_at = NOW() WHERE id = $1`, [campaign.id]).catch(() => {});
    });
  } else {
    pool.query(`UPDATE whatsapp_campaigns SET status = 'concluida', finished_at = NOW() WHERE id = $1`, [campaign.id]).catch(() => {});
  }
  return campaign;
}

async function listCampaigns() {
  const result = await pool.query(`SELECT * FROM whatsapp_campaigns ORDER BY created_at DESC LIMIT 30`);
  return result.rows;
}

module.exports = {
  sendWhatsApp,
  connectionState,
  requestQrCode,
  logoutInstance,
  getTemplates,
  saveTemplates,
  renderTemplate,
  TEMPLATE_STATUSES,
  AUDIENCE_FILTERS,
  audienceList,
  startCampaign,
  listCampaigns,
};
