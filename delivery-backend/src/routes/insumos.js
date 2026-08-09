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

// GET /api/insumos/pendentes — a fila de conciliação de insumos.
//
// Não é a mesma fila da tela de Compras. Ali "pendente" é o que ainda não foi
// tratado de forma nenhuma (19 nomes). Aqui interessa também o que já foi
// classificado como matéria-prima: isso é resolvido para as Compras, mas é
// exatamente o candidato a insumo.
//
// Ficam de fora: o que virou produto de revenda (tem supply_link) e o que foi
// classificado como higiene e limpeza — esse é despesa direta, não entra em
// ficha técnica.
router.get('/pendentes', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.source_name, p.unit,
              SUM(p.quantity) AS quantidade,
              COUNT(*)::int AS vezes,
              MAX(p.created_at) AS ultima,
              string_agg(DISTINCT p.supplier, ' · ') AS fornecedores,
              bool_or(NOT p.resolved) AS tem_pendente,
              MAX(c.kind) AS classificacao
         FROM pending_supply_items p
         LEFT JOIN insumo_embalagens e ON upper(regexp_replace(trim(e.nome_nota), '\\s+', ' ', 'g')) = upper(regexp_replace(trim(p.source_name), '\\s+', ' ', 'g'))
         LEFT JOIN supply_links sl ON sl.active = true
                                  AND upper(regexp_replace(trim(sl.source_name), '\\s+', ' ', 'g'))
                                    = upper(regexp_replace(trim(p.source_name), '\\s+', ' ', 'g'))
         LEFT JOIN supply_classifications c
                ON upper(regexp_replace(trim(c.source_name), '\\s+', ' ', 'g'))
                 = upper(regexp_replace(trim(p.source_name), '\\s+', ' ', 'g'))
        WHERE e.id IS NULL
          AND sl.id IS NULL
          AND (c.kind IS NULL OR c.kind = 'materia_prima')
          AND (NOT p.resolved OR c.kind = 'materia_prima')
        GROUP BY p.source_name, p.unit
        ORDER BY COUNT(*) DESC, p.source_name`
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[insumos/pendentes]');
  }
});

// Unidade da nota → unidade base + fator. É só um palpite de partida: quem
// cadastra confirma. Mas acertar o comum evita digitar 1000 toda vez.
const DA_UNIDADE = {
  kg: { base: 'g', fator: 1000 },
  g: { base: 'g', fator: 1 },
  l: { base: 'ml', fator: 1000 },
  lt: { base: 'ml', fator: 1000 },
  ml: { base: 'ml', fator: 1 },
};
function sugerirUnidade(unidadeNota) {
  return DA_UNIDADE[String(unidadeNota || '').trim().toLowerCase()] || { base: 'un', fator: 1 };
}

// POST /api/insumos/da-compra — cria o insumo já ligado à linha da nota.
// Serve o caminho natural: a pessoa está olhando "Camarão Rosa, 3,02 kg" na
// tela de Compras e quer dizer "isso é um insumo" sem trocar de tela, criar o
// cadastro do zero e voltar pra ligar o nome.
router.post('/da-compra', async (req, res) => {
  const origem = String(req.body.source_name || '').trim();
  if (!origem) return res.status(400).json({ error: 'Informe o item da compra' });
  const nome = String(req.body.nome || origem).trim();
  const palpite = sugerirUnidade(req.body.unit);
  const unidade = UNIDADES.includes(req.body.unidade_base) ? req.body.unidade_base : palpite.base;
  const fator = Number.isFinite(parseFloat(req.body.fator)) && parseFloat(req.body.fator) > 0
    ? parseFloat(req.body.fator) : palpite.fator;

  try {
    const jaLigado = await pool.query(
      `SELECT i.nome FROM insumo_embalagens e JOIN insumos i ON i.id = e.insumo_id
        WHERE upper(regexp_replace(trim(e.nome_nota), '\\s+', ' ', 'g')) = upper(regexp_replace(trim($1), '\\s+', ' ', 'g'))`, [origem]
    );
    if (jaLigado.rows[0]) {
      return res.status(409).json({ error: `"${origem}" já está ligado ao insumo "${jaLigado.rows[0].nome}"` });
    }

    // Insumo com o mesmo nome já existe? Então é só mais uma embalagem dele —
    // que é o caso das três Coca-Colas. Criar um segundo insumo homônimo seria
    // o erro que o índice único impede, mas com uma mensagem pior.
    const existente = await pool.query(
      `SELECT id, nome, unidade_base FROM insumos WHERE lower(nome) = lower($1) AND ativo = true`, [nome]
    );
    let insumo = existente.rows[0];
    let criado = false;
    if (!insumo) {
      const novo = await pool.query(
        `INSERT INTO insumos (nome, unidade_base, categoria) VALUES ($1, $2, $3) RETURNING *`,
        [nome, unidade, req.body.categoria || null]
      );
      insumo = novo.rows[0];
      criado = true;
    }

    const emb = await pool.query(
      `INSERT INTO insumo_embalagens (insumo_id, nome_nota, fator) VALUES ($1, $2, $3) RETURNING *`,
      [insumo.id, origem, fator]
    );
    // Sai da fila de Compras: já foi decidido o que ele é.
    await pool.query(
      `UPDATE pending_supply_items SET resolved = true
        WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = upper(regexp_replace(trim($1), '\\s+', ' ', 'g')) RETURNING id`, [origem]
    );

    res.status(201).json({ insumo, embalagem: emb.rows[0], criado });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Esse item já está ligado a um insumo' });
    return internalError(res, err, '[insumos/da-compra]');
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
    // Sem isto, ligar um nome de nota a um insumo JÁ EXISTENTE nunca marcava o
    // item como resolvido — ele saía da fila de Insumos (porque passou a ter
    // embalagem) mas ficava preso pra sempre na fila de Compras, que só olha
    // pending_supply_items.resolved. Só o caminho que cria insumo NOVO
    // (POST /da-compra) fazia esse UPDATE; este endpoint, usado tanto pela
    // aba Insumos quanto pela Compras, também precisa.
    await pool.query(
      `UPDATE pending_supply_items SET resolved = true
        WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = upper(regexp_replace(trim($1), '\\s+', ' ', 'g')) RETURNING id`,
      [nome]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // Vale dizer a qual insumo o nome já pertence — "já existe" sozinho
      // manda a pessoa procurar em 20 cadastros.
      const dono = await pool.query(
        `SELECT i.nome FROM insumo_embalagens e JOIN insumos i ON i.id = e.insumo_id
          WHERE upper(regexp_replace(trim(e.nome_nota), '\\s+', ' ', 'g')) = upper(regexp_replace(trim($1), '\\s+', ' ', 'g'))`, [nome]
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
