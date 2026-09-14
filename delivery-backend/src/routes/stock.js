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
// GET /api/stock/:id/movimentos — ficha do produto: cabeçalho + linha do tempo.
// Cada linha traz o saldo DEPOIS dela (balance_after), que é o que permite
// reconstruir o estoque em qualquer data e achar onde a conta começou a
// divergir. Com o saldo atual sozinho, você sabe que faltam 3 unidades mas
// não desde quando.
router.get('/:id/movimentos', async (req, res) => {
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
              sm.unit_cost, sm.origin_id, sm.order_id, sm.comanda_id,
              u.name AS created_by_name, pe.supplier,
              o.order_number, c.code AS comanda_code
         FROM stock_movements sm
         LEFT JOIN users u ON u.id = sm.created_by
         LEFT JOIN purchase_entries pe ON pe.origin_id = sm.origin_id
         LEFT JOIN orders o ON o.id = sm.order_id
         LEFT JOIN comandas c ON c.id = sm.comanda_id
        WHERE sm.product_id = $1 ORDER BY sm.created_at DESC LIMIT 200`,
      [req.params.id]
    );

    const custo = p.last_cost != null ? parseFloat(p.last_cost) : null;
    const preco = parseFloat(p.price);
    res.json({
      produto: {
        id: p.id, nome: p.name,
        saldo: parseFloat(p.stock_qty), minimo: parseFloat(p.stock_min),
        preco, custo, custo_em: p.last_cost_at,
        // Sem custo conhecido, null. A tela mostra "—" em vez de fingir 100%.
        margem_pct: custo != null && preco > 0 ? Math.round((100 * (preco - custo) / preco) * 10) / 10 : null,
        valor_estoque: custo != null ? Math.round(custo * parseFloat(p.stock_qty) * 100) / 100 : null,
      },
      movimentos: r.rows.map((m) => ({
        id: m.id, tipo: m.type, data: m.created_at,
        quantidade: parseFloat(m.quantity),
        saldo_depois: m.balance_after != null ? parseFloat(m.balance_after) : null,
        custo_unitario: m.unit_cost != null ? parseFloat(m.unit_cost) : null,
        // De onde veio: pedido tem número, comanda tem código, compra tem
        // fornecedor. Sem isso a linha do tempo vira uma lista de números.
        origem: m.order_number ? `Pedido #${m.order_number}`
              : m.comanda_code ? (String(m.comanda_code).startsWith('balcao_') ? 'Balcão' : `Comanda ${m.comanda_code}`)
              : m.supplier ? m.supplier
              : (m.reason || '').replace(/^Compra\s*–\s*/, '').replace(/\s*\(App Gestão\)$/, '') || null,
        motivo: m.reason,
        operador: m.created_by_name,
      })),
    });
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

// GET /api/stock/:id/vendas?de=&ate= — como este produto foi vendido: por
// forma de pagamento e por canal (balcão/mesa/delivery/retirada). Só conta
// venda CONCLUÍDA (pedido pago, comanda fechada) — uma comanda ainda aberta
// pode ter item cancelado depois, e contaria venda que nunca aconteceu.
router.get('/:id/vendas', async (req, res) => {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '') ? req.query.de : null;
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate || '') ? req.query.ate : null;
  const filtroData = (campo) => [
    de ? `DATE(${campo} AT TIME ZONE 'America/Belem') >= ${sqlStr(de)}` : null,
    ate ? `DATE(${campo} AT TIME ZONE 'America/Belem') <= ${sqlStr(ate)}` : null,
  ].filter(Boolean).map((c) => ` AND ${c}`).join('');

  try {
    const pedidos = await pool.query(
      `SELECT oi.quantity, o.payment_method, o.delivery_type AS canal
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = $1 AND o.payment_status = 'pago'${filtroData('o.created_at')}`,
      [req.params.id]
    );
    // comandas não distinguem mesa/balcão em coluna própria — o rótulo livre
    // (ex: "Mesa 5") é a única pista disponível; sem "mesa" no texto, cai em
    // balcão (é o caso mais comum de comanda avulsa).
    const comandas = await pool.query(
      `SELECT ci.quantity, c.payment_method,
              CASE WHEN c.label ILIKE 'mesa%' THEN 'mesa' ELSE 'balcao' END AS canal
         FROM comanda_items ci JOIN comandas c ON c.id = ci.comanda_id
        WHERE ci.product_id = $1 AND c.status = 'fechada'${filtroData('c.closed_at')}`,
      [req.params.id]
    );

    const porPagamento = {}, porCanal = {};
    let totalUnidades = 0;
    [...pedidos.rows, ...comandas.rows].forEach((r) => {
      const q = parseInt(r.quantity, 10) || 0;
      totalUnidades += q;
      const pag = r.payment_method || 'nao_informado';
      porPagamento[pag] = (porPagamento[pag] || 0) + q;
      porCanal[r.canal] = (porCanal[r.canal] || 0) + q;
    });

    res.json({
      total_unidades: totalUnidades,
      por_forma_pagamento: porPagamento,
      por_canal: porCanal,
    });
  } catch (err) {
    return erro(res, err, '[stock/vendas]');
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

// GET /api/stock/entradas?de=&ate=&fornecedor= — extrato do que entrou.
// Fornecedor sai de purchase_entries pelo origin_id, não do texto do motivo:
// interpretar string quebraria no primeiro fornecedor com travessão no nome.
router.get('/entradas', async (req, res) => {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '') ? req.query.de : null;
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate || '') ? req.query.ate : null;
  const forn = (req.query.fornecedor || '').trim();

  try {
    const filtros = [`sm.type = 'entrada'`];
    if (de)  filtros.push(`DATE(sm.created_at AT TIME ZONE 'America/Belem') >= ${sqlStr(de)}`);
    if (ate) filtros.push(`DATE(sm.created_at AT TIME ZONE 'America/Belem') <= ${sqlStr(ate)}`);
    // Casa também pelo texto do motivo: entrada lançada à mão pela tela de
    // ajuste não tem nota, e ficaria de fora de um filtro só por origin_id.
    if (forn) filtros.push(`(pe.supplier = ${sqlStr(forn)} OR sm.reason LIKE ${sqlStr('%' + forn + '%')})`);

    const r = await pool.query(
      `SELECT sm.id, sm.created_at, sm.quantity, sm.unit_cost, sm.reason, sm.origin_id,
              p.name AS produto, p.price AS preco_venda, pe.supplier AS fornecedor
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         LEFT JOIN purchase_entries pe ON pe.origin_id = sm.origin_id
        WHERE ${filtros.join(' AND ')}
        ORDER BY sm.created_at DESC LIMIT 500`
    );

    const linhas = r.rows.map((m) => {
      const qtd = parseFloat(m.quantity);
      const custo = m.unit_cost != null ? parseFloat(m.unit_cost) : null;
      return {
        id: m.id, data: m.created_at, produto: m.produto,
        fornecedor: m.fornecedor || (m.reason || '').replace(/^Compra\s*–\s*/, '').replace(/\s*\(App Gestão\)$/, '') || null,
        quantidade: qtd,
        custo_unitario: custo,
        total: custo != null ? Math.round(custo * qtd * 100) / 100 : null,
        origin_id: m.origin_id,
      };
    });

    // Só soma o que tem custo. Contar entrada sem custo como zero daria um
    // total menor que o real, e ninguém saberia por quê.
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
    return erro(res, err, '[stock/entradas]');
  }
});

// GET /api/stock/margens — margem por produto e variação do custo de compra.
// Ordenado pela PIOR margem: o que precisa de decisão aparece primeiro. Uma
// lista alfabética esconderia justamente o item vendido perto do custo.
router.get('/margens', async (req, res) => {
  try {
    const prods = await pool.query(
      `SELECT id, name, price, last_cost, last_cost_at, stock_qty
         FROM products WHERE track_stock = true AND available = true`
    );
    const hist = await pool.query(
      `SELECT product_id, unit_cost, created_at,
              ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at DESC) AS pos
         FROM stock_movements WHERE type = 'entrada' AND unit_cost IS NOT NULL`
    );
    const porProduto = {};
    hist.rows.forEach((h) => {
      const pos = parseInt(h.pos, 10);
      if (pos > 2) return;
      (porProduto[h.product_id] = porProduto[h.product_id] || [])[pos - 1] = { custo: parseFloat(h.unit_cost) };
    });

    const itens = prods.rows.map((p) => {
      const preco = parseFloat(p.price);
      const custo = p.last_cost != null ? parseFloat(p.last_cost) : null;
      const h = porProduto[p.id] || [];
      const anterior = h[1] ? h[1].custo : null;
      return {
        id: p.id, nome: p.name, preco, custo, custo_em: p.last_cost_at,
        custo_anterior: anterior,
        variacao_pct: anterior != null && h[0] && anterior > 0
          ? Math.round(((h[0].custo - anterior) / anterior) * 1000) / 10 : null,
        margem_pct: custo != null && preco > 0 ? Math.round((100 * (preco - custo) / preco) * 10) / 10 : null,
        lucro_unitario: custo != null ? Math.round((preco - custo) * 100) / 100 : null,
        valor_estoque: custo != null ? Math.round(custo * parseFloat(p.stock_qty) * 100) / 100 : null,
      };
    });

    // Sem custo vai pro FIM: não é margem ruim, é margem desconhecida, e
    // misturar as duas faria o topo da lista mentir.
    itens.sort((a, b) => {
      if (a.margem_pct == null && b.margem_pct == null) return a.nome.localeCompare(b.nome, 'pt-BR');
      if (a.margem_pct == null) return 1;
      if (b.margem_pct == null) return -1;
      return a.margem_pct - b.margem_pct;
    });

    const comCusto = itens.filter((i) => i.custo != null);
    res.json({
      itens,
      resumo: {
        total: itens.length,
        sem_custo: itens.length - comCusto.length,
        valor_estoque: Math.round(comCusto.reduce((s, i) => s + (i.valor_estoque || 0), 0) * 100) / 100,
        subiram: comCusto.filter((i) => i.variacao_pct != null && i.variacao_pct > 5).length,
      },
    });
  } catch (err) {
    return erro(res, err, '[stock/margens]');
  }
});

router.get('/fornecedores', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT supplier FROM purchase_entries
        WHERE supplier IS NOT NULL AND trim(supplier) <> '' ORDER BY supplier`
    );
    res.json(r.rows.map((x) => x.supplier));
  } catch (err) {
    return erro(res, err, '[stock/fornecedores]');
  }
});

module.exports = router;
