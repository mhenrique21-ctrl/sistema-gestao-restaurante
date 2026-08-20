const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware);

// Um grupo de adicionais existe UMA vez e é ligado a N produtos por
// product_addons. Editar o preço do queijo é editar uma linha, não uma por
// produto — foi justamente a cópia por produto que obrigou a Confraria a
// construir templates de propagação depois.

// GET /api/addons — grupos + opções + produtos vinculados, tudo de uma vez.
// A tela de venda carrega isso no load junto com produtos/categorias, então
// abrir um produto com adicionais não custa ida ao servidor.
router.get('/', async (req, res) => {
  try {
    const groups = await pool.query(
      `SELECT id, name, max_per_item, sort_order, active
         FROM addon_groups ORDER BY sort_order, name`
    );
    const options = await pool.query(
      `SELECT id, group_id, name, price, sort_order, active
         FROM addon_options ORDER BY sort_order, name`
    );
    const links = await pool.query(`SELECT product_id, group_id FROM product_addons`);

    const byGroup = {};
    options.rows.forEach((o) => {
      (byGroup[o.group_id] = byGroup[o.group_id] || []).push(o);
    });
    const prodsOf = {};
    links.rows.forEach((l) => {
      (prodsOf[l.group_id] = prodsOf[l.group_id] || []).push(l.product_id);
    });

    res.json(groups.rows.map((g) => ({
      ...g,
      options: byGroup[g.id] || [],
      product_ids: prodsOf[g.id] || [],
    })));
  } catch (err) {
    return internalError(res, err, '[addons/GET]');
  }
});

router.post('/groups', requireRole('admin', 'gerente'), async (req, res) => {
  const { name, max_per_item = 5, sort_order = 0 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const result = await pool.query(
      `INSERT INTO addon_groups (name, max_per_item, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), parseInt(max_per_item) || 5, parseInt(sort_order) || 0]
    );
    res.status(201).json({ ...result.rows[0], options: [], product_ids: [] });
  } catch (err) {
    return internalError(res, err, '[addons/POST groups]');
  }
});

router.patch('/groups/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { name, max_per_item, sort_order, active } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(String(name).trim()); }
  if (max_per_item !== undefined) { updates.push(`max_per_item = $${idx++}`); values.push(parseInt(max_per_item) || 1); }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(parseInt(sort_order) || 0); }
  // Booleano interpolado como literal em vez de parâmetro: o wrapper do pool
  // faz substituição de string, e acima de $9 o regex de "$1" casa dentro de
  // "$10". Mantendo os parâmetros baixos, nunca chegamos perto disso.
  if (active !== undefined) updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`);
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE addon_groups SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[addons/PATCH group]');
  }
});

// Apaga o grupo, suas opções e os vínculos (ON DELETE CASCADE nas duas).
// Vendas passadas não são afetadas: sale_items.addons guarda o snapshot.
router.delete('/groups/:id', requireRole('admin', 'gerente'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM addon_groups WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[addons/DELETE group]');
  }
});

router.post('/groups/:id/options', requireRole('admin', 'gerente'), async (req, res) => {
  const { name, price = 0, sort_order = 0 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  const valor = parseFloat(String(price).replace(',', '.'));
  if (!(valor >= 0)) return res.status(400).json({ error: 'Preço inválido' });
  try {
    const result = await pool.query(
      `INSERT INTO addon_options (group_id, name, price, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, name.trim(), valor, parseInt(sort_order) || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[addons/POST option]');
  }
});

router.patch('/options/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { name, price, sort_order, active } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(String(name).trim()); }
  if (price !== undefined) {
    const valor = parseFloat(String(price).replace(',', '.'));
    if (!(valor >= 0)) return res.status(400).json({ error: 'Preço inválido' });
    updates.push(`price = $${idx++}`); values.push(valor);
  }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(parseInt(sort_order) || 0); }
  if (active !== undefined) updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`);
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE addon_options SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[addons/PATCH option]');
  }
});

router.delete('/options/:id', requireRole('admin', 'gerente'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM addon_options WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    return internalError(res, err, '[addons/DELETE option]');
  }
});

// PUT /api/addons/groups/:id/products — define a lista completa de produtos
// que usam o grupo (a tela manda o conjunto inteiro, não um diff).
router.put('/groups/:id/products', requireRole('admin', 'gerente'), async (req, res) => {
  const ids = Array.isArray(req.body.product_ids) ? req.body.product_ids : null;
  if (!ids) return res.status(400).json({ error: 'product_ids deve ser uma lista' });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // O id do grupo entra interpolado no INSERT em lote abaixo, então precisa
  // ser validado aqui — não basta validar os ids dos produtos.
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Grupo inválido' });
  const limpos = [...new Set(ids.filter((v) => typeof v === 'string' && UUID.test(v)))];
  try {
    // RETURNING é OBRIGATÓRIO aqui, mesmo sem uso do resultado: o run_sql do
    // Supabase executa tudo como `WITH __q AS (<query>) SELECT ...`, e o
    // Postgres recusa uma CTE que modifica dados sem RETURNING. Sem isso o
    // salvamento morria com "Erro interno".
    await pool.query(`DELETE FROM product_addons WHERE group_id = $1 RETURNING product_id`, [req.params.id]);
    if (limpos.length) {
      // Um INSERT só: com um por produto, ligar 30 produtos viraria 30 idas ao
      // banco. Os ids já foram validados como uuid acima.
      const valores = limpos.map((pid) => `('${pid}'::uuid, '${req.params.id}'::uuid)`).join(', ');
      await pool.query(`INSERT INTO product_addons (product_id, group_id) VALUES ${valores} ON CONFLICT DO NOTHING RETURNING product_id`);
    }
    res.json({ ok: true, product_ids: limpos });
  } catch (err) {
    return internalError(res, err, '[addons/PUT products]');
  }
});

module.exports = router;
