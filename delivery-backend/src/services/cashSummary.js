const pool = require('../db/pool');

// Normaliza os vários formatos de payment_method já gravados (código ou rótulo legado)
// pros 4 baldes usados no resumo do caixa. O que não bate cai em "outros".
const METHOD_BUCKET_SQL = `CASE
  WHEN payment_method IN ('dinheiro') THEN 'dinheiro'
  WHEN payment_method IN ('cartao_credito', 'Cartão de Crédito') THEN 'cartao_credito'
  WHEN payment_method IN ('cartao_debito', 'Cartão de Débito') THEN 'cartao_debito'
  WHEN payment_method IN ('pix', 'pix_auto') THEN 'pix'
  WHEN payment_method IN ('fiado') THEN 'fiado'
  ELSE 'outros'
END`;
// Mesma normalização, mas pra cp.method (comanda_payments) em vez de payment_method direto.
const CP_METHOD_BUCKET_SQL = `CASE
  WHEN cp.method IN ('dinheiro') THEN 'dinheiro'
  WHEN cp.method IN ('cartao_credito', 'Cartão de Crédito') THEN 'cartao_credito'
  WHEN cp.method IN ('cartao_debito', 'Cartão de Débito') THEN 'cartao_debito'
  WHEN cp.method IN ('pix', 'pix_auto') THEN 'pix'
  WHEN cp.method IN ('fiado') THEN 'fiado'
  ELSE 'outros'
END`;
// Fiado é forma de pagamento da VENDA, não entrada de dinheiro. Precisa
// aparecer aqui, senão ele cai em "outros": some da tabela por forma mas
// continua no total, e o fechamento fica com uma diferença sem explicação.
// O esperado na gaveta não muda — ele só soma 'dinheiro' (ver dinheiroNaGaveta).
const SALE_METHODS = ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix', 'fiado'];
const SALE_CHANNELS = ['comanda', 'balcao', 'delivery'];

// "Hoje" no fuso de Belém (não UTC) — depois das 21h local já é o dia seguinte em UTC,
// então usar toISOString().slice(0,10) faz o caixa "sumir" no fim do expediente.
function todayBelem() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Belem' });
}

// Resumo do caixa do dia: movimentações (abertura/sangria/suprimento) + vendas por
// canal (comanda/balcão/delivery) e forma de pagamento. Usado tanto pela tela (Caixa)
// quanto pela impressão do fechamento.
async function getCashSummary(date) {
  const result = await pool.query(
    `SELECT cm.id, cm.type, cm.amount, cm.reason, cm.breakdown, cm.created_at,
            u.name AS created_by_name
     FROM cash_movements cm
     LEFT JOIN users u ON u.id = cm.created_by
     WHERE DATE(cm.created_at AT TIME ZONE 'America/Belem') = $1
     ORDER BY cm.created_at ASC`,
    [date]
  );
  const abertura = result.rows.filter((r) => r.type === 'abertura').reduce((s, r) => s + parseFloat(r.amount), 0);
  const sangrias = result.rows.filter((r) => r.type === 'sangria').reduce((s, r) => s + parseFloat(r.amount), 0);
  const suprimentos = result.rows.filter((r) => r.type === 'suprimento').reduce((s, r) => s + parseFloat(r.amount), 0);

  // Balcão = venda avulsa (code prefixado "balcao_", ver POST /comandas/balcao);
  // qualquer outro código fechado é comanda (cartão físico / mesa). Soma por
  // comanda_payments (não comandas.payment_method) pra não perder o detalhe de
  // pagamentos mistos — ali a comanda inteira vira "misto" e cairia em "outros".
  const pdvRows = await pool.query(
    `SELECT (CASE WHEN c.code LIKE 'balcao_%' THEN 'balcao' ELSE 'comanda' END) AS channel,
            ${CP_METHOD_BUCKET_SQL} AS method, COUNT(*) AS qty, COALESCE(SUM(cp.amount), 0) AS total
     FROM comanda_payments cp
     JOIN comandas c ON c.id = cp.comanda_id
     WHERE c.status = 'fechada' AND DATE(c.closed_at AT TIME ZONE 'America/Belem') = $1
     GROUP BY channel, method`,
    [date]
  );
  const deliveryRows = await pool.query(
    `SELECT ${METHOD_BUCKET_SQL} AS method, COUNT(*) AS qty, COALESCE(SUM(total), 0) AS total
     FROM orders
     WHERE status != 'cancelado' AND DATE(created_at AT TIME ZONE 'America/Belem') = $1
     GROUP BY method`,
    [date]
  );

  const channels = {};
  for (const ch of SALE_CHANNELS) {
    channels[ch] = { byMethod: {}, total: 0 };
    for (const m of SALE_METHODS) channels[ch].byMethod[m] = { qty: 0, total: 0 };
  }
  for (const row of pdvRows.rows) {
    const total = parseFloat(row.total);
    if (SALE_METHODS.includes(row.method)) {
      channels[row.channel].byMethod[row.method] = { qty: parseInt(row.qty, 10), total };
    }
    channels[row.channel].total += total;
  }
  for (const row of deliveryRows.rows) {
    const total = parseFloat(row.total);
    if (SALE_METHODS.includes(row.method)) {
      channels.delivery.byMethod[row.method] = { qty: parseInt(row.qty, 10), total };
    }
    channels.delivery.total += total;
  }

  const byMethod = {};
  for (const m of SALE_METHODS) {
    byMethod[m] = SALE_CHANNELS.reduce((s, ch) => s + channels[ch].byMethod[m].total, 0);
  }
  const totalGeral = SALE_CHANNELS.reduce((s, ch) => s + channels[ch].total, 0);

  const dinheiroPdv = channels.comanda.byMethod.dinheiro.total + channels.balcao.byMethod.dinheiro.total;
  const saldo = abertura + suprimentos - sangrias + dinheiroPdv;

  return {
    date,
    movements: [...result.rows].reverse(),
    totals: { abertura, sangrias, suprimentos, saldo },
    sales: { channels, byMethod, totalGeral },
  };
}

// ── Turno de caixa ────────────────────────────────────────────────────
// Diferente de getCashSummary, que apura por DATA, aqui a apuração é pela
// JANELA do turno (abertura até fechamento, ou até agora se ainda aberto).
// Um dia que vira com a loja aberta continua no mesmo turno, e um dia com dois
// turnos não mistura a conferência de um com a do outro.

async function getOpenSession() {
  const r = await pool.query(
    `SELECT cs.*, u.name AS opened_by_name
       FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.opened_by
      WHERE cs.status = 'aberto' LIMIT 1`
  );
  return r.rows[0] || null;
}

// Dinheiro que está FISICAMENTE na gaveta ao fechar.
//
// Entra: comanda, balcão e retirada pagos em dinheiro — o cliente pagou no
// balcão, a nota está ali. Não entra: entrega, porque no momento do
// fechamento o dinheiro ainda está com o entregador. iFood e 99food não
// aparecem aqui de forma alguma: não passam pelo PDV, só entram como
// faturamento no App Gestão.
//
// Cartão e pix entram no faturamento do turno, mas nunca no valor a conferir.
async function getSessionSummary(session) {
  const ini = session.opened_at;
  const fim = session.closed_at || new Date().toISOString();

  const movs = await pool.query(
    `SELECT cm.id, cm.type, cm.amount, cm.reason, cm.created_at, u.name AS created_by_name
       FROM cash_movements cm LEFT JOIN users u ON u.id = cm.created_by
      WHERE cm.session_id = $1 ORDER BY cm.created_at ASC`,
    [session.id]
  );
  const soma = (t) => movs.rows.filter((r) => r.type === t).reduce((s, r) => s + parseFloat(r.amount), 0);
  const sangrias = soma('sangria');
  const suprimentos = soma('suprimento');

  const pdvRows = await pool.query(
    `SELECT (CASE WHEN c.code LIKE 'balcao_%' THEN 'balcao' ELSE 'comanda' END) AS channel,
            ${CP_METHOD_BUCKET_SQL} AS method, COUNT(*) AS qty, COALESCE(SUM(cp.amount), 0) AS total
       FROM comanda_payments cp JOIN comandas c ON c.id = cp.comanda_id
      WHERE c.status = 'fechada' AND c.closed_at >= $1 AND c.closed_at <= $2
      GROUP BY channel, method`,
    [ini, fim]
  );
  const delivRows = await pool.query(
    `SELECT COALESCE(delivery_type, 'delivery') AS tipo, ${METHOD_BUCKET_SQL} AS method,
            COUNT(*) AS qty, COALESCE(SUM(total), 0) AS total
       FROM orders
      WHERE status <> 'cancelado' AND created_at >= $1 AND created_at <= $2
      GROUP BY tipo, method`,
    [ini, fim]
  );

  // Contagem de vendas de verdade, pra calcular ticket médio. Não dá pra somar
  // o qty por forma de pagamento: uma comanda paga metade no cartão e metade em
  // dinheiro tem duas linhas em comanda_payments e viraria duas vendas.
  const ticketRows = await pool.query(
    `SELECT (CASE WHEN c.code LIKE 'balcao_%' THEN 'balcao' ELSE 'comanda' END) AS channel,
            COUNT(*) AS tickets
       FROM comandas c
      WHERE c.status = 'fechada' AND c.closed_at >= $1 AND c.closed_at <= $2
      GROUP BY channel`,
    [ini, fim]
  );

  const channels = {};
  for (const ch of SALE_CHANNELS) {
    channels[ch] = { byMethod: {}, total: 0, tickets: 0 };
    for (const m of SALE_METHODS) channels[ch].byMethod[m] = { qty: 0, total: 0 };
  }
  const soma1 = (ch, method, qty, total) => {
    if (SALE_METHODS.includes(method)) {
      channels[ch].byMethod[method].qty += qty;
      channels[ch].byMethod[method].total += total;
    }
    channels[ch].total += total;
  };
  pdvRows.rows.forEach((r) => soma1(r.channel, r.method, parseInt(r.qty, 10), parseFloat(r.total)));
  ticketRows.rows.forEach((r) => { channels[r.channel].tickets = parseInt(r.tickets, 10); });

  let dinheiroRetirada = 0;
  delivRows.rows.forEach((r) => {
    const total = parseFloat(r.total);
    const qty = parseInt(r.qty, 10);
    soma1('delivery', r.method, qty, total);
    // Um pedido de entrega tem uma forma de pagamento só, então aqui somar o
    // qty é a contagem certa de vendas.
    channels.delivery.tickets += qty;
    if (r.method === 'dinheiro' && r.tipo === 'retirada') dinheiroRetirada += total;
  });

  const byMethod = {};
  for (const m of SALE_METHODS) {
    byMethod[m] = SALE_CHANNELS.reduce((s, ch) => s + channels[ch].byMethod[m].total, 0);
  }
  const totalGeral = SALE_CHANNELS.reduce((s, ch) => s + channels[ch].total, 0);

  // Recebimento de fiado: dinheiro de uma venda de OUTRO dia chegando hoje.
  // Entra na gaveta e NUNCA no faturamento — a receita já foi contada quando a
  // venda fiada aconteceu. Somar de novo faturaria duas vezes o mesmo café.
  // Por isso fica fora de channels/byMethod e entra só na conta da gaveta.
  const fiadoRows = await pool.query(
    `SELECT payment_method AS method, COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS qty
       FROM credit_entries
      WHERE tipo = 'pagamento' AND created_at >= $1 AND created_at <= $2
      GROUP BY payment_method`,
    [ini, fim]
  );
  let fiadoDinheiro = 0, fiadoEletronico = 0, fiadoRecebido = 0;
  fiadoRows.rows.forEach((r) => {
    const v = parseFloat(r.total);
    fiadoRecebido += v;
    if (r.method === 'dinheiro') fiadoDinheiro += v;
    else fiadoEletronico += v;
  });

  const dinheiroNaGaveta =
    channels.comanda.byMethod.dinheiro.total +
    channels.balcao.byMethod.dinheiro.total +
    dinheiroRetirada +
    fiadoDinheiro;

  const abertura = parseFloat(session.opening_amount) || 0;
  const expected = abertura + suprimentos - sangrias + dinheiroNaGaveta;

  // Eletrônico = o que NÃO está na gaveta e precisa bater com o extrato da
  // maquininha e do banco. É a outra metade da conferência, e até agora
  // nenhuma tela dizia qual era.
  const eletronico = byMethod.cartao_debito + byMethod.cartao_credito + byMethod.pix + fiadoEletronico;
  const tickets = SALE_CHANNELS.reduce((s, ch) => s + channels[ch].tickets, 0);

  return {
    movements: [...movs.rows].reverse(),
    totals: { abertura, sangrias, suprimentos, dinheiroNaGaveta, dinheiroRetirada, eletronico, tickets,
              ticketMedio: tickets ? Math.round((totalGeral / tickets) * 100) / 100 : 0,
              // Separado de propósito: a tela precisa poder explicar de onde veio
              // dinheiro que não corresponde a nenhuma venda de hoje.
              fiadoRecebido, fiadoDinheiro },
    sales: { channels, byMethod, totalGeral },
    expected: Math.round(expected * 100) / 100,
  };
}

module.exports = { getCashSummary, todayBelem, SALE_METHODS, SALE_CHANNELS, getOpenSession, getSessionSummary };
