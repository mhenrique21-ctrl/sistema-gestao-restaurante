require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('[seed] Iniciando seed Confraria...');

    // Admin padrão
    const passwordHash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['Administrador', 'admin@confraria.com', passwordHash, 'admin']);

    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['Cozinha', 'cozinha@confraria.com', await bcrypt.hash('cozinha123', 10), 'cozinha']);

    // Categorias Confraria
    const categories = [
      { name: 'Café', description: 'Cafés especiais e bebidas quentes', sort_order: 1 },
      { name: 'Bebidas', description: 'Sucos, refrigerantes e drinks', sort_order: 2 },
      { name: 'Bolos', description: 'Bolos artesanais e fatias', sort_order: 3 },
      { name: 'Salgados', description: 'Salgados assados e fritos', sort_order: 4 },
    ];

    const categoryIds = {};
    for (const cat of categories) {
      const res = await client.query(`
        INSERT INTO categories (name, description, sort_order)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [cat.name, cat.description, cat.sort_order]);

      if (res.rows.length > 0) {
        categoryIds[cat.name] = res.rows[0].id;
      } else {
        const existing = await client.query('SELECT id FROM categories WHERE name = $1', [cat.name]);
        categoryIds[cat.name] = existing.rows[0].id;
      }
    }

    // Produtos por categoria
    const products = [
      // Café
      { cat: 'Café', name: 'Espresso Simples', description: 'Café espresso tradicional 50ml', price: 5.00 },
      { cat: 'Café', name: 'Espresso Duplo', description: 'Café espresso duplo 100ml', price: 8.00 },
      { cat: 'Café', name: 'Cappuccino', description: 'Espresso com leite vaporizado e espuma', price: 12.00 },
      { cat: 'Café', name: 'Latte Macchiato', description: 'Leite com toque de espresso', price: 14.00 },
      { cat: 'Café', name: 'Café com Leite', description: 'Café coado com leite quente', price: 9.00 },
      { cat: 'Café', name: 'Chocolate Quente', description: 'Chocolate belga cremoso', price: 13.00 },

      // Bebidas
      { cat: 'Bebidas', name: 'Suco de Laranja Natural', description: 'Laranja espremida na hora 300ml', price: 10.00 },
      { cat: 'Bebidas', name: 'Limonada Suíça', description: 'Limão, leite condensado e gelo', price: 13.00 },
      { cat: 'Bebidas', name: 'Água Mineral 500ml', description: 'Água mineral sem gás', price: 4.00 },
      { cat: 'Bebidas', name: 'Refrigerante Lata', description: 'Coca-Cola, Guaraná ou Sprite', price: 6.00 },
      { cat: 'Bebidas', name: 'Chá Gelado', description: 'Chá de frutas gelado 400ml', price: 9.00 },

      // Bolos
      { cat: 'Bolos', name: 'Bolo de Chocolate', description: 'Fatia generosa com cobertura de ganache', price: 16.00 },
      { cat: 'Bolos', name: 'Bolo Red Velvet', description: 'Fatia com cream cheese', price: 18.00 },
      { cat: 'Bolos', name: 'Bolo de Cenoura', description: 'Fatia com cobertura de brigadeiro', price: 14.00 },
      { cat: 'Bolos', name: 'Cheesecake de Frutas', description: 'Fatia com calda de frutas vermelhas', price: 20.00 },
      { cat: 'Bolos', name: 'Torta de Limão', description: 'Fatia com merengue', price: 17.00 },

      // Salgados
      { cat: 'Salgados', name: 'Coxinha de Frango', description: 'Coxinha tradicional com catupiry (unidade)', price: 7.00 },
      { cat: 'Salgados', name: 'Pão de Queijo', description: 'Pão de queijo mineiro (unidade)', price: 5.00 },
      { cat: 'Salgados', name: 'Quiche de Frango', description: 'Quiche com recheio de frango e creme', price: 14.00 },
      { cat: 'Salgados', name: 'Mini Croissant', description: 'Croissant de presunto e queijo (unidade)', price: 9.00 },
      { cat: 'Salgados', name: 'Empada de Palmito', description: 'Empada artesanal (unidade)', price: 8.00 },
      { cat: 'Salgados', name: 'Combo Salgados (3un)', description: 'Escolha 3 salgados à sua preferência', price: 19.00 },
    ];

    for (const p of products) {
      await client.query(`
        INSERT INTO products (category_id, name, description, price, sort_order)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [categoryIds[p.cat], p.name, p.description, p.price, 0]);
    }

    // Cliente de exemplo
    await client.query(`
      INSERT INTO customers (name, phone, email, address_street, address_number, address_neighborhood, address_city)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (phone) DO NOTHING
    `, ['João Silva', '11999990001', 'joao@email.com', 'Rua das Flores', '123', 'Centro', 'São Paulo']);

    console.log('[seed] Seed concluído!');
    console.log('  → Admin: admin@confraria.com / admin123');
    console.log('  → Cozinha: cozinha@confraria.com / cozinha123');
  } catch (err) {
    console.error('[seed] Erro:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
