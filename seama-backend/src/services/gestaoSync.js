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
    const res = await fetch(`${GESTAO_URL}/api/venda-pdv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': process.env.SERVICE_SECRET || '' },
      body: JSON.stringify({
        empresa: EMPRESA,
        data: linha.sale_date,
        dinheiro: parseFloat(linha.dinheiro),
        maquininha: parseFloat(linha.maquininha),
        total: parseFloat(linha.total),
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

// Chamado ao fechar o caixa. Envolvido em try/catch de propósito: qualquer
// erro aqui é registrado e engolido, para o fechamento seguir normalmente.
async function aoFecharCaixa(data) {
  try {
    await enfileirar(data || hojeBelem());
    return await enviarPendentes();
  } catch (e) {
    console.error('[gestaoSync] erro ao sincronizar com o Gestão:', e.message);
    return { enviados: 0, falhas: 1, erro: e.message };
  }
}

// Antes deste job, o Gestão só recebia o faturamento do dia quando o caixa
// fechava (normalmente à noite) — "Faturamento diário — hoje" no Dashboard
// ficava em R$ 0,00 o dia inteiro até lá. Isso recalcula e reenvia o dia
// corrente em intervalos, então o Dashboard passa a refletir o movimento de
// hoje quase em tempo real, sem esperar o fechamento. O fechamento de caixa
// continua sendo a fonte definitiva (mesmo UPSERT idempotente por sale_date,
// então não duplica nem conflita com esta sincronização periódica).
function iniciarSincronizacaoPeriodica() {
  const minutos = parseInt(process.env.GESTAO_SYNC_INTERVAL_MIN, 10) || 15;
  const intervaloMs = minutos * 60 * 1000;
  const rodar = async () => {
    try {
      await enfileirar(hojeBelem());
      await enviarPendentes();
    } catch (e) {
      console.error('[gestaoSync] erro na sincronização periódica:', e.message);
    }
  };
  rodar(); // primeira rodada já na subida do processo, não espera o 1º intervalo
  const timer = setInterval(rodar, intervaloMs);
  console.log(`[gestaoSync] sincronização periódica com o Gestão a cada ${minutos} min`);
  return timer;
}

module.exports = { aoFecharCaixa, enviarPendentes, enfileirar, totaisDoDia, hojeBelem, iniciarSincronizacaoPeriodica };
