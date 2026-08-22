const pool = require('../db/pool');
const { getCashSummary, todayBelem } = require('./cashSummary');

// Envia o faturamento do dia da Confraria para o App Gestão, que é onde vive a DRE.
// Espelha o gestaoSync.js do PDV Seama (mesma tabela de fila, mesmo endpoint, mesma
// idempotência por data) — a diferença é de onde os totais saem: no Seama é uma
// tabela de vendas só, aqui são três canais (comanda, balcão e delivery), que o
// cashSummary já sabe somar.
//
// Regra que dá o tom deste módulo: fechar comanda, fechar caixa ou receber pedido
// NUNCA pode falhar por causa desta integração. Nada aqui lança para fora — o pior
// caso é a linha ficar na fila e subir na próxima tentativa.

const GESTAO_URL = process.env.GESTAO_URL || 'https://gestao.confrariacafe.com';
const EMPRESA = 'CONFRARIA';

// O Gestão tem só os campos "dinheiro" e "maquininha" pro dinheiro que entrou.
const NA_MAQUININHA = ['cartao_credito', 'cartao_debito', 'pix'];

// Fiado é venda faturada com recebimento adiado: conta no faturamento do dia (é
// o mesmo número que o PDV mostra no fechamento), mas não é dinheiro na gaveta
// nem valor na maquininha. Por isso entra no `total` e fica FORA dos dois baldes
// — jogá-lo na maquininha estouraria a conferência contra o extrato do cartão.
// Não duplica com o desconto em folha: aquilo vira linha de funcionário na
// Gestão (ver /api/consumacao-pdv), não linha de venda.
const FORA_DOS_BALDES = ['fiado'];

// Soma o dia inteiro (não o turno) reaproveitando o mesmo cálculo que a tela
// Caixa e o cupom de fechamento usam — assim o número que sobe pra Gestão é,
// por construção, o mesmo que o operador vê na hora de fechar.
//
// byMethod soma por forma de pagamento ATRAVÉS dos três canais (comanda,
// balcão e delivery) — ou seja, o delivery pago em dinheiro/cartão já vem
// misturado dentro de "dinheiro"/"maquininha". O Gestão quer delivery como
// linha própria (mesma ideia do "Vendas Extras" que já existe pra outros
// canais), então aqui a gente reclassifica: pega o valor de delivery por
// forma de pagamento e SUBTRAI de dinheiro/maquininha antes de mandar — o
// total do dia não muda, só a forma como ele é dividido nas colunas.
async function totaisDoDia(data) {
  const resumo = await getCashSummary(data);
  const porMetodo = resumo.sales.byMethod || {};
  const porMetodoDelivery = resumo.sales.channels?.delivery?.byMethod || {};
  const val = (m) => Math.round((parseFloat(porMetodo[m]) || 0) * 100) / 100;
  const valDelivery = (m) => Math.round((parseFloat(porMetodoDelivery[m]?.total) || 0) * 100) / 100;

  const deliveryDinheiro = valDelivery('dinheiro');
  const deliveryMaquininha = NA_MAQUININHA.reduce((s, m) => s + valDelivery(m), 0);
  const delivery = Math.round((deliveryDinheiro + deliveryMaquininha) * 100) / 100;

  const dinheiro = Math.round((val('dinheiro') - deliveryDinheiro) * 100) / 100;
  const maquininha = Math.round((NA_MAQUININHA.reduce((s, m) => s + val(m), 0) - deliveryMaquininha) * 100) / 100;
  const fiado = FORA_DOS_BALDES.reduce((s, m) => s + val(m), 0);

  return {
    dinheiro,
    maquininha,
    delivery,
    total: Math.round((dinheiro + maquininha + delivery + fiado) * 100) / 100,
  };
}

// Faturamento por hora do dia, juntando os três canais: PDV soma pela hora em que
// a conta foi FECHADA (é quando o dinheiro entra) e delivery pela hora em que o
// pedido entrou. Calculado na hora do envio, não guardado na fila: é barato de
// refazer e evita coluna nova na tabela.
async function porHoraDoDia(data) {
  const r = await pool.query(
    `SELECT hora, COALESCE(SUM(valor), 0) AS valor FROM (
       SELECT EXTRACT(HOUR FROM c.closed_at AT TIME ZONE 'America/Belem')::int AS hora,
              cp.amount AS valor
         FROM comanda_payments cp
         JOIN comandas c ON c.id = cp.comanda_id
        WHERE c.status = 'fechada'
          AND DATE(c.closed_at AT TIME ZONE 'America/Belem') = $1
       UNION ALL
       SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Belem')::int AS hora,
              total AS valor
         FROM orders
        WHERE status != 'cancelado'
          AND DATE(created_at AT TIME ZONE 'America/Belem') = $1
     ) t GROUP BY hora ORDER BY hora`,
    [data]
  );
  return r.rows.map((row) => ({ hora: row.hora, valor: Math.round(parseFloat(row.valor) * 100) / 100 }));
}

// Recalcula e marca o dia como pendente de envio.
async function enfileirar(data) {
  const t = await totaisDoDia(data);
  await pool.query(
    `INSERT INTO gestao_sync (sale_date, dinheiro, maquininha, delivery, total, sent_at, updated_at)
     VALUES ($1, ${t.dinheiro}, ${t.maquininha}, ${t.delivery}, ${t.total}, NULL, NOW())
     ON CONFLICT (sale_date) DO UPDATE
        SET dinheiro = ${t.dinheiro}, maquininha = ${t.maquininha}, delivery = ${t.delivery}, total = ${t.total},
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
    // Falha aqui não pode derrubar o envio do total do dia — sem hora vira array
    // vazio, e o Gestão simplesmente não tem o detalhamento por hora.
    const porHora = await porHoraDoDia(linha.sale_date).catch(() => []);
    const res = await fetch(`${GESTAO_URL.replace(/\/$/, '')}/api/venda-pdv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': process.env.SEAMA_SERVICE_SECRET || '' },
      body: JSON.stringify({
        empresa: EMPRESA,
        data: linha.sale_date,
        dinheiro: parseFloat(linha.dinheiro),
        maquininha: parseFloat(linha.maquininha),
        delivery: parseFloat(linha.delivery) || 0,
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
  } finally {
    clearTimeout(timer);
  }
}

// Tenta TODOS os dias pendentes, não só o de hoje: é assim que um dia que falhou
// porque o Gestão estava fora do ar sobe sozinho na próxima tentativa.
async function enviarPendentes() {
  if (!process.env.SEAMA_SERVICE_SECRET) {
    return { enviados: 0, falhas: 0, motivo: 'SEAMA_SERVICE_SECRET não configurado' };
  }
  const r = await pool.query(
    `SELECT sale_date, dinheiro, maquininha, delivery, total FROM gestao_sync
      WHERE sent_at IS NULL ORDER BY sale_date`
  );
  const out = [];
  for (const linha of r.rows) out.push(await enviarUm(linha));
  return { enviados: out.filter((x) => x.ok).length, falhas: out.filter((x) => !x.ok).length, detalhes: out };
}

// Chamado a cada venda concluída (comanda/balcão fechada, pedido de delivery
// recebido) — dispara em segundo plano, de propósito sem await no caminho da
// venda: o operador não pode esperar a chamada ao Gestão pra ver a confirmação
// na tela. Erro aqui nunca chega ao operador, só no log; o job periódico e o
// fechamento de caixa continuam como rede de segurança.
function avisarVenda() {
  enfileirar(todayBelem())
    .then(() => enviarPendentes())
    .catch((e) => console.error('[gestaoSync] erro ao avisar venda:', e.message));
}

// Chamado ao fechar o caixa. try/catch de propósito: qualquer erro aqui é
// registrado e engolido, pro fechamento seguir normalmente.
async function aoFecharCaixa(data) {
  try {
    await enfileirar(data || todayBelem());
    return await enviarPendentes();
  } catch (e) {
    console.error('[gestaoSync] erro ao sincronizar com o Gestão:', e.message);
    return { enviados: 0, falhas: 1, erro: e.message };
  }
}

// Só faz sentido gastar ciclo com isso enquanto alguém pode estar vendendo — com
// o caixa fechado o faturamento do dia não muda mais até a próxima abertura.
async function caixaAberto() {
  const r = await pool.query(`SELECT 1 FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);
  return r.rows.length > 0;
}

// Sem este job, o Gestão só receberia o faturamento quando o caixa fechasse
// (normalmente à noite) e o Dashboard ficaria em R$ 0,00 o dia inteiro até lá.
// O fechamento de caixa continua sendo a fonte definitiva — o UPSERT é
// idempotente por sale_date, então não duplica nem conflita com este job.
function iniciarSincronizacaoPeriodica() {
  const minutos = parseFloat(process.env.GESTAO_SYNC_INTERVAL_MIN) || 1;
  const rodar = async () => {
    try {
      if (!(await caixaAberto())) return;
      await enfileirar(todayBelem());
      await enviarPendentes();
    } catch (e) {
      console.error('[gestaoSync] erro na sincronização periódica:', e.message);
    }
  };
  rodar();
  const timer = setInterval(rodar, minutos * 60 * 1000);
  console.log(`[gestaoSync] sincronização com o Gestão a cada ${minutos} min (só com caixa aberto)`);
  return timer;
}

module.exports = {
  aoFecharCaixa, avisarVenda, enviarPendentes, enfileirar, totaisDoDia,
  porHoraDoDia, iniciarSincronizacaoPeriodica,
};
