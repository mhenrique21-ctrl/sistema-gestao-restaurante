const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware, requireRole('admin'));

const UNIDADES = ['g', 'ml', 'un'];

// Custo médio ponderado. Usar o último preço de compra faria o custo do prato
// pular a cada nota e o relatório de margem virar ruído — comprou 5 caixas a
// R$ 6 e 12 a R$ 5,50, o mililitro custa (30+66)/17000, não R$ 5,50.
//
// Saldo zerado ou negativo recomeça do preço da entrada: manter a média antiga
// sobre um saldo que não existe é média de nada.
function novaMedia(saldoAtual, mediaAtual, qtdEntrada, custoEntrada) {
  const s = parseFloat(saldoAtual) || 0;
  const m = parseFloat(mediaAtual) || 0;
  const q = parseFloat(qtdEntrada) || 0;
  const c = parseFloat(custoEntrada);
  if (!Number.isFinite(c)) return m;      // entrada sem custo não mexe na média
  if (s <= 0 || q <= 0) return c;
  return (s * m + q * c) / (s + q);
}

// GET /api/insumos — lista com as embalagens já ligadas
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*,
              COALESCE(e.n, 0) AS embalagens,
              (i.saldo * i.custo_medio) AS valor_estoque
         FROM insumos i
         LEFT JOIN (SELECT insumo_id, COUNT(*) AS n FROM insumo_embalagens GROUP BY insumo_id) e
                ON e.insumo_id = i.id
        WHERE i.ativo = true
        ORDER BY i.categoria NULLS LAST, i.nome`
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[insumos/GET]');
  }
});

// GET /api/insumos/pendentes — nomes que já vieram em nota e ainda não estão
// ligados a insumo nenhum. É a fila de trabalho da conciliação.
router.get('/pendentes', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.source_name, p.unit,
              SUM(p.quantity) AS quantidade,
              COUNT(*)::int AS vezes,
              MAX(p.created_at) AS ultima,
              string_agg(DISTINCT p.supplier, ' · ') AS fornecedores
         FROM pending_supply_items p
         LEFT JOIN insumo_embalagens e ON lower(e.nome_nota) = lower(p.source_name)
        WHERE e.id IS NULL
        GROUP BY p.source_name, p.unit
        ORDER BY COUNT(*) DESC, p.source_name`
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[insumos/pendentes]');
  }
});

// GET /api/insumos/:id — detalhe com embalagens e últimos movimentos
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM insumos WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Insumo não encontrado' });
    const emb = await pool.query(
      `SELECT * FROM insumo_embalagens WHERE insumo_id = $1 ORDER BY nome_nota`, [req.params.id]
    );
    const mov = await pool.query(
      `SELECT * FROM insumo_movimentos WHERE insumo_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]
    );
    res.json({ ...r.rows[0], embalagens: emb.rows, movimentos: mov.rows });
  } catch (err) {
    return internalError(res, err, '[insumos/GET id]');
  }
});

router.post('/', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const unidade = String(req.body.unidade_base || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome do insumo' });
  if (!UNIDADES.includes(unidade)) {
    return res.status(400).json({ error: 'Unidade base deve ser g, ml ou un' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO insumos (nome, unidade_base, categoria) VALUES ($1, $2, $3) RETURNING *`,
      [nome, unidade, req.body.categoria || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Já existe um insumo chamado "${nome}"` });
    return internalError(res, err, '[insumos/POST]');
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
  if (req.body.categoria !== undefined) {
    updates.push(`categoria = $${idx++}`); values.push(req.body.categoria || null);
  }
  // unidade_base não entra: mudar depois de haver saldo e movimentos
  // reinterpretaria todo o histórico em outra escala, em silêncio.
  if (req.body.ativo !== undefined) updates.push(`ativo = ${req.body.ativo ? 'TRUE' : 'FALSE'}`);
  if (!updates.length) return res.status(400).json({ error: 'Nada para alterar' });

  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE insumos SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Insumo não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um insumo com esse nome' });
    return internalError(res, err, '[insumos/PATCH]');
  }
});

// POST /api/insumos/:id/embalagens — liga um nome de nota a este insumo.
// O fator diz quantos da unidade base cada "1" da nota representa: um pacote
// 6x350ml vale 6 unidades; um saco de 1 kg vale 1000 g.
router.post('/:id/embalagens', async (req, res) => {
  const nome = String(req.body.nome_nota || '').trim();
  const fator = parseFloat(req.body.fator);
  if (!nome) return res.status(400).json({ error: 'Informe o nome que aparece na nota' });
  if (!Number.isFinite(fator) || fator <= 0) return res.status(400).json({ error: 'Fator deve ser maior que zero' });
  try {
    const ins = await pool.query(`SELECT id FROM insumos WHERE id = $1`, [req.params.id]);
    if (!ins.rows[0]) return res.status(404).json({ error: 'Insumo não encontrado' });
    const r = await pool.query(
      `INSERT INTO insumo_embalagens (insumo_id, nome_nota, fator) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, nome, fator]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // Vale dizer a qual insumo o nome já pertence — "já existe" sozinho
      // manda a pessoa procurar em 20 cadastros.
      const dono = await pool.query(
        `SELECT i.nome FROM insumo_embalagens e JOIN insumos i ON i.id = e.insumo_id
          WHERE lower(e.nome_nota) = lower($1)`, [nome]
      ).catch(() => ({ rows: [] }));
      return res.status(409).json({
        error: dono.rows[0]
          ? `"${nome}" já está ligado ao insumo "${dono.rows[0].nome}"`
          : `"${nome}" já está ligado a outro insumo`,
      });
    }
    return internalError(res, err, '[insumos/embalagem POST]');
  }
});

router.delete('/embalagens/:embId', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM insumo_embalagens WHERE id = $1 RETURNING id`, [req.params.embId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Embalagem não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[insumos/embalagem DELETE]');
  }
});

// POST /api/insumos/:id/movimento — entrada, saída ou ajuste manual.
// quantidade sempre positiva; o tipo decide o sinal.
router.post('/:id/movimento', async (req, res) => {
  const tipo = String(req.body.tipo || '');
  const qtd = parseFloat(req.body.quantidade);
  if (!['entrada', 'saida', 'ajuste'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!Number.isFinite(qtd) || qtd <= 0) return res.status(400).json({ error: 'Quantidade inválida' });
  const custoTotal = req.body.custo_total !== undefined ? parseFloat(req.body.custo_total) : null;
  if (tipo === 'entrada' && custoTotal !== null && (!Number.isFinite(custoTotal) || custoTotal < 0)) {
    return res.status(400).json({ error: 'Custo inválido' });
  }

  try {
    const r0 = await pool.query(`SELECT * FROM insumos WHERE id = $1`, [req.params.id]);
    const ins = r0.rows[0];
    if (!ins) return res.status(404).json({ error: 'Insumo não encontrado' });

    const sinal = tipo === 'saida' ? -1 : 1;
    // Ajuste é contagem física: o saldo passa a ser o valor informado, não soma.
    const saldoNovo = tipo === 'ajuste' ? qtd : parseFloat(ins.saldo) + sinal * qtd;
    const custoUnit = tipo === 'entrada' && custoTotal !== null && qtd > 0 ? custoTotal / qtd : null;
    const mediaNova = tipo === 'entrada'
      ? novaMedia(ins.saldo, ins.custo_medio, qtd, custoUnit)
      : parseFloat(ins.custo_medio);

    await pool.query(
      `UPDATE insumos SET saldo = ${saldoNovo}, custo_medio = ${mediaNova} WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    const m = await pool.query(
      `INSERT INTO insumo_movimentos
         (insumo_id, tipo, quantidade, custo_unitario, saldo_apos, custo_medio_apos, origem, observacao, created_by)
       VALUES ($1, $2, ${tipo === 'ajuste' ? qtd : sinal * qtd}, ${custoUnit === null ? 'NULL' : custoUnit},
               ${saldoNovo}, ${mediaNova}, $3, $4, $5)
       RETURNING *`,
      [req.params.id, tipo, req.body.origem || 'manual', req.body.observacao || null, req.user?.id || null]
    );
    res.status(201).json({ movimento: m.rows[0], saldo: saldoNovo, custo_medio: mediaNova });
  } catch (err) {
    return internalError(res, err, '[insumos/movimento]');
  }
});

module.exports = router;
module.exports.novaMedia = novaMedia;
