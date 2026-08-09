const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware, requireRole('admin'));

const MODOS = ['unidades', 'peso'];
// Teto de segurança: nenhuma árvore de receita real passa disso. Existe só pra
// nunca deixar um ciclo que escapou da validação travar o servidor num laço
// infinito — vira erro visível em vez de processo pendurado.
const PROFUNDIDADE_MAX = 25;

// Monta o mapa completo ficha -> itens de uma vez, pra não fazer uma consulta
// por nível de recursão. Com ~150 produtos isso é uma leitura só.
async function carregarGrafo() {
  const fichas = await pool.query(
    `SELECT id, nome, produto_id, rendimento_modo, rendimento_qtd, rendimento_unidade, ativo FROM fichas_tecnicas`
  );
  const itens = await pool.query(
    `SELECT ft.id, ft.ficha_tecnica_id, ft.insumo_id, ft.sub_ficha_id, ft.quantidade,
            i.nome AS insumo_nome, i.unidade_base AS insumo_unidade, i.custo_medio AS insumo_custo
       FROM ficha_tecnica_itens ft
       LEFT JOIN insumos i ON i.id = ft.insumo_id`
  );
  const porFicha = {};
  for (const it of itens.rows) {
    (porFicha[it.ficha_tecnica_id] = porFicha[it.ficha_tecnica_id] || []).push(it);
  }
  const fichaPorId = {};
  for (const f of fichas.rows) fichaPorId[f.id] = f;
  return { fichaPorId, porFicha };
}

// Custo por unidade de rendimento (por fatia, por grama, pelo que a ficha
// define). Recursivo: uma sub-receita usada como ingrediente contribui com o
// custo dela multiplicado pela quantidade consumida.
function custoPorUnidade(fichaId, grafo, memo = {}, caminho = new Set()) {
  if (memo[fichaId]) return memo[fichaId];
  if (caminho.has(fichaId)) return { erro: 'ciclo detectado', custo_total: 0, custo_por_unidade: 0 };
  if (caminho.size > PROFUNDIDADE_MAX) return { erro: 'árvore profunda demais', custo_total: 0, custo_por_unidade: 0 };

  const ficha = grafo.fichaPorId[fichaId];
  if (!ficha) return { erro: 'ficha não encontrada', custo_total: 0, custo_por_unidade: 0 };

  const proximoCaminho = new Set(caminho);
  proximoCaminho.add(fichaId);

  let total = 0;
  let incompleta = false;
  for (const item of grafo.porFicha[fichaId] || []) {
    const qtd = parseFloat(item.quantidade);
    if (item.insumo_id) {
      const custo = parseFloat(item.insumo_custo);
      total += (Number.isFinite(custo) ? custo : 0) * qtd;
    } else if (item.sub_ficha_id) {
      const sub = custoPorUnidade(item.sub_ficha_id, grafo, memo, proximoCaminho);
      // sub.erro só existe no nível onde o ciclo foi detectado; nos níveis
      // acima disso a marca vira "incompleta". Checar só .erro fazia o aviso
      // desaparecer a partir do segundo nível de profundidade.
      if (sub.erro || sub.incompleta) incompleta = true;
      total += sub.custo_por_unidade * qtd;
    }
  }

  const rendimento = parseFloat(ficha.rendimento_qtd) || 1;
  const resultado = {
    custo_total: total,
    custo_por_unidade: total / rendimento,
    ...(incompleta ? { incompleta: true } : {}),
  };
  memo[fichaId] = resultado;
  return resultado;
}

// Um insumo/sub-receita alcança outro se existe algum caminho de consumo entre
// eles. Usado tanto pra barrar ciclo quanto pra listar dependentes antes de
// excluir.
function alcanca(origemId, alvoId, grafo, visitado = new Set()) {
  if (origemId === alvoId) return true;
  if (visitado.has(origemId)) return false;
  visitado.add(origemId);
  for (const item of grafo.porFicha[origemId] || []) {
    if (item.sub_ficha_id && alcanca(item.sub_ficha_id, alvoId, grafo, visitado)) return true;
  }
  return false;
}

// GET /api/fichas-tecnicas/produtos — todos os produtos vendáveis com o status
// da ficha (sem ficha / com ficha + margem). É a lista que a tela abre.
router.get('/produtos', async (req, res) => {
  try {
    const prods = await pool.query(
      `SELECT p.id, p.name, p.price, p.image_url, c.name AS categoria
         FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.available = true AND c.name NOT IN ('Ofertas', 'Adicionais')
        ORDER BY c.name, p.name`
    );
    const grafo = await carregarGrafo();
    const memo = {};
    const fichaPorProduto = {};
    Object.values(grafo.fichaPorId).forEach((f) => { if (f.produto_id && f.ativo) fichaPorProduto[f.produto_id] = f; });

    const resultado = prods.rows.map((p) => {
      const ficha = fichaPorProduto[p.id];
      if (!ficha) return { ...p, tem_ficha: false };
      const c = custoPorUnidade(ficha.id, grafo, memo);
      const preco = parseFloat(p.price);
      const margem = preco > 0 ? ((preco - c.custo_por_unidade) / preco) * 100 : null;
      return {
        ...p, tem_ficha: true, ficha_id: ficha.id,
        custo_por_unidade: c.custo_por_unidade, margem_pct: margem, incompleta: !!c.incompleta,
      };
    });
    res.json(resultado);
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/produtos]');
  }
});

// GET /api/fichas-tecnicas/sub-receitas — fichas sem produto vinculado, pra
// popular o seletor "usar como ingrediente".
router.get('/sub-receitas', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ft.id, ft.nome, ft.rendimento_modo, ft.rendimento_qtd, ft.rendimento_unidade
         FROM fichas_tecnicas ft WHERE ft.produto_id IS NULL AND ft.ativo = true ORDER BY ft.nome`
    );
    const grafo = await carregarGrafo();
    const memo = {};
    res.json(r.rows.map((f) => ({ ...f, ...custoPorUnidade(f.id, grafo, memo) })));
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/sub-receitas]');
  }
});

// GET /api/fichas-tecnicas/:id — detalhe com itens resolvidos e custo.
router.get('/:id', async (req, res) => {
  try {
    const grafo = await carregarGrafo();
    const ficha = grafo.fichaPorId[req.params.id];
    if (!ficha) return res.status(404).json({ error: 'Ficha técnica não encontrada' });

    const itensBrutos = grafo.porFicha[req.params.id] || [];
    const memo = {};
    const itens = itensBrutos.map((it) => {
      if (it.insumo_id) {
        return {
          id: it.id, tipo: 'insumo', insumo_id: it.insumo_id, nome: it.insumo_nome,
          unidade: it.insumo_unidade, quantidade: it.quantidade,
          custo: (parseFloat(it.insumo_custo) || 0) * parseFloat(it.quantidade),
        };
      }
      const sub = grafo.fichaPorId[it.sub_ficha_id];
      const c = custoPorUnidade(it.sub_ficha_id, grafo, memo);
      return {
        id: it.id, tipo: 'sub_ficha', sub_ficha_id: it.sub_ficha_id, nome: sub?.nome || '(removida)',
        unidade: sub?.rendimento_unidade, quantidade: it.quantidade,
        custo: c.custo_por_unidade * parseFloat(it.quantidade),
      };
    });
    const custo = custoPorUnidade(req.params.id, grafo, {});
    res.json({ ...ficha, itens, ...custo });
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/GET id]');
  }
});

router.post('/', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const modo = String(req.body.rendimento_modo || '');
  const qtd = parseFloat(req.body.rendimento_qtd);
  const unidade = String(req.body.rendimento_unidade || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome da ficha' });
  if (!MODOS.includes(modo)) return res.status(400).json({ error: 'Modo de rendimento inválido' });
  if (!Number.isFinite(qtd) || qtd <= 0) return res.status(400).json({ error: 'Rendimento deve ser maior que zero' });
  if (modo === 'peso' && !['g', 'ml'].includes(unidade)) {
    return res.status(400).json({ error: 'Rendimento em peso precisa ser g ou ml' });
  }
  if (modo === 'unidades' && !unidade) return res.status(400).json({ error: 'Informe o rótulo do rendimento (ex: fatias)' });

  try {
    if (req.body.produto_id) {
      const existe = await pool.query(
        `SELECT id FROM fichas_tecnicas WHERE produto_id = $1 AND ativo = true`, [req.body.produto_id]
      );
      if (existe.rows[0]) return res.status(409).json({ error: 'Este produto já tem uma ficha técnica ativa' });
    }
    const r = await pool.query(
      `INSERT INTO fichas_tecnicas (produto_id, nome, rendimento_modo, rendimento_qtd, rendimento_unidade)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.body.produto_id || null, nome, modo, qtd, unidade]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Este produto já tem uma ficha técnica ativa' });
    return internalError(res, err, '[fichas-tecnicas/POST]');
  }
});

router.patch('/:id', async (req, res) => {
  const updates = [], values = [];
  let idx = 1;
  if (req.body.nome !== undefined) {
    const nome = String(req.body.nome).trim();
    if (!nome) return res.status(400).json({ error: 'Nome não pode ficar vazio' });
    updates.push(`nome = $${idx++}`); values.push(nome);
  }
  if (req.body.rendimento_qtd !== undefined) {
    const qtd = parseFloat(req.body.rendimento_qtd);
    if (!Number.isFinite(qtd) || qtd <= 0) return res.status(400).json({ error: 'Rendimento inválido' });
    updates.push(`rendimento_qtd = $${idx++}`); values.push(qtd);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para alterar' });
  values.push(req.params.id);
  try {
    const r = await pool.query(`UPDATE fichas_tecnicas SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Ficha técnica não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/PATCH]');
  }
});

// DELETE /api/fichas-tecnicas/:id — só se nada mais a estiver usando como
// sub-receita. Mesma lógica de "tem histórico" que protege insumo e usuário.
router.delete('/:id', async (req, res) => {
  try {
    const grafo = await carregarGrafo();
    if (!grafo.fichaPorId[req.params.id]) return res.status(404).json({ error: 'Ficha técnica não encontrada' });

    const dependentes = [];
    for (const [fichaId, itens] of Object.entries(grafo.porFicha)) {
      if (fichaId === req.params.id) continue;
      if (itens.some((it) => it.sub_ficha_id === req.params.id)) {
        dependentes.push(grafo.fichaPorId[fichaId]?.nome || fichaId);
      }
    }
    if (dependentes.length) {
      return res.status(409).json({
        error: `Esta receita está sendo usada por: ${dependentes.join(', ')}. Remova o vínculo nelas antes de excluir.`,
        dependentes,
      });
    }
    await pool.query(`DELETE FROM fichas_tecnicas WHERE id = $1 RETURNING id`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/DELETE]');
  }
});

// POST /api/fichas-tecnicas/:id/itens — adiciona um insumo ou uma sub-receita
// como ingrediente. Exatamente um dos dois deve vir no corpo.
router.post('/:id/itens', async (req, res) => {
  const { insumo_id, sub_ficha_id } = req.body;
  const qtd = parseFloat(req.body.quantidade);
  if (!!insumo_id === !!sub_ficha_id) {
    return res.status(400).json({ error: 'Informe insumo_id OU sub_ficha_id, nunca os dois nem nenhum' });
  }
  if (!Number.isFinite(qtd) || qtd <= 0) return res.status(400).json({ error: 'Quantidade deve ser maior que zero' });

  try {
    const grafo = await carregarGrafo();
    if (!grafo.fichaPorId[req.params.id]) return res.status(404).json({ error: 'Ficha técnica não encontrada' });

    if (sub_ficha_id) {
      if (sub_ficha_id === req.params.id) {
        return res.status(400).json({ error: 'Uma receita não pode usar a si mesma como ingrediente' });
      }
      if (!grafo.fichaPorId[sub_ficha_id]) return res.status(404).json({ error: 'Sub-receita não encontrada' });
      // Se a candidata a ingrediente já alcança esta ficha (direta ou
      // indiretamente), usá-la aqui fecharia um ciclo — o custo nunca pararia
      // de se calcular.
      if (alcanca(sub_ficha_id, req.params.id, grafo)) {
        return res.status(409).json({
          error: `Não dá pra usar "${grafo.fichaPorId[sub_ficha_id].nome}" aqui: ela depende (direta ou indiretamente) desta receita, e isso criaria um ciclo.`,
        });
      }
    } else {
      const ins = await pool.query(`SELECT id FROM insumos WHERE id = $1`, [insumo_id]);
      if (!ins.rows[0]) return res.status(404).json({ error: 'Insumo não encontrado' });
    }

    const r = await pool.query(
      `INSERT INTO ficha_tecnica_itens (ficha_tecnica_id, insumo_id, sub_ficha_id, quantidade)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, insumo_id || null, sub_ficha_id || null, qtd]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/itens POST]');
  }
});

router.delete('/itens/:itemId', async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM ficha_tecnica_itens WHERE id = $1 RETURNING id`, [req.params.itemId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Item não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[fichas-tecnicas/itens DELETE]');
  }
});

module.exports = router;
module.exports._interno = { custoPorUnidade, alcanca, carregarGrafo };
