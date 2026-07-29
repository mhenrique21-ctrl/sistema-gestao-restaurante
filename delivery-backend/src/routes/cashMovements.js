const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('admin', 'atendente'));

// Normaliza os vários formatos de payment_method já gravados (código ou rótulo legado)
// pros 4 baldes usados no resumo do caixa. O que não bate cai em "outros" (ex: "misto").
const METHOD_BUCKET_SQL = `CASE
  WHEN payment_method IN ('dinheiro') THEN 'dinheiro'
  WHEN payment_method IN ('cartao_credito', 'Cartão de Crédito') THEN 'cartao_credito'
  WHEN payment_method IN ('cartao_debito', 'Cartão de Débito') THEN 'cartao_debito'
  WHEN payment_method IN ('pix', 'pix_auto') THEN 'pix'
  ELSE 'outros'
END`;
const SALE_METHODS = ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix'];

// "Hoje" no fuso de Belém (não UTC) — depois das 21h local já é o dia seguinte em UTC,
// então usar toISOString().slice(0,10) faz o caixa "sumir" no fim do expediente.
function todayBelem() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Belem' });
}

// GET /api/cash-movements?date=YYYY-MM-DD — abertura/sangrias/suprimentos + vendas (PDV+Delivery) do dia (padrão: hoje)
router.get('/', async (req, res) => {
  const date = req.query.date || todayBelem();
  try {
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

    const pdvRows = await pool.query(
      `SELECT ${METHOD_BUCKET_SQL} AS method, COUNT(*) AS qty, COALESCE(SUM(total), 0) AS total
       FROM comandas
       WHERE status = 'fechada' AND DATE(closed_at AT TIME ZONE 'America/Belem') = $1
       GROUP BY method`,
      [date]
    );
    const deliveryRows = await pool.query(
      `SELECT ${METHOD_BUCKET_SQL} AS method, COUNT(*) AS qty, COALESCE(SUM(total), 0) AS total
       FROM orders
       WHERE status != 'cancelado' AND DATE(created_at AT TIME ZONE 'America/Belem') = $1
       GROUP BY method`,
      [date]
    );

    const byMethod = {};
    let totalPdv = 0;
    let totalDelivery = 0;
    for (const m of SALE_METHODS) {
      const pdv = pdvRows.rows.find((r) => r.method === m);
      const delivery = deliveryRows.rows.find((r) => r.method === m);
      const pdvTotal = pdv ? parseFloat(pdv.total) : 0;
      const deliveryTotal = delivery ? parseFloat(delivery.total) : 0;
      byMethod[m] = {
        pdv: pdvTotal,
        delivery: deliveryTotal,
        total: pdvTotal + deliveryTotal,
        qtyPdv: pdv ? parseInt(pdv.qty, 10) : 0,
        qtyDelivery: delivery ? parseInt(delivery.qty, 10) : 0,
      };
      totalPdv += pdvTotal;
      totalDelivery += deliveryTotal;
    }
    const outrosPdv = pdvRows.rows.find((r) => r.method === 'outros');
    const outrosDelivery = deliveryRows.rows.find((r) => r.method === 'outros');
    if (outrosPdv) totalPdv += parseFloat(outrosPdv.total);
    if (outrosDelivery) totalDelivery += parseFloat(outrosDelivery.total);

    const saldo = abertura + suprimentos - sangrias + byMethod.dinheiro.pdv;

    res.json({
      date,
      movements: [...result.rows].reverse(),
      totals: { abertura, sangrias, suprimentos, saldo },
      sales: { byMethod, totalPdv, totalDelivery, totalGeral: totalPdv + totalDelivery },
    });
  } catch (err) {
    console.error('[cash-movements/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar movimentações' });
  }
});

// POST /api/cash-movements — registrar abertura (fundo de caixa), sangria ou suprimento.
// "breakdown" (opcional, só faz sentido em type=abertura) guarda a composição do valor
// inicial por forma de pagamento: { dinheiro: {qtd, valor}, cartao_debito: {...}, ... }.
router.post('/', async (req, res) => {
  const { type, amount, reason, breakdown } = req.body;
  if (!['sangria', 'suprimento', 'abertura'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  if (!(parseFloat(amount) > 0)) {
    return res.status(400).json({ error: 'Valor inválido' });
  }
  try {
    if (type === 'abertura') {
      const today = todayBelem();
      const existing = await pool.query(
        `SELECT id FROM cash_movements WHERE type = 'abertura' AND DATE(created_at AT TIME ZONE 'America/Belem') = $1`,
        [today]
      );
      if (existing.rows.length) {
        return res.status(400).json({ error: 'Já existe uma abertura de caixa registrada hoje' });
      }
    }
    // O pool.query deste projeto faz substituição de string, não parametrização real —
    // um objeto JS vira "[object Object]" se passado direto. Precisa serializar antes.
    const breakdownJson = breakdown && typeof breakdown === 'object' ? JSON.stringify(breakdown) : null;
    const result = await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by, breakdown) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [type, parseFloat(amount), reason || null, req.user?.id || null, breakdownJson]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[cash-movements/POST]', err.message);
    res.status(500).json({ error: 'Erro ao registrar movimentação' });
  }
});

// DELETE /api/cash-movements/:id — estornar um lançamento incorreto (admin)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM cash_movements WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Movimentação não encontrada' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[cash-movements/DELETE]', err.message);
    res.status(500).json({ error: 'Erro ao excluir movimentação' });
  }
});

module.exports = router;
