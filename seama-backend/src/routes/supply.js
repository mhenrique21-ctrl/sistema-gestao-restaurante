const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');

// Nome vindo da NF-e varia em caixa e espaçamento entre uma nota e outra.
// Sem normalizar, "COCA COLA" e "Coca  Cola" viram dois vínculos distintos.
function norm(nome) {
  return String(nome || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── Entrada vinda do App Gestão (servidor pra servidor) ────────────────
// Autenticada por segredo compartilhado, não por login de operador: quem
// chama é o backend do Gestão, não uma pessoa.
function serviceAuth(req, res, next) {
  const secret = process.env.SERVICE_SECRET;
  if (!secret) return res.status(503).json({ error: 'Integração não configurada' });
  const header = req.headers['x-service-secret'];
  if (header !== secret) return res.status(401).json({ error: 'Credencial de serviço inválida' });
  next();
}

// POST /api/supply/purchase — recebe os itens de uma compra do Gestão.
// Item COM vínculo entra no estoque; item SEM vínculo vai pra fila de
// pendentes — nada é descartado em silêncio, senão você compra 60 latas,
// nada entra, e ninguém percebe.
router.post('/purchase', serviceAuth, async (req, res) => {
  const { origin_id, supplier, items } = req.body;
  if (!origin_id) return res.status(400).json({ error: 'origin_id é obrigatório' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Informe ao menos um item' });

  try {
    // Idempotência: a mesma compra reenviada não soma estoque de novo.
    const jaFeita = await pool.query(
      `SELECT applied_count, pending_count FROM purchase_entries WHERE origin_id = $1`,
      [String(origin_id)]
    );
    if (jaFeita.rows[0]) {
      return res.json({
        duplicated: true,
        applied: jaFeita.rows[0].applied_count,
        pending: jaFeita.rows[0].pending_count,
        message: 'Compra já processada anteriormente',
      });
    }

    const links = await pool.query(
      `SELECT sl.id, sl.source_name, sl.product_id, sl.factor, p.name AS product_name, p.stock_qty
       FROM supply_links sl JOIN products p ON p.id = sl.product_id
       WHERE sl.active = true`
    );
    const porNome = {};
    links.rows.forEach((l) => { porNome[norm(l.source_name)] = l; });

    // Itens já classificados como matéria-prima ou higiene/limpeza não voltam
    // pra fila: a decisão foi tomada uma vez e fica valendo pras próximas notas.
    const classif = await pool.query(`SELECT source_name, kind FROM supply_classifications`);
    const classificadoPorNome = {};
    classif.rows.forEach((c) => { classificadoPorNome[norm(c.source_name)] = c.kind; });

    const aplicados = [];
    const pendentes = [];
    const classificados = [];
    for (const item of items) {
      const nome = String(item.nome || '').trim();
      const qtd = parseFloat(item.quantidade);
      if (!nome || !(qtd > 0)) continue;

      const link = porNome[norm(nome)];
      if (!link) {
        const kind = classificadoPorNome[norm(nome)];
        if (kind) { classificados.push({ nome, kind }); continue; }
        pendentes.push({ nome, qtd, unidade: item.unidade || 'un' });
        continue;
      }
      const fator = parseFloat(link.factor);
      const entrada = qtd * fator;

      // Custo na UNIDADE DO PDV: a nota diz "1 multipack por R$ 18,00" e o PDV
      // controla latas, então o custo por lata é 18/6. Sem dividir pelo fator,
      // margem e valor de estoque sairiam 6x errados justamente nos itens de
      // maior giro. Nota antiga (ou sem valor) grava NULL, e as telas mostram
      // "—" em vez de fingir que o custo é zero.
      const vUn = parseFloat(item.valor_unitario);
      const custoUn = Number.isFinite(vUn) && vUn >= 0 && fator > 0 ? vUn / fator : null;

      const r = await pool.query(
        `UPDATE products SET stock_qty = stock_qty + ${entrada}
           ${custoUn != null ? `, last_cost = ${custoUn}, last_cost_at = NOW()` : ''}
          WHERE id = $1 RETURNING stock_qty`,
        [link.product_id]
      );
      const saldo = r.rows[0] ? parseFloat(r.rows[0].stock_qty) : null;
      await pool.query(
        `INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, unit_cost, origin_id)
         VALUES ($1, 'entrada', ${entrada}, ${saldo}, $2, ${custoUn != null ? custoUn : 'NULL'}, $3) RETURNING id`,
        [link.product_id, `Compra${supplier ? ' – ' + supplier : ''} (App Gestão)`, String(origin_id)]
      );
      aplicados.push({ nome, produto: link.product_name, comprado: qtd, entrou: entrada, saldo,
                       custo_unitario: custoUn, product_id: link.product_id });
    }

    for (const p of pendentes) {
      await pool.query(
        `INSERT INTO pending_supply_items (source_name, quantity, unit, origin_id, supplier)
         VALUES ($1, ${p.qtd}, $2, $3, $4) RETURNING id`,
        [p.nome, p.unidade, String(origin_id), supplier || null]
      );
    }

    // `applied` guarda o que de fato entrou no estoque, com o produto e a
    // quantidade JÁ convertida pelo fator. É o que o estorno usa: recalcular
    // com o fator de hoje devolveria diferente do que entrou, caso o de-para
    // tenha sido corrigido no meio do caminho.
    const appliedJson = aplicados.map((a) => ({ nome: a.nome, product_id: a.product_id, entrou: a.entrou }));
    await pool.query(
      `INSERT INTO purchase_entries (origin_id, supplier, applied_count, pending_count, payload, applied)
       VALUES ($1, $2, ${aplicados.length}, ${pendentes.length}, ${sqlStr(JSON.stringify({ items }))}::jsonb,
               ${sqlStr(JSON.stringify(appliedJson))}::jsonb)
       RETURNING id`,
      [String(origin_id), supplier || null]
    );

    res.status(201).json({
      applied: aplicados.length,
      pending: pendentes.length,
      classified: classificados.length,
      detalhes: aplicados,
      pendentes: pendentes.map((p) => p.nome),
      classificados: classificados.map((c) => c.nome),
    });
  } catch (err) {
    return internalError(res, err, '[supply/purchase]');
  }
});

// POST /api/supply/purchase/reverse — desfaz o que uma compra do Gestão trouxe.
// Chamada quando a nota (ou um item dela) é excluída lá, ou quando a nota é
// movida pra outra empresa. Sem isso o estoque do PDV fica MAIOR que a
// realidade e ninguém percebe até a contagem física.
//
// Body: { origin_id, items?: ["nome", ...] }  — sem items, estorna a nota toda.
router.post('/purchase/reverse', serviceAuth, async (req, res) => {
  const { origin_id } = req.body;
  if (!origin_id) return res.status(400).json({ error: 'origin_id é obrigatório' });
  const filtro = Array.isArray(req.body.items) && req.body.items.length
    ? new Set(req.body.items.map((n) => norm(n)))
    : null;

  try {
    const entry = await pool.query(
      `SELECT origin_id, applied, payload FROM purchase_entries WHERE origin_id = $1`,
      [String(origin_id)]
    );
    if (!entry.rows[0]) return res.json({ ok: true, reverted: 0, message: 'Compra não consta no PDV' });

    // Já estornados não voltam a ser estornados: excluir a nota depois de já
    // ter excluído um item dela nao pode devolver aquele item duas vezes.
    const feitos = await pool.query(
      `SELECT source_name FROM purchase_reversals WHERE origin_id = $1`,
      [String(origin_id)]
    );
    const jaFeito = new Set(feitos.rows.map((r) => norm(r.source_name)));

    const aplicados = entry.rows[0].applied || [];
    const revertidos = [];
    for (const a of aplicados) {
      if (filtro && !filtro.has(norm(a.nome))) continue;
      if (jaFeito.has(norm(a.nome))) continue;
      const qtd = parseFloat(a.entrou) || 0;
      if (!(qtd > 0) || !a.product_id) continue;

      const r = await pool.query(
        `UPDATE products SET stock_qty = stock_qty - ${qtd} WHERE id = $1 RETURNING stock_qty, name`,
        [a.product_id]
      );
      if (!r.rows[0]) continue;
      const saldo = parseFloat(r.rows[0].stock_qty);
      await pool.query(
        `INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason)
         VALUES ($1, 'estorno', ${-qtd}, ${saldo}, $2) RETURNING id`,
        [a.product_id, `Compra excluída no Gestão – ${a.nome}`]
      );
      await pool.query(
        `INSERT INTO purchase_reversals (origin_id, source_name, product_id, quantity)
         VALUES ($1, $2, $3, ${qtd}) RETURNING id`,
        [String(origin_id), a.nome, a.product_id]
      );
      revertidos.push({ nome: a.nome, produto: r.rows[0].name, devolvido: qtd, saldo });
    }

    // Item que estava só esperando vínculo sai da fila: a compra não existe
    // mais, então não faz sentido continuar pedindo o de-para dela. Num estorno
    // parcial, só o item excluído sai — o resto da nota continua pendente.
    const filtroSql = filtro
      ? ` AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) IN (${[...filtro].map((n) => sqlStr(n)).join(', ')})`
      : '';
    const pend = await pool.query(
      `UPDATE pending_supply_items SET resolved = true
        WHERE origin_id = $1 AND resolved = false${filtroSql} RETURNING source_name`,
      [String(origin_id)]
    );

    res.json({ ok: true, reverted: revertidos.length, detalhes: revertidos, pendentes_removidos: pend.rows.length });
  } catch (err) {
    return internalError(res, err, '[supply/reverse]');
  }
});

// ── Gestão dos vínculos (dentro do PDV) ────────────────────────────────
router.use(authMiddleware, requireRole('gerente', 'admin'));

// GET /api/supply/links — vínculos + fila de pendentes
router.get('/links', async (req, res) => {
  try {
    const links = await pool.query(
      `SELECT sl.id, sl.source_name, sl.factor, sl.product_id, p.name AS product_name
       FROM supply_links sl JOIN products p ON p.id = sl.product_id
       WHERE sl.active = true
       ORDER BY p.name, sl.source_name`
    );
    const removidos = await pool.query(
      `SELECT sl.id, sl.source_name, sl.factor, sl.product_id, p.name AS product_name, sl.removed_at
       FROM supply_links sl JOIN products p ON p.id = sl.product_id
       WHERE sl.active = false
       ORDER BY sl.removed_at DESC`
    );
    const pendentes = await pool.query(
      `SELECT source_name, SUM(quantity) AS quantidade, MAX(unit) AS unidade,
              MAX(supplier) AS supplier, COUNT(*)::int AS ocorrencias
       FROM pending_supply_items WHERE resolved = false
       GROUP BY source_name ORDER BY MAX(created_at) DESC`
    );
    const classificados = await pool.query(
      `SELECT id, source_name, kind FROM supply_classifications ORDER BY kind, source_name`
    );
    res.json({
      links: links.rows.map((l) => ({ ...l, factor: parseFloat(l.factor) })),
      removidos: removidos.rows.map((l) => ({ ...l, factor: parseFloat(l.factor) })),
      pendentes: pendentes.rows.map((p) => ({ ...p, quantidade: parseFloat(p.quantidade) })),
      classificados: classificados.rows,
    });
  } catch (err) {
    return internalError(res, err, '[supply/links]');
  }
});

// POST /api/supply/links — cria o vínculo e, se houver quantidade retida
// esperando por ele, lança tudo de uma vez no estoque.
router.post('/links', async (req, res) => {
  const { source_name, product_id } = req.body;
  const factor = parseFloat(req.body.factor);
  if (!source_name || !product_id) return res.status(400).json({ error: 'Informe o item e o produto' });
  if (!(factor > 0)) return res.status(400).json({ error: 'Fator deve ser maior que zero' });

  try {
    const prod = await pool.query(`SELECT id, name, track_stock FROM products WHERE id = $1`, [product_id]);
    if (!prod.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!prod.rows[0].track_stock) {
      return res.status(400).json({ error: `"${prod.rows[0].name}" não controla estoque — marque no cadastro do produto` });
    }

    // O índice único de nome cobre também os arquivados, então um INSERT cru
    // esbarraria neles com "já está vinculado" — e o usuário não veria motivo,
    // porque o vínculo não está na lista. Aqui o arquivado é ressuscitado com
    // o produto/fator que ele acabou de escolher. Vínculo ATIVO continua dando
    // conflito, como antes: sobrescrever um vínculo em uso sem avisar seria
    // trocar o destino do estoque em silêncio.
    const arquivado = await pool.query(
      `SELECT id FROM supply_links
        WHERE active = false
          AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1`,
      [norm(source_name)]
    );
    if (arquivado.rows[0]) {
      await pool.query(
        `UPDATE supply_links SET product_id = $1, factor = ${factor}, active = true, removed_at = NULL
          WHERE id = $2 RETURNING id`,
        [product_id, arquivado.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO supply_links (source_name, product_id, factor) VALUES ($1, $2, ${factor}) RETURNING id`,
        [String(source_name).trim(), product_id]
      );
    }

    // Quantidade que ficou retida enquanto não havia vínculo entra agora.
    const retidos = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM pending_supply_items
       WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1`,
      [norm(source_name)]
    );
    const totalRetido = parseFloat(retidos.rows[0]?.total || 0);
    let entrou = 0;
    if (totalRetido > 0) {
      entrou = totalRetido * factor;
      const r = await pool.query(
        `UPDATE products SET stock_qty = stock_qty + ${entrou} WHERE id = $1 RETURNING stock_qty`,
        [product_id]
      );
      const saldo = r.rows[0] ? parseFloat(r.rows[0].stock_qty) : null;
      await pool.query(
        `INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, created_by)
         VALUES ($1, 'entrada', ${entrou}, ${saldo}, 'Compra pendente liberada ao vincular', $2) RETURNING id`,
        [product_id, req.user.id]
      );
      await pool.query(
        `UPDATE pending_supply_items SET resolved = true
         WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1
         RETURNING id`,
        [norm(source_name)]
      );
    }

    logAction(req.user.id, 'vinculo_criado', { source_name, produto: prod.rows[0].name, factor, liberado: entrou });
    res.status(201).json({ ok: true, produto: prod.rows[0].name, liberado: entrou });
  } catch (err) {
    if (err.code === '23505' || String(err.message || '').includes('supply_links_source_key')) {
      return res.status(409).json({ error: 'Esse item já está vinculado' });
    }
    return internalError(res, err, '[supply/links create]');
  }
});

// DELETE /api/supply/links/:id — arquiva, não apaga. O que se perde ao remover
// não é o estoque (que fica) e nem a compra futura (que volta pra pendentes),
// e sim a conversão de embalagem — "1 embalagem = 21 un". Refazer esse número
// de memória e errar entra estoque errado sem ninguém perceber, então ele é
// guardado para o Restaurar devolver exatamente o que era.
router.delete('/links/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE supply_links SET active = false, removed_at = NOW()
        WHERE id = $1 AND active = true RETURNING source_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Vínculo não encontrado' });
    logAction(req.user.id, 'vinculo_removido', { source_name: r.rows[0].source_name });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[supply/links delete]');
  }
});

// POST /api/supply/links/:id/restore — desfaz o arquivamento.
router.post('/links/:id/restore', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE supply_links SET active = true, removed_at = NULL
        WHERE id = $1 AND active = false RETURNING source_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Vínculo não encontrado ou já ativo' });
    logAction(req.user.id, 'vinculo_restaurado', { source_name: r.rows[0].source_name });
    res.json({ ok: true, source_name: r.rows[0].source_name });
  } catch (err) {
    return internalError(res, err, '[supply/links restore]');
  }
});

const KINDS = ['materia_prima', 'higiene_limpeza'];

// POST /api/supply/classify — marca um ou vários nomes como não-revenda.
// Aceita lista para o botão "classificar todos os pendentes de uma vez", em
// vez de o operador repetir a mesma decisão dezenove vezes.
router.post('/classify', async (req, res) => {
  const { kind } = req.body;
  const nomes = Array.isArray(req.body.source_names)
    ? req.body.source_names
    : (req.body.source_name ? [req.body.source_name] : []);
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Classificação inválida' });
  const limpos = [...new Set(nomes.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!limpos.length) return res.status(400).json({ error: 'Informe ao menos um item' });

  try {
    let gravados = 0;
    for (const nome of limpos) {
      // ON CONFLICT no índice normalizado: reclassificar um nome já existente
      // troca o tipo em vez de estourar erro de duplicado.
      await pool.query(
        `INSERT INTO supply_classifications (source_name, kind, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')))
         DO UPDATE SET kind = EXCLUDED.kind, created_by = EXCLUDED.created_by, created_at = NOW()
         RETURNING id`,
        [nome, kind, req.user.id]
      );
      // Tira da fila o que já estava esperando com esse nome.
      await pool.query(
        `UPDATE pending_supply_items SET resolved = true
          WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1
          RETURNING id`,
        [norm(nome)]
      );
      gravados++;
    }
    logAction(req.user.id, 'itens_classificados', { kind, quantidade: gravados, nomes: limpos.slice(0, 30) });
    res.status(201).json({ ok: true, classificados: gravados, kind });
  } catch (err) {
    return internalError(res, err, '[supply/classify]');
  }
});

// DELETE /api/supply/classify/:id — volta o item pra fila de conciliação.
// A compra que já passou não é reprocessada: só as próximas voltam a aparecer.
router.delete('/classify/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM supply_classifications WHERE id = $1 RETURNING source_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Classificação não encontrada' });
    logAction(req.user.id, 'classificacao_removida', { source_name: r.rows[0].source_name });
    res.json({ ok: true, source_name: r.rows[0].source_name });
  } catch (err) {
    return internalError(res, err, '[supply/classify delete]');
  }
});

// DELETE /api/supply/pending/:nome — descarta um pendente que não deve entrar
// (insumo de cozinha que veio junto na mesma nota, por exemplo)
router.delete('/pending', async (req, res) => {
  const nome = req.query.nome;
  if (!nome) return res.status(400).json({ error: 'Informe o nome' });
  try {
    await pool.query(
      `UPDATE pending_supply_items SET resolved = true
       WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1
       RETURNING id`,
      [norm(nome)]
    );
    logAction(req.user.id, 'pendente_descartado', { source_name: nome });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[supply/pending delete]');
  }
});

module.exports = router;
