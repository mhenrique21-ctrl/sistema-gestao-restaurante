const pool = require('../db/pool');

// Envia o faturamento do dia para o App Gestão, que é onde vive a DRE.
//
// Regra que dá o tom deste módulo: o fechamento do caixa NUNCA pode falhar por
// causa desta integração. Nada aqui lança para fora — o pior caso é a linha
// ficar na fila e ir no próximo fechamento.

const GESTAO_URL = process.env.GESTAO_URL || 'https://gestao.confrariacafe.com';
const EMPRESA = 'SEAMA';

// Crédito, débito e pix caem todos na mesma maquininha (confirmado pelo dono),
// e o Gestão tem só os campos "dinheiro" e "maquininha".
const NA_MAQUININHA = ['cartao_credito', 'cartao_debito', 'pix'];

function hojeBelem() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Belem' });
}

// Soma as vendas concluídas da data — do dia inteiro, não do turno. Venda
// cancelada não entra, então um cancelamento feito antes do fechamento já sai
// descontado daqui sem tratamento especial.
async function totaisDoDia(data) {
  const r = await pool.query(
    `SELECT sp.method, COALESCE(SUM(sp.amount), 0) AS valor
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
      WHERE s.status = 'concluida'
        AND DATE(s.created_at AT TIME ZONE 'America/Belem') = $1
      GROUP BY sp.method`,
    [data]
  );
  let dinheiro = 0;
  let maquininha = 0;
  r.rows.forEach((row) => {
    const v = parseFloat(row.valor) || 0;
    if (row.method === 'dinheiro') dinheiro += v;
    else if (NA_MAQUININHA.includes(row.method)) maquininha += v;
    else maquininha += v; // método novo cai na maquininha em vez de sumir do total
  });
  return {
    dinheiro: Math.round(dinheiro * 100) / 100,
    maquininha: Math.round(maquininha * 100) / 100,
    total: Math.round((dinheiro + maquininha) * 100) / 100,
  };
}

// Mesma agregação por hora que /api/reports/patterns já expõe pro gerente,
// só que pra um dia só e sem o `vendas` (contagem) — o Gestão só usa o valor.
// Calculado na hora do envio (não fica guardado na fila gestao_sync) porque é
// barato de recalcular e assim não precisa de coluna nova nessa tabela.
async function porHoraDoDia(data) {
  const r = await pool.query(
    `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Belem')::int AS hora,
            COALESCE(SUM(total), 0) AS valor
       FROM sales
      WHERE status = 'concluida'
        AND DATE(created_at AT TIME ZONE 'America/Belem') = $1
      GROUP BY hora ORDER BY hora`,
    [data]
  );
  return r.rows.map((row) => ({ hora: row.hora, valor: Math.round(parseFloat(row.valor) * 100) / 100 }));
}

// Recalcula e marca o dia como pendente de envio.
async function enfileirar(data) {
  const t = await totaisDoDia(data);
  await pool.query(
    `INSERT INTO gestao_sync (sale_date, dinheiro, maquininha, total, sent_at, updated_at)
     VALUES ($1, ${t.dinheiro}, ${t.maquininha}, ${t.total}, NULL, NOW())
     ON CONFLICT (sale_date) DO UPDATE
        SET dinheiro = ${t.dinheiro}, maquininha = ${t.maquininha}, total = ${t.total},
            sent_at = NULL, updated_at = NOW()
     RETURNING sale_date`,
    [data]
  );
  return t;
}

async function enviarUm(linha) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    // Falha aqui não pode derrubar o envio do total do dia — sem hora vira
    // array vazio, e o Gestão simplesmente não tem o detalhamento por hora.
    const porHora = await porHoraDoDia(linha.sale_date).catch(() => []);
    const res = await fetch(`${GESTAO_URL}/api/venda-pdv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': process.env.SERVICE_SECRET || '' },
      body: JSON.stringify({
        empresa: EMPRESA,
        data: linha.sale_date,
        dinheiro: parseFloat(linha.dinheiro),
        maquininha: parseFloat(linha.maquininha),
        total: parseFloat(linha.total),
        porHora,
      }),
      signal: ctrl.signal,
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo.error || `HTTP ${res.status}`);
    await pool.query(
      `UPDATE gestao_sync SET sent_at = NOW(), last_error = NULL, attempts = attempts + 1
        WHERE sale_date = $1 RETURNING sale_date`,
      [linha.sale_date]
    );
    return { data: linha.sale_date, ok: true };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await pool.query(
      `UPDATE gestao_sync SET attempts = attempts + 1, last_error = $2 WHERE sale_date = $1 RETURNING sale_date`,
      [linha.sale_date, msg]
    );
    console.error(`[gestaoSync] falha ao enviar ${linha.sale_date}: ${msg}`);
    return { data: linha.sale_date, ok: false, erro: msg };
  }
}

// Tenta TODOS os dias pendentes, não só o de hoje: é assim que um dia que
// falhou porque o Gestão estava fora do ar sobe sozinho no próximo fechamento.
async function enviarPendentes() {
  if (!process.env.SERVICE_SECRET) return { enviados: 0, falhas: 0, motivo: 'SERVICE_SECRET não configurado' };
  const r = await pool.query(
    `SELECT sale_date, dinheiro, maquininha, total FROM gestao_sync
      WHERE sent_at IS NULL ORDER BY sale_date`
  );
  const out = [];
  for (const linha of r.rows) out.push(await enviarUm(linha));
  return {
    enviados: out.filter((x) => x.ok).length,
    falhas: out.filter((x) => !x.ok).length,
    detalhes: out,
  };
}

// Chamado a cada venda concluída (ver routes/sales.js) — dispara em segundo
// plano, de propósito sem await no caminho da venda: o operador não pode
// esperar a chamada ao Gestão pra ver a confirmação na tela. Erro aqui nunca
// chega ao operador, só no log; a sincronização periódica e o fechamento de
// caixa continuam como rede de segurança se esta tentativa falhar.
function avisarVenda() {
  enfileirar(hojeBelem())
    .then(() => enviarPendentes())
    .catch((e) => console.error('[gestaoSync] erro ao avisar venda:', e.message));
}

// Chamado ao fechar o caixa. Envolvido em try/catch de propósito: qualquer
// erro aqui é registrado e engolido, para o fechamento seguir normalmente.
async function aoFecharCaixa(data) {
  try {
    await enfileirar(data || hojeBelem());
    const r = await enviarPendentes();
    // Rede de segurança: qualquer sangria que tenha ficado pendente (Gestão
    // fora do ar no momento em que foi registrada) tenta subir de novo aqui.
    await enviarSangriasPendentes().catch((e) => console.error('[gestaoSync] erro ao reenviar sangrias pendentes no fechamento:', e.message));
    return r;
  } catch (e) {
    console.error('[gestaoSync] erro ao sincronizar com o Gestão:', e.message);
    return { enviados: 0, falhas: 1, erro: e.message };
  }
}

// Só faz sentido gastar ciclo com isso enquanto alguém pode estar vendendo —
// com o caixa fechado o faturamento do dia não muda mais até a próxima
// abertura, então rodar a cada minuto seria consulta e request vazios.
async function caixaAberto() {
  const r = await pool.query(`SELECT 1 FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);
  return r.rows.length > 0;
}

// Antes deste job, o Gestão só recebia o faturamento do dia quando o caixa
// fechava (normalmente à noite) — "Faturamento diário — hoje" no Dashboard
// ficava em R$ 0,00 o dia inteiro até lá. Isso recalcula e reenvia o dia
// corrente em intervalos, então o Dashboard passa a refletir o movimento de
// hoje quase em tempo real, sem esperar o fechamento. O fechamento de caixa
// continua sendo a fonte definitiva (mesmo UPSERT idempotente por sale_date,
// então não duplica nem conflita com esta sincronização periódica).
function iniciarSincronizacaoPeriodica() {
  const minutos = parseFloat(process.env.GESTAO_SYNC_INTERVAL_MIN) || 1;
  const intervaloMs = minutos * 60 * 1000;
  const rodar = async () => {
    try {
      if (!(await caixaAberto())) return;
      await enfileirar(hojeBelem());
      await enviarPendentes();
      await enviarSangriasPendentes();
    } catch (e) {
      console.error('[gestaoSync] erro na sincronização periódica:', e.message);
    }
  };
  rodar(); // primeira rodada já na subida do processo, não espera o 1º intervalo
  const timer = setInterval(rodar, intervaloMs);
  console.log(`[gestaoSync] sincronização periódica com o Gestão a cada ${minutos} min (só com caixa aberto)`);
  return timer;
}

// Sangria categorizada vira conta paga na Gestão (Financeiro > Contas).
// Antes disso era um único fetch fire-and-forget: se a Gestão estivesse fora
// do ar no exato instante da sangria, o evento se perdia pra sempre — nada
// ficava guardado pra tentar de novo depois. Agora a sangria primeiro vai
// pra uma fila durável (gestao_sync_sangria), igual o faturamento do dia já
// fazia em gestao_sync — só some da fila depois de a Gestão confirmar 200.
let _tabelaSangriaPronta = null;
function garantirTabelaSangria() {
  if (!_tabelaSangriaPronta) {
    _tabelaSangriaPronta = pool.query(`
      CREATE TABLE IF NOT EXISTS gestao_sync_sangria (
        movimento_id VARCHAR(100) PRIMARY KEY,
        categoria VARCHAR(150),
        valor NUMERIC(10,2) NOT NULL,
        motivo TEXT,
        data DATE,
        sent_at TIMESTAMPTZ,
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((e) => { _tabelaSangriaPronta = null; throw e; });
  }
  return _tabelaSangriaPronta;
}

// Grava a sangria na fila. movimentoId dá idempotência: reenfileirar a mesma
// sangria (ex: retry do caller) não cria linha duplicada.
async function enfileirarSangria({ movimentoId, categoria, valor, motivo, data }) {
  await garantirTabelaSangria();
  await pool.query(
    `INSERT INTO gestao_sync_sangria (movimento_id, categoria, valor, motivo, data)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (movimento_id) DO NOTHING`,
    [movimentoId, categoria, valor, motivo, data]
  );
}

async function enviarSangriaUm(linha) {
  const secret = process.env.SERVICE_SECRET;
  if (!secret) { console.error('[gestaoSync/sangria] SERVICE_SECRET não configurado'); return { ok: false }; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${GESTAO_URL}/api/sangria-pdv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': secret },
      body: JSON.stringify({ empresa: EMPRESA, categoria: linha.categoria, valor: parseFloat(linha.valor), motivo: linha.motivo, data: linha.data, movimentoId: linha.movimento_id }),
      signal: ctrl.signal,
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(corpo.error || `HTTP ${res.status}`);
    await pool.query(
      `UPDATE gestao_sync_sangria SET sent_at = NOW(), last_error = NULL, attempts = attempts + 1
        WHERE movimento_id = $1 RETURNING movimento_id`,
      [linha.movimento_id]
    );
    return { movimentoId: linha.movimento_id, ok: true };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await pool.query(
      `UPDATE gestao_sync_sangria SET attempts = attempts + 1, last_error = $2 WHERE movimento_id = $1 RETURNING movimento_id`,
      [linha.movimento_id, msg]
    );
    console.error(`[gestaoSync/sangria] falha ao enviar sangria ${linha.movimento_id}: ${msg}`);
    return { movimentoId: linha.movimento_id, ok: false, erro: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Tenta TODAS as sangrias pendentes, não só a mais recente — é assim que uma
// sangria que falhou porque a Gestão estava fora do ar sobe sozinha depois.
async function enviarSangriasPendentes() {
  await garantirTabelaSangria();
  if (!process.env.SERVICE_SECRET) return { enviados: 0, falhas: 0, motivo: 'SERVICE_SECRET não configurado' };
  const r = await pool.query(
    `SELECT movimento_id, categoria, valor, motivo, data FROM gestao_sync_sangria
      WHERE sent_at IS NULL ORDER BY created_at`
  );
  const out = [];
  for (const linha of r.rows) out.push(await enviarSangriaUm(linha));
  return { enviados: out.filter((x) => x.ok).length, falhas: out.filter((x) => !x.ok).length, detalhes: out };
}

// Chamado a cada sangria registrada no caixa — enfileira (grava durável) e já
// tenta mandar na hora; se falhar, a linha fica pendente e o job periódico
// (mesmo timer do faturamento, ver iniciarSincronizacaoPeriodica) e o
// fechamento de caixa tentam de novo depois. Sem await de propósito: o
// operador não espera a chamada à Gestão pra ver a sangria confirmada.
function enviarSangria(evento) {
  enfileirarSangria(evento)
    .then(() => enviarSangriasPendentes())
    .catch((e) => console.error('[gestaoSync/sangria] erro ao enfileirar sangria:', e.message));
}

module.exports = {
  aoFecharCaixa, avisarVenda, enviarPendentes, enfileirar, totaisDoDia, hojeBelem,
  iniciarSincronizacaoPeriodica, enviarSangria, enviarSangriasPendentes,
};
