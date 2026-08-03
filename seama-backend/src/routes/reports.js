const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { todayBelem } = require('../utils/date');

// Relatório é informação de gestão, não operação de balcão.
router.use(authMiddleware, requireRole('gerente', 'admin'));

const TZ = 'America/Belem';

// Datas chegam como YYYY-MM-DD e são comparadas no fuso da loja. Sem isso,
// venda das 22h entra no dia seguinte (UTC) e o relatório do dia fecha errado.
function parseRange(req) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : todayBelem();
  let from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  if (!from) {
    const d = new Date(`${to}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

// Janela imediatamente anterior, do mesmo tamanho, pra comparação.
function previousRange(from, to) {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  const dias = Math.round((b - a) / 86400000) + 1;
  const prevTo = new Date(a); prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setUTCDate(prevFrom.getUTCDate() - (dias - 1));
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10), dias };
}

async function totaisNoPeriodo(from, to) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS vendas, COALESCE(SUM(total), 0) AS faturamento
     FROM sales
     WHERE status = 'concluida'
       AND DATE(created_at AT TIME ZONE '${TZ}') BETWEEN $1 AND $2`,
    [from, to]
  );
  const itens = await pool.query(
    `SELECT COALESCE(SUM(si.quantity), 0)::int AS unidades
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'concluida'
       AND DATE(s.created_at AT TIME ZONE '${TZ}') BETWEEN $1 AND $2`,
    [from, to]
  );
  const vendas = r.rows[0]?.vendas || 0;
  const faturamento = parseFloat(r.rows[0]?.faturamento || 0);
  return {
    vendas,
    faturamento,
    unidades: itens.rows[0]?.unidades || 0,
    ticketMedio: vendas ? faturamento / vendas : 0,
  };
}

// GET /api/reports/summary — KPIs do período + variação contra o período anterior
router.get('/summary', async (req, res) => {
  const { from, to } = parseRange(req);
  try {
    const atual = await totaisNoPeriodo(from, to);
    const prev = previousRange(from, to);
    const anterior = await totaisNoPeriodo(prev.from, prev.to);
    const variacao = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
    res.json({
      from, to, dias: prev.dias,
      atual,
      anterior,
      comparacao: {
        faturamento: variacao(atual.faturamento, anterior.faturamento),
        vendas: variacao(atual.vendas, anterior.vendas),
        ticketMedio: variacao(atual.ticketMedio, anterior.ticketMedio),
        unidades: variacao(atual.unidades, anterior.unidades),
      },
    });
  } catch (err) {
    return internalError(res, err, '[reports/summary]');
  }
});

// GET /api/reports/products — ranking com curva ABC e produtos parados
router.get('/products', async (req, res) => {
  const { from, to } = parseRange(req);
  try {
    const r = await pool.query(
      `SELECT si.product_id, si.product_name,
              SUM(si.quantity)::int AS quantidade,
              COALESCE(SUM(si.unit_price * si.quantity), 0) AS faturamento
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'concluida'
         AND DATE(s.created_at AT TIME ZONE '${TZ}') BETWEEN $1 AND $2
       GROUP BY si.product_id, si.product_name
       ORDER BY faturamento DESC`,
      [from, to]
    );

    const vendidos = r.rows.map((x) => ({
      product_id: x.product_id,
      name: x.product_name,
      quantidade: x.quantidade,
      faturamento: parseFloat(x.faturamento),
    }));
    const totalFat = vendidos.reduce((s, p) => s + p.faturamento, 0);

    // Curva ABC: A são os poucos que somam 80% do faturamento (nunca podem
    // faltar), B vai até 95%, C é a cauda longa.
    let acumulado = 0;
    const ranking = vendidos.map((p) => {
      acumulado += p.faturamento;
      const share = totalFat ? (acumulado / totalFat) * 100 : 0;
      return {
        ...p,
        participacao: totalFat ? (p.faturamento / totalFat) * 100 : 0,
        abc: share <= 80 ? 'A' : share <= 95 ? 'B' : 'C',
      };
    });

    // Produtos ativos que não venderam nada no período — o que o ranking não
    // mostra, porque simplesmente não aparece nele.
    const vendidosIds = vendidos.map((p) => p.product_id);
    const paradosRes = await pool.query(
      `SELECT p.id, p.name, c.name AS categoria
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = true
       ORDER BY p.name`
    );
    const parados = paradosRes.rows.filter((p) => !vendidosIds.includes(p.id));

    res.json({ from, to, totalFaturamento: totalFat, ranking, parados });
  } catch (err) {
    return internalError(res, err, '[reports/products]');
  }
});

// GET /api/reports/patterns — faturamento por dia da semana e por hora
router.get('/patterns', async (req, res) => {
  const { from, to } = parseRange(req);
  try {
    const semana = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE '${TZ}')::int AS dia,
              COUNT(*)::int AS vendas, COALESCE(SUM(total), 0) AS faturamento
       FROM sales
       WHERE status = 'concluida'
         AND DATE(created_at AT TIME ZONE '${TZ}') BETWEEN $1 AND $2
       GROUP BY dia ORDER BY dia`,
      [from, to]
    );
    const hora = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE '${TZ}')::int AS hora,
              COUNT(*)::int AS vendas, COALESCE(SUM(total), 0) AS faturamento
       FROM sales
       WHERE status = 'concluida'
         AND DATE(created_at AT TIME ZONE '${TZ}') BETWEEN $1 AND $2
       GROUP BY hora ORDER BY hora`,
      [from, to]
    );
    const diario = await pool.query(
      `SELECT DATE(created_at AT TIME ZONE '${TZ}')::text AS dia,
              COUNT(*)::int AS vendas, COALESCE(SUM(total), 0) AS faturamento
       FROM sales
       WHERE status = 'concluida'
         AND DATE(created_at AT TIME ZONE '${TZ}') BETWEEN $1 AND $2
       GROUP BY dia ORDER BY dia`,
      [from, to]
    );

    const num = (rows, key) => rows.map((x) => ({
      ...x, faturamento: parseFloat(x.faturamento), [key]: x[key],
    }));
    res.json({
      from, to,
      porDiaSemana: num(semana.rows, 'dia'),
      porHora: num(hora.rows, 'hora'),
      porDia: num(diario.rows, 'dia'),
    });
  } catch (err) {
    return internalError(res, err, '[reports/patterns]');
  }
});

module.exports = router;
