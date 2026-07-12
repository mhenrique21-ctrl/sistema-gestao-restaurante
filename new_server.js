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
    runSql(`SELECT id, nome FROM erp_categorias ORDER BY sort_order, nome`),
    runSql(`SELECT id, data, descricao AS desc, categoria AS cat, forma, empresa_id AS emp, valor, tipo, status FROM erp_lancamentos ORDER BY created_at DESC`),
    runSql(`SELECT id, fornecedor AS forn, data, categoria AS cat, cnpj, empresa_id AS emp, total, status, itens FROM erp_compras ORDER BY created_at DESC`),
    runSql(`SELECT id, nome, categoria AS cat, preco, custo, ingredientes AS ingr, preparo FROM erp_fichas_tecnicas ORDER BY created_at ASC`),
    runSql(`SELECT id, nome, cargo, empresa_id AS emp, salario AS sal, admissao AS adm, status FROM erp_funcionarios ORDER BY created_at ASC`),
    runSql(`SELECT id, titulo, data, hora, tipo, empresa_id AS emp, nota FROM erp_eventos ORDER BY data ASC`),
    runSql(`SELECT id, funcionario_id, data, tipo, qtd, desconto, obs FROM erp_faltas ORDER BY created_at DESC`),
    runSql(`SELECT id, funcionario_id, data, valor, forma, status, obs FROM erp_adiantamentos ORDER BY created_at DESC`),
  ]);

  const funcionariosOut = funcionarios.map(f => ({ id: f.id, nome: f.nome, cargo: f.cargo, emp: f.emp, sal: parseFloat(f.sal), adm: f.adm, status: f.status }));
  const nomeById = {};
  funcionariosOut.forEach(f => { nomeById[f.id] = f.nome; });

  const faltas = faltasRaw.map(fa => ({
    id: fa.id,
    funcionario_id: fa.funcionario_id,
    funcNome: nomeById[fa.funcionario_id] || '',
    data: fa.data, tipo: fa.tipo, qtd: parseFloat(fa.qtd), desconto: parseFloat(fa.desconto), obs: fa.obs,
  }));
  const adiantamentos = adiantRaw.map(a => ({
    id: a.id,
    funcionario_id: a.funcionario_id,
    funcNome: nomeById[a.funcionario_id] || '',
    data: a.data, valor: parseFloat(a.valor), forma: a.forma, status: a.status, obs: a.obs,
  }));

  return {
    lancamentos: lancamentos.map(l => ({ id: l.id, data: l.data, desc: l.desc, cat: l.cat, forma: l.forma, emp: l.emp, valor: parseFloat(l.valor), tipo: l.tipo, status: l.status })),
    compras: compras.map(c => ({ id: c.id, forn: c.forn, data: c.data, cat: c.cat, cnpj: c.cnpj, emp: c.emp, total: parseFloat(c.total), status: c.status, itens: c.itens })),
    fichas: fichas.map(f => ({ id: f.id, nome: f.nome, cat: f.cat, preco: parseFloat(f.preco), custo: parseFloat(f.custo), ingr: f.ingr, preparo: f.preparo })),
    funcionarios: funcionariosOut,
    eventos: eventos.map(e => ({ id: e.id, titulo: e.titulo, data: e.data, hora: e.hora, tipo: e.tipo, emp: e.emp, nota: e.nota })),
    faltas,
    adiantamentos,
    categorias: categorias.map(c => c.nome),
  };
}

// Upsert puro: cada entidade é gravada pelo seu próprio id (gerado no
// cliente). Nenhuma linha é apagada aqui — exclusão só acontece via
// DELETE /dados/:entidade/:id (ver deleteRecord). Isso permite que outros
// sistemas insiram linhas nas tabelas erp_* sem que um "salvar" no App
// Gestão as apague.
async function saveDB(d) {
  const categorias = Array.isArray(d.categorias) ? d.categorias : [];
  for (let i = 0; i < categorias.length; i++) {
    await runSql(`INSERT INTO erp_categorias (nome, sort_order) VALUES (${esc(categorias[i])}, ${i})
      ON CONFLICT (nome) DO UPDATE SET sort_order = EXCLUDED.sort_order RETURNING id`);
  }

  for (const f of (Array.isArray(d.funcionarios) ? d.funcionarios : [])) {
    if (!f.id) continue;
    await runSql(`INSERT INTO erp_funcionarios (id, nome, cargo, empresa_id, salario, admissao, status)
      VALUES (${esc(f.id)}, ${esc(f.nome)}, ${esc(f.cargo)}, ${esc(f.emp)}, ${esc(f.sal)}, ${esc(f.adm)}, ${esc(f.status)})
      ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, cargo=EXCLUDED.cargo, empresa_id=EXCLUDED.empresa_id,
        salario=EXCLUDED.salario, admissao=EXCLUDED.admissao, status=EXCLUDED.status RETURNING id`);
  }

  for (const l of (Array.isArray(d.lancamentos) ? d.lancamentos : [])) {
    if (!l.id) continue;
    await runSql(`INSERT INTO erp_lancamentos (id, data, descricao, categoria, forma, empresa_id, valor, tipo, status)
      VALUES (${esc(l.id)}, ${esc(l.data)}, ${esc(l.desc)}, ${esc(l.cat)}, ${esc(l.forma)}, ${esc(l.emp)}, ${esc(l.valor)}, ${esc(l.tipo)}, ${esc(l.status)})
      ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, descricao=EXCLUDED.descricao, categoria=EXCLUDED.categoria,
        forma=EXCLUDED.forma, empresa_id=EXCLUDED.empresa_id, valor=EXCLUDED.valor, tipo=EXCLUDED.tipo, status=EXCLUDED.status RETURNING id`);
  }

  for (const c of (Array.isArray(d.compras) ? d.compras : [])) {
    if (!c.id) continue;
    await runSql(`INSERT INTO erp_compras (id, fornecedor, data, categoria, cnpj, empresa_id, total, status, itens)
      VALUES (${esc(c.id)}, ${esc(c.forn)}, ${esc(c.data)}, ${esc(c.cat)}, ${esc(c.cnpj)}, ${esc(c.emp)}, ${esc(c.total)}, ${esc(c.status)}, ${escJson(c.itens)})
      ON CONFLICT (id) DO UPDATE SET fornecedor=EXCLUDED.fornecedor, data=EXCLUDED.data, categoria=EXCLUDED.categoria,
        cnpj=EXCLUDED.cnpj, empresa_id=EXCLUDED.empresa_id, total=EXCLUDED.total, status=EXCLUDED.status, itens=EXCLUDED.itens RETURNING id`);
  }

  for (const f of (Array.isArray(d.fichas) ? d.fichas : [])) {
    if (!f.id) continue;
    await runSql(`INSERT INTO erp_fichas_tecnicas (id, nome, categoria, preco, custo, ingredientes, preparo)
      VALUES (${esc(f.id)}, ${esc(f.nome)}, ${esc(f.cat)}, ${esc(f.preco)}, ${esc(f.custo)}, ${escJson(f.ingr)}, ${esc(f.preparo)})
      ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, categoria=EXCLUDED.categoria, preco=EXCLUDED.preco,
        custo=EXCLUDED.custo, ingredientes=EXCLUDED.ingredientes, preparo=EXCLUDED.preparo RETURNING id`);
  }

  for (const e of (Array.isArray(d.eventos) ? d.eventos : [])) {
    if (!e.id) continue;
    await runSql(`INSERT INTO erp_eventos (id, titulo, data, hora, tipo, empresa_id, nota)
      VALUES (${esc(e.id)}, ${esc(e.titulo)}, ${esc(e.data)}, ${esc(e.hora)}, ${esc(e.tipo)}, ${esc(e.emp)}, ${esc(e.nota)})
      ON CONFLICT (id) DO UPDATE SET titulo=EXCLUDED.titulo, data=EXCLUDED.data, hora=EXCLUDED.hora, tipo=EXCLUDED.tipo,
        empresa_id=EXCLUDED.empresa_id, nota=EXCLUDED.nota RETURNING id`);
  }

  for (const fa of (Array.isArray(d.faltas) ? d.faltas : [])) {
    if (!fa.id || !fa.funcionario_id) continue;
    await runSql(`INSERT INTO erp_faltas (id, funcionario_id, data, tipo, qtd, desconto, obs)
      VALUES (${esc(fa.id)}, ${esc(fa.funcionario_id)}, ${esc(fa.data)}, ${esc(fa.tipo)}, ${esc(fa.qtd)}, ${esc(fa.desconto)}, ${esc(fa.obs)})
      ON CONFLICT (id) DO UPDATE SET funcionario_id=EXCLUDED.funcionario_id, data=EXCLUDED.data, tipo=EXCLUDED.tipo,
        qtd=EXCLUDED.qtd, desconto=EXCLUDED.desconto, obs=EXCLUDED.obs RETURNING id`);
  }

  for (const a of (Array.isArray(d.adiantamentos) ? d.adiantamentos : [])) {
    if (!a.id || !a.funcionario_id) continue;
    await runSql(`INSERT INTO erp_adiantamentos (id, funcionario_id, data, valor, forma, status, obs)
      VALUES (${esc(a.id)}, ${esc(a.funcionario_id)}, ${esc(a.data)}, ${esc(a.valor)}, ${esc(a.forma)}, ${esc(a.status)}, ${esc(a.obs)})
      ON CONFLICT (id) DO UPDATE SET funcionario_id=EXCLUDED.funcionario_id, data=EXCLUDED.data, valor=EXCLUDED.valor,
        forma=EXCLUDED.forma, status=EXCLUDED.status, obs=EXCLUDED.obs RETURNING id`);
  }
}

const ENTITY_TABLES = {
  lancamentos: 'erp_lancamentos',
  compras: 'erp_compras',
  fichas: 'erp_fichas_tecnicas',
  funcionarios: 'erp_funcionarios',
  eventos: 'erp_eventos',
  faltas: 'erp_faltas',
  adiantamentos: 'erp_adiantamentos',
};

async function deleteRecord(entidade, id) {
  const table = ENTITY_TABLES[entidade];
  if (!table) throw new Error('Entidade inválida: ' + entidade);
  if (!id) throw new Error('id é obrigatório');
  if (table === 'erp_funcionarios') {
    // Sem essas linhas, o DELETE do funcionário quebraria a FK de faltas/adiantamentos.
    await runSql(`DELETE FROM erp_faltas WHERE funcionario_id = ${esc(id)} RETURNING id`);
    await runSql(`DELETE FROM erp_adiantamentos WHERE funcionario_id = ${esc(id)} RETURNING id`);
  }
  await runSql(`DELETE FROM ${table} WHERE id = ${esc(id)} RETURNING id`);
}

const server = http.createServer((req, res) => {
  // No cache headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

  // Delete single record
  if (req.method === 'DELETE' && req.url.startsWith('/dados/')) {
    const parts = req.url.split('/').filter(Boolean); // ['dados', entidade, id]
    const entidade = parts[1];
    const id = decodeURIComponent(parts[2] || '');
    deleteRecord(entidade, id).then(() => {
      res.writeHead(200);
      res.end('ok');
    }).catch(e => {
      console.error('[deleteRecord]', e.message);
      res.writeHead(400);
      res.end('erro: ' + e.message);
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
