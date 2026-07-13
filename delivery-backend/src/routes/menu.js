const router = require('express').Router();
const multer = require('multer');
const pool = require('../db/pool');
const { supabase } = require('../db/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Arquivo precisa ser uma imagem'));
    cb(null, true);
  },
});

// POST /api/menu/upload — envia imagem (galeria/câmera) e retorna a URL pública (admin)
router.post('/upload', authMiddleware, requireRole('admin'), upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const allowedFolders = ['products', 'banner', 'logo'];
  const folder = allowedFolders.includes(req.body.folder) ? req.body.folder : 'products';
  const ext = (req.file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  try {
    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;

    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    res.status(201).json({ url: data.publicUrl });
  } catch (err) {
    console.error('[menu/upload]', err.message);
    res.status(500).json({ error: 'Erro ao enviar imagem' });
  }
});

// GET /api/menu — cardápio completo agrupado por categoria
// ?channel=kiosk|delivery filtra por show_kiosk/show_delivery — sem o
// parâmetro (ex: PDV fazendo venda de balcão), mostra tudo que está
// disponível, sem restrição de canal.
router.get('/', async (req, res) => {
  try {
    const todayJs = new Date().getDay(); // 0=Dom, 1=Seg … 6=Sáb
    const channelCol = req.query.channel === 'kiosk' ? 'show_kiosk' : req.query.channel === 'delivery' ? 'show_delivery' : null;
    const channelSql = channelCol ? `AND p.${channelCol} = true` : '';
    const result = await pool.query(`
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.description AS category_description,
        c.image_url AS category_image,
        c.sort_order AS category_sort,
        p.id AS product_id,
        p.name AS product_name,
        p.description AS product_description,
        p.price,
        p.image_url AS product_image,
        p.available,
        p.featured,
        p.promo_price,
        p.promo_label,
        p.promo_days,
        p.sort_order AS product_sort
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.available = true
        AND (p.active_days IS NULL OR $1 = ANY(p.active_days))
        ${channelSql}
      WHERE c.active = true
      ORDER BY c.sort_order, p.sort_order, p.name
    `, [todayJs]);

    const addonsResult = await pool.query(`
      SELECT
        g.id AS group_id, g.product_id, g.name AS group_name, g.min_select,
        g.max_select, g.required, g.sort_order AS group_sort,
        o.id AS option_id, o.name AS option_name, o.price AS option_price,
        o.sort_order AS option_sort
      FROM addon_groups g
      LEFT JOIN addon_options o ON o.group_id = g.id AND o.active = true
      WHERE (g.active_days IS NULL OR $1 = ANY(g.active_days))
      ORDER BY g.sort_order, o.sort_order, o.name
    `, [todayJs]);

    const addonsByProduct = {};
    for (const row of addonsResult.rows) {
      if (!addonsByProduct[row.product_id]) addonsByProduct[row.product_id] = {};
      const groups = addonsByProduct[row.product_id];
      if (!groups[row.group_id]) {
        groups[row.group_id] = {
          id: row.group_id,
          name: row.group_name,
          min_select: row.min_select,
          max_select: row.max_select,
          required: row.required,
          options: [],
        };
      }
      if (row.option_id) {
        groups[row.group_id].options.push({
          id: row.option_id,
          name: row.option_name,
          price: parseFloat(row.option_price),
        });
      }
    }

    const menu = {};
    for (const row of result.rows) {
      if (!menu[row.category_id]) {
        menu[row.category_id] = {
          id: row.category_id,
          name: row.category_name,
          description: row.category_description,
          image_url: row.category_image,
          sort_order: row.category_sort,
          products: [],
        };
      }
      if (row.product_id) {
        const activePromo = row.promo_price !== null && (row.promo_days === null || row.promo_days.includes(todayJs));
        if (activePromo && row.category_name !== 'Ofertas') continue;
        menu[row.category_id].products.push({
          id: row.product_id,
          name: row.product_name,
          description: row.product_description,
          price: parseFloat(row.price),
          image_url: row.product_image,
          available: row.available,
          featured: row.featured,
          promo_price: activePromo ? parseFloat(row.promo_price) : null,
          promo_label: row.promo_label,
          addon_groups: Object.values(addonsByProduct[row.product_id] || {}),
        });
      }
    }

    res.json(Object.values(menu).sort((a, b) => a.sort_order - b.sort_order));
  } catch (err) {
    console.error('[menu/GET]', err.message);
    res.status(500).json({ error: 'Erro ao buscar cardápio' });
  }
});

// GET /api/menu/admin — todos os produtos incluindo indisponíveis (admin)
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id AS category_id, c.name AS category_name, c.sort_order AS category_sort,
        p.id AS product_id, p.name AS product_name, p.description, p.price,
        p.image_url AS product_image, p.available, p.featured, p.promo_price,
        p.promo_label, p.sort_order AS product_sort, p.active_days, p.print_target,
        p.show_kiosk, p.show_delivery
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      WHERE c.active = true
      ORDER BY c.sort_order, p.sort_order, p.name
    `);
    const cats = {};
    for (const row of result.rows) {
      if (!cats[row.category_id]) cats[row.category_id] = { id: row.category_id, name: row.category_name, products: [] };
      if (row.product_id) cats[row.category_id].products.push({
        id: row.product_id, name: row.product_name, description: row.description,
        price: row.price, image_url: row.product_image, available: row.available,
        featured: row.featured, promo_price: row.promo_price, promo_label: row.promo_label,
        sort_order: row.product_sort, category_id: row.category_id, category_name: row.category_name,
        active_days: row.active_days,
        print_target: row.print_target,
        show_kiosk: row.show_kiosk,
        show_delivery: row.show_delivery,
      });
    }
    res.json(Object.values(cats));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

// GET /api/menu/products/:id — produto específico
router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/menu/products — criar produto (admin)
router.post('/products', authMiddleware, requireRole('admin'), async (req, res) => {
  const { category_id, name, description, price, image_url, sort_order, featured, promo_price, promo_label, active_days, print_target, promo_days, show_kiosk, show_delivery } = req.body;
  if (!category_id || !name || price === undefined) {
    return res.status(400).json({ error: 'category_id, name e price são obrigatórios' });
  }
  const target = ['cozinha','balcao'].includes(print_target) ? print_target : null;
  const daysArr = Array.isArray(active_days) && active_days.length > 0 ? active_days.map(Number) : null;
  const promoArr = Array.isArray(promo_days) && promo_days.length > 0 ? promo_days.map(Number) : null;
  const daysSql = daysArr ? `'{${daysArr.join(',')}}'::int[]` : 'NULL';
  const targetSql = target ? `'${target}'` : 'NULL';
  const promoDaysSql = promoArr ? `'{${promoArr.join(',')}}'::int[]` : 'NULL';
  // show_kiosk/show_delivery entram como literal SQL (não como $N) de propósito —
  // este projeto tem um bug conhecido de driver no VPS com parâmetros $10+
  // (a substituição de string do wrapper corrompe o "$1" embutido em "$10").
  const showKioskSql = show_kiosk === false ? 'FALSE' : 'TRUE';
  const showDeliverySql = show_delivery === false ? 'FALSE' : 'TRUE';
  try {
    const result = await pool.query(
      `INSERT INTO products (category_id, name, description, price, image_url, sort_order, featured, promo_price, promo_label, active_days, print_target, promo_days, show_kiosk, show_delivery)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${daysSql}, ${targetSql}, ${promoDaysSql}, ${showKioskSql}, ${showDeliverySql}) RETURNING *`,
      [category_id, name, description, price, image_url, sort_order || 0, featured || false, promo_price || null, promo_label || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Categoria não encontrada' });
    console.error('[menu/POST product]', err.message);
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

// PATCH /api/menu/products/:id/available — pausar/ativar produto por falta de estoque
// (admin ou atendente — ação rápida de operação, não é edição de cadastro)
router.patch('/products/:id/available', authMiddleware, requireRole('admin', 'atendente'), async (req, res) => {
  if (typeof req.body.available !== 'boolean') {
    return res.status(400).json({ error: 'Campo "available" (boolean) é obrigatório' });
  }
  try {
    const result = await pool.query(
      `UPDATE products SET available = $1 WHERE id = $2 RETURNING *`,
      [req.body.available, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[menu/products/available]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/menu/products/:id — atualizar produto (admin)
router.patch('/products/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const fields = ['name', 'description', 'price', 'image_url', 'available', 'sort_order', 'category_id', 'featured', 'promo_price', 'promo_label', 'print_target'];
  const updates = [];
  const values = [];
  let idx = 1;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(req.body[field]);
    }
  }

  if (req.body.active_days !== undefined) {
    const days = Array.isArray(req.body.active_days) && req.body.active_days.length > 0
      ? req.body.active_days.map(Number)
      : null;
    const sql = days ? `'{${days.join(',')}}'::int[]` : 'NULL';
    updates.push(`active_days = ${sql}`);
  }

  if (req.body.promo_days !== undefined) {
    const pdays = Array.isArray(req.body.promo_days) && req.body.promo_days.length > 0
      ? req.body.promo_days.map(Number)
      : null;
    const sql = pdays ? `'{${pdays.join(',')}}'::int[]` : 'NULL';
    updates.push(`promo_days = ${sql}`);
  }

  // Literal SQL (não $N) de propósito — mesmo motivo do active_days/promo_days
  // acima: evitar estourar $9 parâmetros (bug do driver no VPS com $10+).
  if (req.body.show_kiosk !== undefined) updates.push(`show_kiosk = ${req.body.show_kiosk ? 'TRUE' : 'FALSE'}`);
  if (req.body.show_delivery !== undefined) updates.push(`show_delivery = ${req.body.show_delivery ? 'TRUE' : 'FALSE'}`);

  if (updates.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/menu/products/:id — remover produto (admin)
router.delete('/products/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM products WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Este produto já tem pedidos registrados e não pode ser excluído. Desative-o em vez disso.' });
    }
    console.error('[menu/products DELETE]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Adicionais (grupos e opções) ────────────────────────────────────

// GET /api/menu/products/:id/addon-groups — grupos de um produto (admin)
router.get('/products/:id/addon-groups', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const groups = await pool.query(
      `SELECT * FROM addon_groups WHERE product_id = $1 ORDER BY sort_order, name`,
      [req.params.id]
    );
    const options = await pool.query(
      `SELECT o.* FROM addon_options o
       JOIN addon_groups g ON g.id = o.group_id
       WHERE g.product_id = $1 ORDER BY o.sort_order, o.name`,
      [req.params.id]
    );
    const result = groups.rows.map((g) => ({
      ...g,
      options: options.rows.filter((o) => o.group_id === g.id),
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/menu/products/:id/addon-groups — criar grupo (admin)
router.post('/products/:id/addon-groups', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, min_select = 0, max_select = 1, required = false, sort_order = 0, active_days } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const daysArr = Array.isArray(active_days) && active_days.length > 0 ? active_days.map(Number) : null;
  const daysSql = daysArr ? `'{${daysArr.join(',')}}'::int[]` : 'NULL';
  try {
    const result = await pool.query(
      `INSERT INTO addon_groups (product_id, name, min_select, max_select, required, sort_order, active_days)
       VALUES ($1,$2,$3,$4,$5,$6,${daysSql}) RETURNING *`,
      [req.params.id, name, min_select, max_select, required, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Produto não encontrado' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/menu/addon-groups/:id — editar grupo (admin)
router.patch('/addon-groups/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const fields = ['name', 'min_select', 'max_select', 'required', 'sort_order'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (req.body.active_days !== undefined) {
    const daysArr = Array.isArray(req.body.active_days) && req.body.active_days.length > 0 ? req.body.active_days.map(Number) : null;
    const daysSql = daysArr ? `'{${daysArr.join(',')}}'::int[]` : 'NULL';
    updates.push(`active_days = ${daysSql}`);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE addon_groups SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/menu/addon-groups/:id — remover grupo (admin)
router.delete('/addon-groups/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM addon_groups WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/menu/addon-groups/:id/options — criar opção (admin)
router.post('/addon-groups/:id/options', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, price = 0, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const result = await pool.query(
      `INSERT INTO addon_options (group_id, name, price, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, name, price, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Grupo não encontrado' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// PATCH /api/menu/addon-options/:id — editar opção (admin)
router.patch('/addon-options/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const fields = ['name', 'price', 'sort_order', 'active'];
  const updates = [], values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE addon_options SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/menu/addon-options/:id — remover opção (admin)
router.delete('/addon-options/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM addon_options WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
