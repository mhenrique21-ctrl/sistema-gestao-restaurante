const pool = require('../db/pool');

// Normaliza os vários formatos de payment_method já gravados (código ou rótulo legado)
// pros 4 baldes usados no resumo do caixa. O que não bate cai em "outros".
const METHOD_BUCKET_SQL = `CASE
  WHEN payment_method IN ('dinheiro') THEN 'dinheiro'
  WHEN payment_method IN ('cartao_credito', 'Cartão de Crédito') THEN 'cartao_credito'
  WHEN payment_method IN ('cartao_debito', 'Cartão de Débito') THEN 'cartao_debito'
  WHEN payment_method IN ('pix', 'pix_auto') THEN 'pix'
  ELSE 'outros'
END`;
// Mesma normalização, mas pra cp.method (comanda_payments) em vez de payment_method direto.
const CP_METHOD_BUCKET_SQL = `CASE
  WHEN cp.method IN ('dinheiro') THEN 'dinheiro'
  WHEN cp.method IN ('cartao_credito', 'Cartão de Crédito') THEN 'cartao_credito'
  WHEN cp.method IN ('cartao_debito', 'Cartão de Débito') THEN 'cartao_debito'
  WHEN cp.method IN ('pix', 'pix_auto') THEN 'pix'
  ELSE 'outros'
END`;
const SALE_METHODS = ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix'];
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

module.exports = { getCashSummary, todayBelem, SALE_METHODS, SALE_CHANNELS };
