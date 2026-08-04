const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { moverEstoque } = require('../services/stock');

router.use(authMiddleware, requireRole('admin', 'atendente'));

function erro(res, err, tag) {
  console.error(tag, err.message);
  return res.status(500).json({ error: 'Erro interno do servidor' });
}

// GET /api/stock — posição atual dos produtos de revenda.
// Só quem tem track_stock aparece: listar o cardápio inteiro com saldo zero
// treinaria o operador a ignorar a tela.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.name, p.stock_qty, p.stock_min, c.name AS category_name
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.track_stock = true
        ORDER BY (p.stock_qty <= p.stock_min) DESC, p.stock_qty ASC, p.name`
    );
    const itens = r.rows.map((p) => ({
      ...p,
      stock_qty: parseFloat(p.stock_qty),
      stock_min: parseFloat(p.stock_min),
      abaixo_do_minimo: parseFloat(p.stock_qty) <= parseFloat(p.stock_min),
    }));
    res.json({ itens, abaixo: itens.filter((i) => i.abaixo_do_minimo).length });
  } catch (err) {
    return erro(res, err, '[stock/list]');
  }
});

// GET /api/stock/:id/movimentos — extrato de um produto.
router.get('/:id/movimentos', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sm.type, sm.quantity, sm.balance_after, sm.reason, sm.created_at, u.name AS created_by_name
         FROM stock_movements sm LEFT JOIN users u ON u.id = sm.created_by
        WHERE sm.product_id = $1 ORDER BY sm.created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) {
    return erro(res, err, '[stock/movimentos]');
  }
});

// POST /api/stock/:id/ajuste — contagem física ou perda.
// Ajuste informa o saldo CONTADO, não a diferença: o operador conta 12 e
// digita 12. Calcular a diferença de cabeça é onde o erro entra.
router.post('/:id/ajuste', async (req, res) => {
  const { tipo, motivo } = req.body;
  const valor = parseFloat(req.body.valor);
  if (!['contagem', 'perda'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!Number.isFinite(valor)) return res.status(400).json({ error: 'Valor inválido' });
  if (tipo === 'perda' && !(valor > 0)) return res.status(400).json({ error: 'Informe a quantidade perdida' });
  if (tipo === 'contagem' && valor < 0) return res.status(400).json({ error: 'Saldo contado não pode ser negativo' });

  try {
    const p = await pool.query(`SELECT id, name, stock_qty, track_stock FROM products WHERE id = $1`, [req.params.id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!p.rows[0].track_stock) return res.status(400).json({ error: `"${p.rows[0].name}" não controla estoque` });

    const atual = parseFloat(p.rows[0].stock_qty);
    const delta = tipo === 'contagem' ? valor - atual : -valor;
    if (delta === 0) return res.json({ ok: true, saldo: atual, ajuste: 0 });

    const feitos = await moverEstoque(
      [{ product_id: req.params.id, quantity: Math.abs(delta) }],
      {
        tipo: tipo === 'contagem' ? 'ajuste' : 'perda',
        motivo: motivo || (tipo === 'contagem' ? `Contagem física (era ${atual})` : 'Perda'),
        userId: req.user?.id,
        sinal: delta > 0 ? 1 : -1,
      }
    );
    res.json({ ok: true, saldo: feitos[0]?.saldo ?? atual, ajuste: delta });
  } catch (err) {
    return erro(res, err, '[stock/ajuste]');
  }
});

module.exports = router;
