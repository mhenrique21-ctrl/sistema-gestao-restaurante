const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

router.use(authMiddleware, requireRole('admin'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
const KINDS = ['adicional', 'preparo'];

function erro(res, err, tag) {
  console.error(tag, err.message);
  return res.status(500).json({ error: 'Erro interno do servidor' });
}

// GET /api/addon-groups — grupos canônicos (product_id nulo) com opções e
// produtos ligados. As cópias antigas por produto ficaram inativas na migração
// e não aparecem aqui de propósito.
router.get('/', async (req, res) => {
  try {
    const grupos = await pool.query(
      `SELECT id, name, kind, max_select, required, sort_order, active
         FROM addon_groups WHERE product_id IS NULL ORDER BY kind, sort_order, name`
    );
    const opcoes = await pool.query(
      `SELECT o.id, o.group_id, o.name, o.price, o.sort_order, o.active
         FROM addon_options o JOIN addon_groups g ON g.id = o.group_id
        WHERE g.product_id IS NULL ORDER BY o.sort_order, o.name`
    );
    const links = await pool.query(
      `SELECT pa.group_id, pa.product_id, p.name AS product_name, c.name AS category_name
         FROM product_addons pa
         JOIN products p ON p.id = pa.product_id
         LEFT JOIN categories c ON c.id = p.category_id`
    );

    const porGrupo = {}, prodsDe = {};
    opcoes.rows.forEach((o) => (porGrupo[o.group_id] = porGrupo[o.group_id] || []).push({ ...o, price: parseFloat(o.price) }));
    links.rows.forEach((l) => (prodsDe[l.group_id] = prodsDe[l.group_id] || []).push(l));

    res.json(grupos.rows.map((g) => ({
      ...g,
      options: porGrupo[g.id] || [],
      products: prodsDe[g.id] || [],
    })));
  } catch (err) {
    return erro(res, err, '[addon-groups/list]');
  }
});

router.post('/', async (req, res) => {
  const { name, kind = 'adicional' } = req.body;
  const max = parseInt(req.body.max_select, 10) || 1;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Informe o nome do grupo' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido' });
  try {
    // min_select acompanha required. Marcar "obrigatório" com mínimo 0 criava
    // um grupo que a tela nunca cobrava — count < 0 jamais é verdade. Foi
    // exatamente o que aconteceu com "Descartáveis", obrigatório em 79
    // produtos e passando direto.
    const obrig = !!req.body.required;
    const r = await pool.query(
      `INSERT INTO addon_groups (product_id, name, kind, max_select, min_select, required, sort_order)
       VALUES (NULL, $1, $2, ${max}, ${obrig ? 1 : 0}, ${obrig ? 'TRUE' : 'FALSE'}, 0) RETURNING *`,
      [name.trim(), kind]
    );
    res.status(201).json({ ...r.rows[0], options: [], products: [] });
  } catch (err) {
    return erro(res, err, '[addon-groups/create]');
  }
});

router.patch('/:id', async (req, res) => {
  const updates = [];
  const values = [];
  let idx = 1;
  if (req.body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(String(req.body.name).trim()); }
  if (req.body.kind !== undefined) {
    if (!KINDS.includes(req.body.kind)) return res.status(400).json({ error: 'Tipo inválido' });
    updates.push(`kind = $${idx++}`); values.push(req.body.kind);
  }
  // Booleanos e números como literal: o wrapper do pool quebra acima de $9.
  if (req.body.max_select !== undefined) updates.push(`max_select = ${parseInt(req.body.max_select, 10) || 1}`);
  if (req.body.required !== undefined) {
    // required e min_select andam juntos, senão "obrigatório" vira enfeite.
    updates.push(`required = ${req.body.required ? 'TRUE' : 'FALSE'}`);
    updates.push(`min_select = ${req.body.required ? 1 : 0}`);
  }
  if (req.body.active !== undefined) updates.push(`active = ${req.body.active ? 'TRUE' : 'FALSE'}`);
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE addon_groups SET ${updates.join(', ')} WHERE id = $${idx} AND product_id IS NULL RETURNING *`,
      values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    return erro(res, err, '[addon-groups/patch]');
  }
});

router.post('/:id/options', async (req, res) => {
  const { name } = req.body;
  const preco = parseFloat(String(req.body.price ?? 0).replace(',', '.'));
  if (!name || !name.trim()) return res.status(400).json({ error: 'Informe o nome' });
  if (!(preco >= 0)) return res.status(400).json({ error: 'Preço inválido' });
  try {
    const r = await pool.query(
      `INSERT INTO addon_options (group_id, name, price, sort_order, active)
       VALUES ($1, $2, ${preco}, 0, TRUE) RETURNING *`,
      [req.params.id, name.trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    return erro(res, err, '[addon-groups/option create]');
  }
});

router.patch('/options/:id', async (req, res) => {
  const updates = [];
  const values = [];
  let idx = 1;
  if (req.body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(String(req.body.name).trim()); }
  if (req.body.price !== undefined) {
    const p = parseFloat(String(req.body.price).replace(',', '.'));
    if (!(p >= 0)) return res.status(400).json({ error: 'Preço inválido' });
    updates.push(`price = ${p}`);
  }
  if (req.body.active !== undefined) updates.push(`active = ${req.body.active ? 'TRUE' : 'FALSE'}`);
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE addon_options SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    return erro(res, err, '[addon-groups/option patch]');
  }
});

router.delete('/options/:id', async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM addon_options WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    return erro(res, err, '[addon-groups/option delete]');
  }
});

// PUT /api/addon-groups/:id/products — define a lista COMPLETA de produtos que
// usam o grupo. A tela manda o conjunto inteiro, não um diff.
router.put('/:id/products', async (req, res) => {
  const ids = Array.isArray(req.body.product_ids) ? req.body.product_ids : null;
  if (!ids) return res.status(400).json({ error: 'product_ids deve ser uma lista' });
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Grupo inválido' });
  const limpos = [...new Set(ids.filter((v) => typeof v === 'string' && UUID.test(v)))];
  try {
    await pool.query(`DELETE FROM product_addons WHERE group_id = $1 RETURNING product_id`, [req.params.id]);
    if (limpos.length) {
      // Um INSERT só: ligar 79 produtos um a um seriam 79 idas ao banco.
      const vals = limpos.map((p) => `('${p}'::uuid, '${req.params.id}'::uuid)`).join(', ');
      await pool.query(`INSERT INTO product_addons (product_id, group_id) VALUES ${vals} ON CONFLICT DO NOTHING RETURNING product_id`);
    }
    res.json({ ok: true, produtos: limpos.length });
  } catch (err) {
    return erro(res, err, '[addon-groups/products]');
  }
});

module.exports = router;
