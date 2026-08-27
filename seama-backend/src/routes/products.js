const router = require('express').Router();
const multer = require('multer');
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Arquivo precisa ser uma imagem'));
    cb(null, true);
  },
});

// POST /api/products/upload — envia foto do produto (galeria/câmera do
// tablet) e retorna a URL pública, pra colar em image_url.
router.post('/upload', requireRole('admin', 'gerente'), upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const ext = (req.file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  try {
    const { error } = await pool.supabase.storage
      .from('product-images')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;
    const { data } = pool.supabase.storage.from('product-images').getPublicUrl(path);
    res.status(201).json({ url: data.publicUrl });
  } catch (err) {
    return internalError(res, err, '[products/upload]');
  }
});

// GET /api/products — inclui indisponíveis/inativos; a tela de venda decide
// como exibir (ex: cinza/desabilitado), igual já é feito na Confraria.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, category_id, name, description, image_url, price, code, barcode, active, available,
              sort_order, print_kitchen, track_stock, stock_qty, stock_min
       FROM products ORDER BY sort_order, name`
    );
    res.json(result.rows);
  } catch (err) {
    return internalError(res, err, '[products/GET]');
  }
});

router.post('/', requireRole('admin', 'gerente'), async (req, res) => {
  const { category_id, name, description, image_url, price, code, barcode, sort_order = 0, print_kitchen } = req.body;
  if (!name || !(parseFloat(price) >= 0)) {
    return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
  }
  try {
    // print_kitchen entra como literal (não como $9+) pelo mesmo motivo do
    // PATCH abaixo: o wrapper de pool.js corrompe placeholders acima de $9.
    const kitchenSql = print_kitchen ? 'TRUE' : 'FALSE';
    const result = await pool.query(
      `INSERT INTO products (category_id, name, description, image_url, price, code, barcode, sort_order, print_kitchen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${kitchenSql}) RETURNING *`,
      [category_id || null, name.trim(), description || null, image_url || null, parseFloat(price), code || null, barcode || null, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[products/POST]');
  }
});

router.patch('/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { category_id, name, description, image_url, price, code, barcode, sort_order,
          active, available, print_kitchen, track_stock, stock_min } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;
  if (category_id !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category_id); }
  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
  if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
  if (image_url !== undefined) { updates.push(`image_url = $${idx++}`); values.push(image_url); }
  if (price !== undefined) { updates.push(`price = $${idx++}`); values.push(parseFloat(price)); }
  if (code !== undefined) { updates.push(`code = $${idx++}`); values.push(code); }
  if (barcode !== undefined) { updates.push(`barcode = $${idx++}`); values.push(barcode); }
  if (sort_order !== undefined) { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }
  // active/available ficam de fora da lista parametrizada (mesmo padrão já
  // usado no delivery-backend da Confraria) pra nunca passar de $9 parâmetros
  // reais — acima disso o wrapper de pool.js corrompe $10+ por substituição
  // de string sem âncora.
  if (active !== undefined) { updates.push(`active = ${active ? 'TRUE' : 'FALSE'}`); }
  if (available !== undefined) { updates.push(`available = ${available ? 'TRUE' : 'FALSE'}`); }
  if (print_kitchen !== undefined) { updates.push(`print_kitchen = ${print_kitchen ? 'TRUE' : 'FALSE'}`); }
  if (track_stock !== undefined) { updates.push(`track_stock = ${track_stock ? 'TRUE' : 'FALSE'}`); }
  // Saldo e mínimo entram como número literal (validado acima), não como $N —
  // o wrapper de pool.js corrompe placeholders a partir de $10.
  if (stock_min !== undefined) {
    const n = parseFloat(stock_min);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Estoque mínimo inválido' });
    updates.push(`stock_min = ${n}`);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo pra atualizar' });
  values.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    return internalError(res, err, '[products/PATCH]');
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM products WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ deleted: true });
  } catch (err) {
    // Produto com venda registrada não pode ser apagado (sale_items referencia
    // o id) — sem isso o erro chegava como "Erro interno" genérico, sem dizer
    // o que fazer. Mesmo tratamento que o delivery-backend da Confraria já tem.
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Este produto já tem vendas registradas e não pode ser excluído. Desative-o em vez disso.' });
    }
    return internalError(res, err, '[products/DELETE]');
  }
});

module.exports = router;
