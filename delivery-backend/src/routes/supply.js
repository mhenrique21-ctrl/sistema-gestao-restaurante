const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

// Nome vindo da NF-e varia em caixa e espaçamento entre uma nota e outra.
// Sem normalizar, "COCA COLA" e "Coca  Cola" viram dois vínculos distintos.
function norm(nome) {
  return String(nome || '').trim().replace(/\s+/g, ' ').toUpperCase();
}
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Entrada vinda do App Gestão (servidor pra servidor) ────────────────
// Autenticada por segredo compartilhado, não por login de operador: quem
// chama é o backend do Gestão, não uma pessoa.
function serviceAuth(req, res, next) {
  // Reaproveita o segredo que Gestão e Confraria já compartilham nas rotas de
  // catálogo (ver serviceToken.js). Criar uma variável nova só pra esta ponte
  // seria mais uma coisa pra configurar e esquecer no servidor.
  const secret = process.env.GESTAO_SERVICE_SECRET;
  if (!secret) return res.status(503).json({ error: 'Integração não configurada (GESTAO_SERVICE_SECRET)' });
  if (req.headers['x-service-secret'] !== secret) {
    return res.status(401).json({ error: 'Credencial de serviço inválida' });
  }
  next();
}

// POST /api/supply/purchase — recebe os itens de uma compra do Gestão.
// Item COM vínculo entra no estoque; item classificado como insumo passa
// direto; o resto vai pra fila de pendentes — nada é descartado em silêncio,
// senão você compra 60 latas, nada entra, e ninguém percebe.
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
      `SELECT sl.source_name, sl.product_id, sl.factor, p.name AS product_name
         FROM supply_links sl JOIN products p ON p.id = sl.product_id
        WHERE sl.active = true`
    );
    const porNome = {};
    links.rows.forEach((l) => { porNome[norm(l.source_name)] = l; });

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
      // margem e valor de estoque sairiam 6x errados nos itens de maior giro.
      const vUn = parseFloat(item.valor_unitario);
      const custoUn = Number.isFinite(vUn) && vUn >= 0 && fator > 0 ? vUn / fator : null;

      const r = await pool.query(
        `UPDATE products SET stock_qty = stock_qty + ${entrada}
           ${custoUn != null ? `, last_cost = ${custoUn}, last_cost_at = NOW()` : ''}
          WHERE id = $1 AND track_stock = true RETURNING stock_qty`,
        [link.product_id]
      );
      // Produto vinculado mas sem controle de estoque: o vínculo existe, só
      // não há saldo a mexer. Não é pendência nem erro.
      if (!r.rows[0]) continue;

      const saldo = parseFloat(r.rows[0].stock_qty);
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

// POST /api/supply/purchase/reverse — desfaz o que uma compra trouxe.
// Chamada quando a nota (ou um item) é excluída no Gestão, ou movida pra outra
// empresa. Sem isso o estoque fica MAIOR que a realidade e só aparece na
// contagem física.
router.post('/purchase/reverse', serviceAuth, async (req, res) => {
  const { origin_id } = req.body;
  if (!origin_id) return res.status(400).json({ error: 'origin_id é obrigatório' });
  const filtro = Array.isArray(req.body.items) && req.body.items.length
    ? new Set(req.body.items.map((n) => norm(n)))
    : null;

  try {
    const entry = await pool.query(
      `SELECT applied FROM purchase_entries WHERE origin_id = $1`, [String(origin_id)]
    );
    if (!entry.rows[0]) return res.json({ ok: true, reverted: 0, message: 'Compra não consta no PDV' });

    const feitos = await pool.query(
      `SELECT source_name FROM purchase_reversals WHERE origin_id = $1`, [String(origin_id)]
    );
    const jaFeito = new Set(feitos.rows.map((r) => norm(r.source_name)));

    const revertidos = [];
    for (const a of (entry.rows[0].applied || [])) {
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

    // Num estorno parcial, só o item excluído sai da fila.
    const filtroSql = filtro
      ? ` AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) IN (${[...filtro].map(sqlStr).join(', ')})`
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

// ── Conciliação (dentro do PDV) ────────────────────────────────────────
router.use(authMiddleware, requireRole('admin'));

// GET /api/supply/links — vínculos ativos, arquivados, classificados e a fila.
router.get('/links', async (req, res) => {
  try {
    const links = await pool.query(
      `SELECT sl.id, sl.source_name, sl.factor, sl.product_id, p.name AS product_name
         FROM supply_links sl JOIN products p ON p.id = sl.product_id
        WHERE sl.active = true ORDER BY p.name, sl.source_name`
    );
    const removidos = await pool.query(
      `SELECT sl.id, sl.source_name, sl.factor, p.name AS product_name, sl.removed_at
         FROM supply_links sl JOIN products p ON p.id = sl.product_id
        WHERE sl.active = false ORDER BY sl.removed_at DESC`
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

// POST /api/supply/links — cria o vínculo e libera o que estava retido.
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

    // O índice único cobre arquivados também: um INSERT cru esbarraria neles
    // com "já vinculado" sem o usuário ver motivo, porque o vínculo não está
    // na lista. Aqui o arquivado é ressuscitado com o que ele acabou de
    // escolher. Vínculo ATIVO continua dando conflito: sobrescrever um vínculo
    // em uso sem avisar seria trocar o destino do estoque em silêncio.
    const arquivado = await pool.query(
      `SELECT id FROM supply_links
        WHERE active = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1`,
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

    // Quantidade retida enquanto não havia vínculo entra agora.
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
    res.status(201).json({ ok: true, produto: prod.rows[0].name, liberado: entrou });
  } catch (err) {
    if (err.code === '23505' || String(err.message || '').includes('supply_links_source_key')) {
      return res.status(409).json({ error: 'Esse item já está vinculado' });
    }
    return internalError(res, err, '[supply/links create]');
  }
});

// DELETE /api/supply/links/:id — arquiva, não apaga. O que se perde ao remover
// não é o estoque (fica) nem a compra futura (volta pra pendentes), e sim a
// conversão de embalagem — "1 embalagem = 21 un". Refazer de memória e errar
// entra estoque errado sem ninguém perceber.
router.delete('/links/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE supply_links SET active = false, removed_at = NOW()
        WHERE id = $1 AND active = true RETURNING source_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Vínculo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[supply/links delete]');
  }
});

router.post('/links/:id/restore', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE supply_links SET active = true, removed_at = NULL
        WHERE id = $1 AND active = false RETURNING source_name`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Vínculo não encontrado ou já ativo' });
    res.json({ ok: true, source_name: r.rows[0].source_name });
  } catch (err) {
    return internalError(res, err, '[supply/links restore]');
  }
});

const KINDS = ['materia_prima', 'higiene_limpeza'];

// POST /api/supply/classify — marca nomes como não-revenda. Aceita lista para
// o botão "classificar todos os pendentes", em vez de repetir a mesma decisão
// dezenas de vezes.
router.post('/classify', async (req, res) => {
  const { kind } = req.body;
  const nomes = Array.isArray(req.body.source_names)
    ? req.body.source_names
    : (req.body.source_name ? [req.body.source_name] : []);
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Classificação inválida' });
  const limpos = [...new Set(nomes.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!limpos.length) return res.status(400).json({ error: 'Informe ao menos um item' });

  try {
    for (const nome of limpos) {
      await pool.query(
        `INSERT INTO supply_classifications (source_name, kind, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')))
         DO UPDATE SET kind = EXCLUDED.kind, created_by = EXCLUDED.created_by, created_at = NOW()
         RETURNING id`,
        [nome, kind, req.user.id]
      );
      await pool.query(
        `UPDATE pending_supply_items SET resolved = true
          WHERE resolved = false AND upper(regexp_replace(trim(source_name), '\\s+', ' ', 'g')) = $1
          RETURNING id`,
        [norm(nome)]
      );
    }
    res.status(201).json({ ok: true, classificados: limpos.length, kind });
  } catch (err) {
    return internalError(res, err, '[supply/classify]');
  }
});

router.delete('/classify/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM supply_classifications WHERE id = $1 RETURNING source_name`, [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Classificação não encontrada' });
    res.json({ ok: true, source_name: r.rows[0].source_name });
  } catch (err) {
    return internalError(res, err, '[supply/classify delete]');
  }
});

module.exports = router;
