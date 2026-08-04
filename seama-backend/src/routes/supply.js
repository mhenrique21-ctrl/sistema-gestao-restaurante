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

    const aplicados = [];
    const pendentes = [];
    for (const item of items) {
      const nome = String(item.nome || '').trim();
      const qtd = parseFloat(item.quantidade);
      if (!nome || !(qtd > 0)) continue;

      const link = porNome[norm(nome)];
      if (!link) {
        pendentes.push({ nome, qtd, unidade: item.unidade || 'un' });
        continue;
      }
      const entrada = qtd * parseFloat(link.factor);
      const r = await pool.query(
        `UPDATE products SET stock_qty = stock_qty + ${entrada} WHERE id = $1 RETURNING stock_qty`,
        [link.product_id]
      );
      const saldo = r.rows[0] ? parseFloat(r.rows[0].stock_qty) : null;
      await pool.query(
        `INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason)
         VALUES ($1, 'entrada', ${entrada}, ${saldo}, $2) RETURNING id`,
        [link.product_id, `Compra${supplier ? ' – ' + supplier : ''} (App Gestão)`]
      );
      aplicados.push({ nome, produto: link.product_name, comprado: qtd, entrou: entrada, saldo });
    }

    for (const p of pendentes) {
      await pool.query(
        `INSERT INTO pending_supply_items (source_name, quantity, unit, origin_id, supplier)
         VALUES ($1, ${p.qtd}, $2, $3, $4) RETURNING id`,
        [p.nome, p.unidade, String(origin_id), supplier || null]
      );
    }

    await pool.query(
      `INSERT INTO purchase_entries (origin_id, supplier, applied_count, pending_count, payload)
       VALUES ($1, $2, ${aplicados.length}, ${pendentes.length}, ${sqlStr(JSON.stringify({ items }))}::jsonb)
       RETURNING id`,
      [String(origin_id), supplier || null]
    );

    res.status(201).json({
      applied: aplicados.length,
      pending: pendentes.length,
      detalhes: aplicados,
      pendentes: pendentes.map((p) => p.nome),
    });
  } catch (err) {
    return internalError(res, err, '[supply/purchase]');
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
    res.json({
      links: links.rows.map((l) => ({ ...l, factor: parseFloat(l.factor) })),
      removidos: removidos.rows.map((l) => ({ ...l, factor: parseFloat(l.factor) })),
      pendentes: pendentes.rows.map((p) => ({ ...p, quantidade: parseFloat(p.quantidade) })),
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
