require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false }, realtime: { transport: ws } }
);

// Lê chave do env ou do arquivo .env
function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const match = envFile.match(/ANTHROPIC_API_KEY=(.+)/);
    return match ? match[1].trim() : '';
  } catch(e) { return ''; }
}
const API_KEY = getApiKey();

// ── Persistência (Supabase) ────────────────────────────
async function runSql(query) {
  const { data, error } = await supabase.rpc('run_sql', { query });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}
function escJson(v) {
  return `'${JSON.stringify(v ?? []).replace(/'/g, "''")}'::jsonb`;
}

async function loadDB() {
  const [categorias, lancamentos, compras, fichas, funcionarios, eventos, faltasRaw, adiantRaw] = await Promise.all([
    runSql(`SELECT nome FROM erp_categorias ORDER BY sort_order, nome`),
    runSql(`SELECT data, descricao AS desc, categoria AS cat, forma, empresa_id AS emp, valor, tipo, status FROM erp_lancamentos ORDER BY created_at DESC`),
    runSql(`SELECT id, fornecedor AS forn, data, categoria AS cat, cnpj, empresa_id AS emp, total, status, itens FROM erp_compras ORDER BY created_at DESC`),
    runSql(`SELECT nome, categoria AS cat, preco, custo, ingredientes AS ingr, preparo FROM erp_fichas_tecnicas ORDER BY created_at ASC`),
    runSql(`SELECT id, nome, cargo, empresa_id AS emp, salario AS sal, admissao AS adm, status FROM erp_funcionarios ORDER BY created_at ASC`),
    runSql(`SELECT titulo, data, hora, tipo, empresa_id AS emp, nota FROM erp_eventos ORDER BY data ASC`),
    runSql(`SELECT funcionario_id, data, tipo, qtd, desconto, obs FROM erp_faltas ORDER BY created_at DESC`),
    runSql(`SELECT funcionario_id, data, valor, forma, status, obs FROM erp_adiantamentos ORDER BY created_at DESC`),
  ]);

  const funcIndexById = {};
  funcionarios.forEach((f, i) => { funcIndexById[f.id] = i; });

  const faltas = faltasRaw.map(fa => ({
    funcIdx: funcIndexById[fa.funcionario_id] ?? 0,
    funcNome: funcionarios[funcIndexById[fa.funcionario_id]]?.nome || '',
    data: fa.data, tipo: fa.tipo, qtd: parseFloat(fa.qtd), desconto: parseFloat(fa.desconto), obs: fa.obs,
  }));
  const adiantamentos = adiantRaw.map(a => ({
    funcIdx: funcIndexById[a.funcionario_id] ?? 0,
    funcNome: funcionarios[funcIndexById[a.funcionario_id]]?.nome || '',
    data: a.data, valor: parseFloat(a.valor), forma: a.forma, status: a.status, obs: a.obs,
  }));

  return {
    lancamentos: lancamentos.map(l => ({ data: l.data, desc: l.desc, cat: l.cat, forma: l.forma, emp: l.emp, valor: parseFloat(l.valor), tipo: l.tipo, status: l.status })),
    compras: compras.map(c => ({ id: Number(c.id), forn: c.forn, data: c.data, cat: c.cat, cnpj: c.cnpj, emp: c.emp, total: parseFloat(c.total), status: c.status, itens: c.itens })),
    fichas: fichas.map(f => ({ nome: f.nome, cat: f.cat, preco: parseFloat(f.preco), custo: parseFloat(f.custo), ingr: f.ingr, preparo: f.preparo })),
    funcionarios: funcionarios.map(f => ({ nome: f.nome, cargo: f.cargo, emp: f.emp, sal: parseFloat(f.sal), adm: f.adm, status: f.status })),
    eventos: eventos.map(e => ({ titulo: e.titulo, data: e.data, hora: e.hora, tipo: e.tipo, emp: e.emp, nota: e.nota })),
    faltas,
    adiantamentos,
    categorias: categorias.map(c => c.nome),
  };
}

// Cada save substitui o conteúdo das tabelas pelo estado atual enviado pelo
// app (mesmo comportamento do dados.json anterior, que também era
// sobrescrito por inteiro a cada alteração).
async function saveDB(d) {
  await runSql(`DELETE FROM erp_faltas WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_adiantamentos WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_lancamentos WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_compras WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_fichas_tecnicas WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_eventos WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_funcionarios WHERE true RETURNING id`);
  await runSql(`DELETE FROM erp_categorias WHERE true RETURNING id`);

  const categorias = Array.isArray(d.categorias) ? d.categorias : [];
  for (let i = 0; i < categorias.length; i++) {
    await runSql(`INSERT INTO erp_categorias (nome, sort_order) VALUES (${esc(categorias[i])}, ${i}) ON CONFLICT (nome) DO NOTHING RETURNING id`);
  }

  const funcionarios = Array.isArray(d.funcionarios) ? d.funcionarios : [];
  const funcIds = [];
  for (const f of funcionarios) {
    const rows = await runSql(`INSERT INTO erp_funcionarios (nome, cargo, empresa_id, salario, admissao, status) VALUES (${esc(f.nome)}, ${esc(f.cargo)}, ${esc(f.emp)}, ${esc(f.sal)}, ${esc(f.adm)}, ${esc(f.status)}) RETURNING id`);
    funcIds.push(rows[0].id);
  }

  for (const l of (Array.isArray(d.lancamentos) ? d.lancamentos : [])) {
    await runSql(`INSERT INTO erp_lancamentos (data, descricao, categoria, forma, empresa_id, valor, tipo, status) VALUES (${esc(l.data)}, ${esc(l.desc)}, ${esc(l.cat)}, ${esc(l.forma)}, ${esc(l.emp)}, ${esc(l.valor)}, ${esc(l.tipo)}, ${esc(l.status)}) RETURNING id`);
  }

  for (const c of (Array.isArray(d.compras) ? d.compras : [])) {
    await runSql(`INSERT INTO erp_compras (id, fornecedor, data, categoria, cnpj, empresa_id, total, status, itens) VALUES (${esc(c.id)}, ${esc(c.forn)}, ${esc(c.data)}, ${esc(c.cat)}, ${esc(c.cnpj)}, ${esc(c.emp)}, ${esc(c.total)}, ${esc(c.status)}, ${escJson(c.itens)}) RETURNING id`);
  }

  for (const f of (Array.isArray(d.fichas) ? d.fichas : [])) {
    await runSql(`INSERT INTO erp_fichas_tecnicas (nome, categoria, preco, custo, ingredientes, preparo) VALUES (${esc(f.nome)}, ${esc(f.cat)}, ${esc(f.preco)}, ${esc(f.custo)}, ${escJson(f.ingr)}, ${esc(f.preparo)}) RETURNING id`);
  }

  for (const e of (Array.isArray(d.eventos) ? d.eventos : [])) {
    await runSql(`INSERT INTO erp_eventos (titulo, data, hora, tipo, empresa_id, nota) VALUES (${esc(e.titulo)}, ${esc(e.data)}, ${esc(e.hora)}, ${esc(e.tipo)}, ${esc(e.emp)}, ${esc(e.nota)}) RETURNING id`);
  }

  for (const fa of (Array.isArray(d.faltas) ? d.faltas : [])) {
    const fid = funcIds[fa.funcIdx];
    if (!fid) continue;
    await runSql(`INSERT INTO erp_faltas (funcionario_id, data, tipo, qtd, desconto, obs) VALUES (${fid}, ${esc(fa.data)}, ${esc(fa.tipo)}, ${esc(fa.qtd)}, ${esc(fa.desconto)}, ${esc(fa.obs)}) RETURNING id`);
  }

  for (const a of (Array.isArray(d.adiantamentos) ? d.adiantamentos : [])) {
    const fid = funcIds[a.funcIdx];
    if (!fid) continue;
    await runSql(`INSERT INTO erp_adiantamentos (funcionario_id, data, valor, forma, status, obs) VALUES (${fid}, ${esc(a.data)}, ${esc(a.valor)}, ${esc(a.forma)}, ${esc(a.status)}, ${esc(a.obs)}) RETURNING id`);
  }
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
    loadDB().then(data => {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(data));
    }).catch(e => {
      console.error('[loadDB]', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // Save DB
  if (req.method === 'POST' && req.url === '/dados') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch(e) {
        res.writeHead(400);
        res.end('erro: ' + e.message);
        return;
      }
      saveDB(parsed).then(() => {
        res.writeHead(200);
        res.end('ok');
      }).catch(e => {
        console.error('[saveDB]', e.message);
        res.writeHead(500);
        res.end('erro: ' + e.message);
      });
    });
    return;
  }

  // Proxy IA - cupom scan
  if (req.method === 'POST' && req.url === '/api/scan') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const data = JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
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

server.timeout = 120000; // 2 min para chamadas IA com imagem grande

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Banco: Supabase (${process.env.SUPABASE_URL ? 'configurado' : 'AUSENTE'})`);
  console.log(`API Key: ${API_KEY ? '✅ configurada (' + API_KEY.substring(0,20) + '...)' : '❌ AUSENTE'}`);
});
