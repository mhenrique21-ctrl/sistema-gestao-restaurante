const router = require('express').Router();
const pool = require('../db/pool');

// Cria tabela customer_addresses se não existir (executado uma vez)
pool.query(`
  CREATE TABLE IF NOT EXISTS customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label TEXT,
    street TEXT NOT NULL,
    number TEXT,
    neighborhood TEXT,
    complement TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(err => console.error('[delivery] migration customer_addresses:', err.message));

// GET /api/delivery/lookup?phone=11999999999
// Busca cliente pelo telefone e retorna seus endereços salvos (sem auth)
router.get('/lookup', async (req, res) => {
  const phone = (req.query.phone || '').replace(/\D/g, '');
  if (phone.length < 8) return res.json(null);
  try {
    const r = await pool.query(
      `SELECT id, name, phone, address_street, address_number, address_neighborhood, address_complement
       FROM customers WHERE replace(replace(replace(phone,'-',''),'(',''),')','') ILIKE $1 AND active = true LIMIT 1`,
      [`%${phone}%`]
    );
    if (!r.rows[0]) return res.json(null);
    const customer = r.rows[0];

    // Busca endereços salvos
    const addr = await pool.query(
      `SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customer.id]
    );

    // Se customer tem endereço no cadastro e não está na lista, inclui
    const addresses = addr.rows;
    if (customer.address_street && !addresses.some(a => a.street === customer.address_street)) {
      addresses.push({
        id: 'main',
        label: 'Endereço principal',
        street: customer.address_street,
        number: customer.address_number,
        neighborhood: customer.address_neighborhood,
        complement: customer.address_complement,
      });
    }

    res.json({ customer, addresses });
  } catch (err) {
    console.error('[delivery/lookup]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/delivery/save-address
// Salva endereço para um cliente após pedido confirmado
router.post('/save-address', async (req, res) => {
  const { customer_id, street, number, neighborhood, complement, label } = req.body;
  if (!customer_id || !street) return res.status(400).json({ error: 'Dados incompletos' });
  try {
    // Evita duplicata
    const existing = await pool.query(
      `SELECT id FROM customer_addresses WHERE customer_id = $1 AND street = $2 AND COALESCE(number,'') = COALESCE($3,'') AND COALESCE(neighborhood,'') = COALESCE($4,'')`,
      [customer_id, street, number || '', neighborhood || '']
    );
    if (existing.rows[0]) return res.json({ saved: false, address: existing.rows[0] });

    const r = await pool.query(
      `INSERT INTO customer_addresses (customer_id, label, street, number, neighborhood, complement)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [customer_id, label || null, street, number || null, neighborhood || null, complement || null]
    );
    res.json({ saved: true, address: r.rows[0] });
  } catch (err) {
    console.error('[delivery/save-address]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
