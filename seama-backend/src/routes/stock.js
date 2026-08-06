const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');

router.use(authMiddleware, requireRole('gerente', 'admin'));

const TZ = 'America/Belem';
const GIRO_DIAS = 30; // janela pra medir velocidade de venda

// Valor entra como literal SQL escapado, não como parâmetro: o wrapper do pool
// faz substituição de string e corrompe a partir de $10 (o "$1" casa dentro de
// "$10"). Aqui os filtros são poucos, mas o padrão evita a armadilha.
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;

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
// GET /api/stock/:id/movements — ficha do produto: cabeçalho + linha do tempo.
// Cada linha traz o saldo DEPOIS dela (balance_after), que é o que permite
// reconstruir o estoque em qualquer data e achar onde a conta começou a
// divergir — com o saldo atual sozinho, não dá.
router.get('/:id/movements', async (req, res) => {
  try {
    const prod = await pool.query(
      `SELECT id, name, stock_qty, stock_min, price, last_cost, last_cost_at
         FROM products WHERE id = $1`,
      [req.params.id]
    );
    if (!prod.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    const p = prod.rows[0];

    const r = await pool.query(
      `SELECT sm.id, sm.type, sm.quantity, sm.balance_after, sm.reason, sm.created_at,
              sm.unit_cost, sm.origin_id,
              u.username AS created_by_name,
              s.sale_number,
              pe.supplier
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.created_by
       LEFT JOIN sales s ON s.id = sm.sale_id
       LEFT JOIN purchase_entries pe ON pe.origin_id = sm.origin_id
       WHERE sm.product_id = $1
       ORDER BY sm.created_at DESC LIMIT 200`,
      [req.params.id]
    );

    const custo = p.last_cost != null ? parseFloat(p.last_cost) : null;
    const preco = parseFloat(p.price);
    res.json({
      produto: {
        id: p.id, nome: p.name,
        saldo: parseFloat(p.stock_qty),
        minimo: parseFloat(p.stock_min),
        preco,
        custo,
        custo_em: p.last_cost_at,
        // Margem sobre o preço de venda. Sem custo conhecido, null — a tela
        // mostra "—" em vez de fingir 100%.
        margem_pct: custo != null && preco > 0 ? Math.round((100 * (preco - custo) / preco) * 10) / 10 : null,
        valor_estoque: custo != null ? Math.round(custo * parseFloat(p.stock_qty) * 100) / 100 : null,
      },
      movimentos: r.rows.map((m) => ({
        id: m.id, tipo: m.type, data: m.created_at,
        quantidade: parseFloat(m.quantity),
        saldo_depois: m.balance_after != null ? parseFloat(m.balance_after) : null,
        custo_unitario: m.unit_cost != null ? parseFloat(m.unit_cost) : null,
        // Quem originou: venda tem número, compra tem fornecedor, ajuste tem
        // o operador. Sem isso a linha do tempo vira uma lista de números.
        origem: m.sale_number ? `Venda #${m.sale_number}`
              : m.supplier ? m.supplier
              : (m.reason || '').replace(/^Compra\s*–\s*/, '').replace(/\s*\(App Gestão\)$/, '') || null,
        motivo: m.reason,
        operador: m.created_by_name,
      })),
    });
  } catch (err) {
    return internalError(res, err, '[stock/movements]');
  }
});

// GET /api/stock/entradas?de=&ate=&fornecedor= — extrato do que entrou.
// Fornecedor e data vêm de purchase_entries pelo origin_id, não do texto do
// motivo: interpretar string quebraria no primeiro fornecedor com travessão
// no nome.
router.get('/entradas', async (req, res) => {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '') ? req.query.de : null;
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate || '') ? req.query.ate : null;
  const forn = (req.query.fornecedor || '').trim();

  try {
    const filtros = [`sm.type = 'entrada'`];
    if (de)  filtros.push(`DATE(sm.created_at AT TIME ZONE '${TZ}') >= ${sqlStr(de)}`);
    if (ate) filtros.push(`DATE(sm.created_at AT TIME ZONE '${TZ}') <= ${sqlStr(ate)}`);
    // Entrada anterior a esta versão não tem origin_id, então pe.supplier é
    // nulo nela. Tentei religar essas 26 pelo horário: só 8 casavam sem
    // ambiguidade, e um vínculo parcial faria o filtro esconder metade das
    // linhas sem avisar. Casar também pelo texto do motivo cobre as antigas
    // sem inventar vínculo que não dá pra provar.
    if (forn) filtros.push(`(pe.supplier = ${sqlStr(forn)} OR sm.reason LIKE ${sqlStr('%' + forn + '%')})`);

    const r = await pool.query(
      `SELECT sm.id, sm.created_at, sm.quantity, sm.unit_cost, sm.reason, sm.origin_id,
              p.name AS produto, p.price AS preco_venda,
              pe.supplier AS fornecedor
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         LEFT JOIN purchase_entries pe ON pe.origin_id = sm.origin_id
        WHERE ${filtros.join(' AND ')}
        ORDER BY sm.created_at DESC
        LIMIT 500`
    );

    const linhas = r.rows.map((m) => {
      const qtd = parseFloat(m.quantity);
      const custo = m.unit_cost != null ? parseFloat(m.unit_cost) : null;
      return {
        id: m.id, data: m.created_at, produto: m.produto,
        // Nota antiga não tem origin_id: cai no texto do motivo, que ao menos
        // diz de quem veio, mesmo sem dar pra filtrar.
        fornecedor: m.fornecedor || (m.reason || '').replace(/^Compra\s*–\s*/, '').replace(/\s*\(App Gestão\)$/, '') || null,
        quantidade: qtd,
        custo_unitario: custo,
        total: custo != null ? Math.round(custo * qtd * 100) / 100 : null,
        preco_venda: parseFloat(m.preco_venda),
        origin_id: m.origin_id,
      };
    });

    // Só soma o que tem custo. Misturar linha sem custo no total daria um
    // número menor que o real e ninguém saberia por quê.
    const comCusto = linhas.filter((l) => l.total != null);
    res.json({
      linhas,
      resumo: {
        movimentos: linhas.length,
        notas: new Set(linhas.map((l) => l.origin_id).filter(Boolean)).size,
        sem_custo: linhas.length - comCusto.length,
        total: Math.round(comCusto.reduce((s, l) => s + l.total, 0) * 100) / 100,
      },
    });
  } catch (err) {
    return internalError(res, err, '[stock/entradas]');
  }
});

// GET /api/stock/fornecedores — para o filtro do extrato.
router.get('/fornecedores', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT supplier FROM purchase_entries
        WHERE supplier IS NOT NULL AND trim(supplier) <> '' ORDER BY supplier`
    );
    res.json(r.rows.map((x) => x.supplier));
  } catch (err) {
    return internalError(res, err, '[stock/fornecedores]');
  }
});

module.exports = router;
