const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');

router.use(authMiddleware, requireRole('gerente', 'admin'));

const TZ = 'America/Belem';
const GIRO_DIAS = 30; // janela pra medir velocidade de venda

// GET /api/stock — produtos de revenda com giro e cobertura.
// O número que decide a compra não é o saldo, é a COBERTURA: quantos dias o
// estoque atual dura no ritmo real de venda. 24 unidades pode ser pouco
// (vende 20/dia) ou capital parado (vende 0,8/dia).
router.get('/', async (req, res) => {
  try {
    const produtos = await pool.query(
      `SELECT p.id, p.name, p.stock_qty, p.stock_min, p.active, c.name AS categoria
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.track_stock = true
       ORDER BY p.name`
    );
    const giro = await pool.query(
      `SELECT si.product_id, SUM(si.quantity)::int AS vendidos
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'concluida'
         AND DATE(s.created_at AT TIME ZONE '${TZ}') >= (CURRENT_DATE - INTERVAL '${GIRO_DIAS} days')
       GROUP BY si.product_id`
    );
    const vendidosPor = {};
    giro.rows.forEach((g) => { vendidosPor[g.product_id] = g.vendidos; });

    // Dividir sempre por 30 subestima o giro enquanto o sistema é novo: uma
    // loja com 3 dias de uso mostraria 1/10 da velocidade real e nunca
    // sugeriria compra. Divide pelos dias que existem de histórico.
    const primeira = await pool.query(
      `SELECT MIN(DATE(created_at AT TIME ZONE '${TZ}'))::text AS dia
       FROM sales WHERE status = 'concluida'`
    );
    let diasBase = GIRO_DIAS;
    if (primeira.rows[0]?.dia) {
      const desde = Math.floor((Date.now() - new Date(`${primeira.rows[0].dia}T12:00:00Z`)) / 86400000) + 1;
      diasBase = Math.max(1, Math.min(GIRO_DIAS, desde));
    }

    const itens = produtos.rows.map((p) => {
      const estoque = parseFloat(p.stock_qty);
      const minimo = parseFloat(p.stock_min);
      const giroDia = (vendidosPor[p.id] || 0) / diasBase;
      // Sem venda no período não há cobertura calculável — é "parado", não
      // "infinito"; a tela trata os dois casos de forma diferente.
      const cobertura = giroDia > 0 ? estoque / giroDia : null;
      return {
        id: p.id, name: p.name, categoria: p.categoria, active: p.active,
        estoque, minimo,
        giroDia: Math.round(giroDia * 100) / 100,
        cobertura: cobertura === null ? null : Math.round(cobertura * 10) / 10,
        abaixoMinimo: minimo > 0 && estoque <= minimo,
        // Sugestão cobre 7 dias de venda a partir do que falta, arredondada
        // pra cima — comprar a menos é pior que sobrar um pouco.
        sugestaoCompra: giroDia > 0 && (cobertura === null || cobertura < 7)
          ? Math.ceil(giroDia * 7 - estoque)
          : 0,
      };
    });

    res.json({ giroDias: diasBase, itens });
  } catch (err) {
    return internalError(res, err, '[stock/list]');
  }
});

// POST /api/stock/:id/movement — entrada de compra, ajuste de inventário ou perda
router.post('/:id/movement', async (req, res) => {
  const { type, reason } = req.body;
  const quantity = parseFloat(req.body.quantity);
  if (!['entrada', 'ajuste', 'perda'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!Number.isFinite(quantity)) return res.status(400).json({ error: 'Quantidade inválida' });
  if (type !== 'ajuste' && !(quantity > 0)) return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });

  try {
    const p = await pool.query(`SELECT id, name, stock_qty, track_stock FROM products WHERE id = $1`, [req.params.id]);
    const prod = p.rows[0];
    if (!prod) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!prod.track_stock) return res.status(400).json({ error: 'Este produto não controla estoque' });

    // Ajuste é contagem física: o valor informado VIRA o saldo, não soma.
    // Entrada soma, perda subtrai.
    const atual = parseFloat(prod.stock_qty);
    const delta = type === 'ajuste' ? quantity - atual : (type === 'perda' ? -quantity : quantity);
    const novo = atual + delta;

    await pool.query(`UPDATE products SET stock_qty = $1 WHERE id = $2 RETURNING id`, [novo, prod.id]);
    await pool.query(
      `INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [prod.id, type, delta, novo, reason || null, req.user.id]
    );
    logAction(req.user.id, 'estoque_' + type, {
      product_id: prod.id, produto: prod.name, de: atual, para: novo, reason: reason || null,
    });
    res.status(201).json({ id: prod.id, name: prod.name, stock_qty: novo });
  } catch (err) {
    return internalError(res, err, '[stock/movement]');
  }
});

// GET /api/stock/:id/movements — extrato de um produto
router.get('/:id/movements', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sm.id, sm.type, sm.quantity, sm.balance_after, sm.reason, sm.created_at,
              u.username AS created_by_name
       FROM stock_movements sm LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.product_id = $1
       ORDER BY sm.created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[stock/movements]');
  }
});

module.exports = router;
