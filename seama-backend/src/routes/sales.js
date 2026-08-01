const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');
const { todayBelem } = require('../utils/date');

router.use(authMiddleware);

const PAYMENT_METHODS = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_alimentacao', 'vale_refeicao'];

// O wrapper de pool.js substitui $1,$2... por string sem parametrização real
// (ver db/pool.js) — acima de 9 parâmetros o "$1" casa dentro de "$10" e
// corrompe o valor. Itens e pagamentos têm tamanho variável, então em vez de
// $N por campo, viram um array literal SQL inline, escapado aqui.
function sqlArray(values, type) {
  if (!values.length) return `ARRAY[]::${type}[]`;
  const escaped = values.map((v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return v;
    return `'${String(v).replace(/'/g, "''")}'`;
  });
  return `ARRAY[${escaped.join(',')}]::${type}[]`;
}

// POST /api/sales — grava a venda inteira (itens + pagamentos) numa única
// operação atômica. Nunca existe "venda em aberto" no banco: ou a venda
// inteira é gravada com sucesso, ou nada é gravado.
router.post('/', async (req, res) => {
  const { items, payments, discount = 0 } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Informe ao menos um item' });
  }
  if (!Array.isArray(payments) || !payments.length) {
    return res.status(400).json({ error: 'Informe ao menos uma forma de pagamento' });
  }
  for (const p of payments) {
    if (!PAYMENT_METHODS.includes(p.method)) return res.status(400).json({ error: 'Forma de pagamento inválida' });
    if (!(parseFloat(p.amount) > 0)) return res.status(400).json({ error: 'Valor de pagamento inválido' });
  }
  const discountCents = Math.round(parseFloat(discount || 0) * 100);
  if (discountCents > 0 && !['gerente', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Só gerente ou admin pode aplicar desconto' });
  }

  try {
    // Preço nunca vem do cliente — busca o preço/nome atual de cada produto
    // no banco e monta o pedido a partir daí.
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const prodRows = await pool.query(
      `SELECT id, name, price FROM products WHERE id = ANY(${sqlArray(productIds, 'uuid')}) AND active = true`
    );
    const byId = {};
    prodRows.rows.forEach((p) => { byId[p.id] = p; });

    const resolvedItems = [];
    let subtotalCents = 0;
    for (const item of items) {
      const prod = byId[item.product_id];
      const qty = parseInt(item.quantity, 10);
      if (!prod) return res.status(400).json({ error: 'Produto não encontrado ou indisponível' });
      if (!(qty > 0)) return res.status(400).json({ error: `Quantidade inválida para "${prod.name}"` });
      const unitCents = Math.round(parseFloat(prod.price) * 100);
      subtotalCents += unitCents * qty;
      resolvedItems.push({ product_id: prod.id, product_name: prod.name, unit_price: unitCents / 100, quantity: qty });
    }

    const totalCents = Math.max(0, subtotalCents - discountCents);
    const paidCents = payments.reduce((s, p) => s + Math.round(parseFloat(p.amount) * 100), 0);
    if (paidCents !== totalCents) {
      return res.status(400).json({
        error: `Soma dos pagamentos (${(paidCents / 100).toFixed(2)}) não bate com o total (${(totalCents / 100).toFixed(2)})`,
      });
    }

    // O wrapper genérico de pool.js (run_sql) não aceita uma consulta que já é
    // uma cadeia de CTEs com INSERT — o Postgres exige que CTE que modifica
    // dado esteja no nível mais externo, e run_sql sempre envolve a query
    // numa CTE própria. Por isso a gravação atômica da venda inteira (venda +
    // itens + pagamentos) vive numa função no banco (create_sale), chamada
    // via RPC direto — não passa pelo pool.query.
    const { data, error } = await pool.supabase.rpc('create_sale', {
      p_user_id: req.user.id,
      p_items: resolvedItems,
      p_payments: payments.map((p) => ({ method: p.method, amount: parseFloat(p.amount) })),
      p_subtotal: subtotalCents / 100,
      p_discount: discountCents / 100,
      p_total: totalCents / 100,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });

    const sale = data;
    if (discountCents > 0) {
      logAction(req.user.id, 'desconto_aplicado', { sale_id: sale.id, discount: discountCents / 100 });
    }
    logAction(req.user.id, 'venda_criada', { sale_id: sale.id, total: totalCents / 100 });

    res.status(201).json({
      ...sale,
      subtotal: subtotalCents / 100,
      discount: discountCents / 100,
      total: totalCents / 100,
      items: resolvedItems,
      payments,
    });
  } catch (err) {
    return internalError(res, err, '[sales/POST]');
  }
});

// GET /api/sales?date=YYYY-MM-DD — consulta de vendas do dia (padrão: hoje)
router.get('/', async (req, res) => {
  const date = req.query.date || todayBelem();
  try {
    const result = await pool.query(
      `SELECT s.id, s.sale_number, s.subtotal, s.discount, s.total, s.status, s.created_at,
              u.username AS operator_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE DATE(s.created_at AT TIME ZONE 'America/Belem') = $1
       ORDER BY s.created_at DESC`,
      [date]
    );
    res.json({ date, sales: result.rows });
  } catch (err) {
    return internalError(res, err, '[sales/GET]');
  }
});

// GET /api/sales/:id — detalhe completo (itens + pagamentos), pra reimpressão
router.get('/:id', async (req, res) => {
  try {
    const saleRes = await pool.query(
      `SELECT s.*, u.username AS operator_name FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!saleRes.rows[0]) return res.status(404).json({ error: 'Venda não encontrada' });
    const items = await pool.query(`SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY created_at`, [req.params.id]);
    const payments = await pool.query(`SELECT * FROM sale_payments WHERE sale_id = $1`, [req.params.id]);
    res.json({ ...saleRes.rows[0], items: items.rows, payments: payments.rows });
  } catch (err) {
    return internalError(res, err, '[sales/GET id]');
  }
});

// POST /api/sales/:id/cancel — cancela uma venda já concluída (gerente/admin,
// com motivo obrigatório — registrado no audit_log pra rastreio).
router.post('/:id/cancel', requireRole('gerente', 'admin'), async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Informe o motivo do cancelamento' });
  try {
    const result = await pool.query(
      `UPDATE sales SET status = 'cancelada' WHERE id = $1 AND status = 'concluida' RETURNING id, sale_number, total`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Venda não encontrada ou já cancelada' });
    await logAction(req.user.id, 'venda_cancelada', { sale_id: req.params.id, reason: reason.trim() });
    res.json({ ...result.rows[0], status: 'cancelada' });
  } catch (err) {
    return internalError(res, err, '[sales/cancel]');
  }
});

module.exports = router;
