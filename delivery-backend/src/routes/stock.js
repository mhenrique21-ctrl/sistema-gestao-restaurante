const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { moverEstoque } = require('../services/stock');

router.use(authMiddleware, requireRole('admin', 'atendente'));

// Lista de ids entra inline como literal SQL: o wrapper do pool substitui
// $1,$2... por string e, acima de $9, o "$1" casa dentro de "$10". Um
// inventário tem dezenas de itens, então parâmetro posicional está fora.
// Aceita só uuid — nada vindo do corpo da requisição chega cru ao SQL.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
const somenteUuid = (arr) => arr.filter((v) => typeof v === 'string' && UUID_RE.test(v));

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

// POST /api/stock/marcar-categoria — liga (ou desliga) o controle numa
// categoria inteira. Marcar 22 bebidas uma a uma é a tarefa que faz alguém
// desistir no décimo produto.
router.post('/marcar-categoria', requireRole('admin'), async (req, res) => {
  const { category_id } = req.body;
  const ligar = req.body.track_stock !== false;
  const min = req.body.stock_min !== undefined ? parseFloat(req.body.stock_min) : null;
  if (!category_id) return res.status(400).json({ error: 'Informe a categoria' });
  if (min !== null && (!Number.isFinite(min) || min < 0)) return res.status(400).json({ error: 'Mínimo inválido' });

  try {
    // Saldo NÃO é tocado aqui. Ligar o controle não pode zerar o que já existe,
    // e desligar não pode apagar o saldo de quem só quis parar de acompanhar.
    const setMin = min !== null && ligar ? `, stock_min = ${min}` : '';
    const r = await pool.query(
      `UPDATE products SET track_stock = ${ligar ? 'TRUE' : 'FALSE'}${setMin}
        WHERE category_id = $1 AND track_stock = ${ligar ? 'FALSE' : 'TRUE'}
        RETURNING id, name`,
      [category_id]
    );
    res.json({ ok: true, alterados: r.rows.length, produtos: r.rows.map((p) => p.name) });
  } catch (err) {
    return erro(res, err, '[stock/marcar-categoria]');
  }
});

// GET /api/stock/inventario/novo — a folha de contagem: tudo que controla
// estoque, com o saldo do sistema, pra conferir de uma vez.
router.get('/inventario/novo', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.name, p.stock_qty, p.price, c.name AS category_name
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.track_stock = true
        ORDER BY c.name, p.name`
    );
    res.json(r.rows.map((p) => ({
      ...p, stock_qty: parseFloat(p.stock_qty), price: parseFloat(p.price),
    })));
  } catch (err) {
    return erro(res, err, '[stock/inventario/novo]');
  }
});

// POST /api/stock/inventario — fecha a contagem e aplica os ajustes.
// Produto não informado é IGNORADO, não zerado: parar a contagem no meio não
// pode zerar o resto do estoque.
router.post('/inventario', async (req, res) => {
  const itens = Array.isArray(req.body.itens) ? req.body.itens : null;
  if (!itens || !itens.length) return res.status(400).json({ error: 'Informe ao menos um item contado' });

  try {
    const ids = somenteUuid([...new Set(itens.map((i) => i.product_id))]);
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item válido' });
    const prods = await pool.query(
      `SELECT id, name, stock_qty, price FROM products
        WHERE track_stock = true AND id IN (${ids.map(sqlStr).join(',')})`
    );
    const byId = {};
    prods.rows.forEach((p) => { byId[p.id] = p; });

    const head = await pool.query(
      `INSERT INTO stock_counts (created_by, notes) VALUES ($1, $2) RETURNING id`,
      [req.user?.id || null, req.body.notes || null]
    );
    const countId = head.rows[0].id;

    let divergentes = 0, valorDif = 0, contados = 0;
    const detalhes = [];
    for (const it of itens) {
      const p = byId[it.product_id];
      const contado = parseFloat(it.counted_qty);
      if (!p || !Number.isFinite(contado) || contado < 0) continue;

      const sistema = parseFloat(p.stock_qty);
      const dif = Math.round((contado - sistema) * 1000) / 1000;
      const preco = parseFloat(p.price) || 0;
      contados++;

      await pool.query(
        `INSERT INTO stock_count_items (count_id, product_id, system_qty, counted_qty, difference, unit_price)
         VALUES ($1, $2, ${sistema}, ${contado}, ${dif}, ${preco}) RETURNING id`,
        [countId, p.id]
      );

      if (dif !== 0) {
        divergentes++;
        valorDif += dif * preco;
        await moverEstoque([{ product_id: p.id, quantity: Math.abs(dif) }], {
          tipo: 'ajuste',
          motivo: `Inventário (sistema ${sistema}, contado ${contado})`,
          userId: req.user?.id,
          sinal: dif > 0 ? 1 : -1,
        });
        detalhes.push({ produto: p.name, sistema, contado, diferenca: dif, valor: Math.round(dif * preco * 100) / 100 });
      }
    }

    valorDif = Math.round(valorDif * 100) / 100;
    await pool.query(
      `UPDATE stock_counts SET status = 'fechado', closed_at = NOW(),
              itens_contados = ${contados}, itens_divergentes = ${divergentes}, valor_diferenca = ${valorDif}
        WHERE id = $1 RETURNING id`,
      [countId]
    );

    res.status(201).json({ ok: true, count_id: countId, contados, divergentes, valor_diferenca: valorDif, detalhes });
  } catch (err) {
    return erro(res, err, '[stock/inventario]');
  }
});

// GET /api/stock/inventario — histórico de contagens.
router.get('/inventario', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sc.id, sc.closed_at, sc.itens_contados, sc.itens_divergentes, sc.valor_diferenca, u.name AS created_by_name
         FROM stock_counts sc LEFT JOIN users u ON u.id = sc.created_by
        WHERE sc.status = 'fechado' ORDER BY sc.closed_at DESC LIMIT 30`
    );
    res.json(r.rows);
  } catch (err) {
    return erro(res, err, '[stock/inventario/list]');
  }
});

module.exports = router;
