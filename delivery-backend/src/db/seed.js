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
      RETURNING id
    `, ['Administrador', 'admin@confraria.com', passwordHash, 'admin']);

    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
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
        RETURNING id
      `, [categoryIds[p.cat], p.name, p.description, p.price, 0]);
    }

    // Cliente de exemplo
    await client.query(`
      INSERT INTO customers (name, phone, email, address_street, address_number, address_neighborhood, address_city)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (phone) DO NOTHING
      RETURNING id
    `, ['João Silva', '11999990001', 'joao@email.com', 'Rua das Flores', '123', 'Centro', 'São Paulo']);

    // Bairros e taxas de entrega
    const neighborhoods = [
      ['CENTRAL', 'Santa Rita', 7], ['CENTRAL', 'Central', 6], ['CENTRAL', 'Trem', 7],
      ['CENTRAL', 'Jesus de Nazaré', 8], ['CENTRAL', 'Perpétuo Socorro', 8],
      ['OESTE', 'Alvorada', 10], ['OESTE', 'Nova Esperança', 9], ['OESTE', 'Cabralzinho', 15],
      ['OESTE', 'Irmãos Platon', 17], ['OESTE', 'Goiabal', 17], ['OESTE', 'Marabaixo 1 e 2', 17],
      ['OESTE', 'Parque Novo Mundo', 20], ['OESTE', 'Parque das Nações', 20],
      ['OESTE', 'Resd. Jardim América', 22], ['OESTE', 'Resd. Jardim Europa', 22],
      ['OESTE', 'Resd. Cidade Jardim', 22], ['OESTE', 'Resd. Amazonas', 24],
      ['ZONA SUL', 'Buritizal', 10], ['ZONA SUL', 'Novo Buritizal', 11], ['ZONA SUL', 'Muca', 10],
      ['ZONA SUL', 'Beirol', 8], ['ZONA SUL', 'Santa Inês', 8], ['ZONA SUL', 'Araxá', 9],
      ['ZONA SUL', 'Congós', 12], ['ZONA SUL', 'Pedrinhas', 12], ['ZONA SUL', 'Jardim Equatorial', 10],
      ['ZONA SUL', 'Jardim Marco Zero', 12], ['ZONA SUL', 'Universidade', 16], ['ZONA SUL', 'Zerão', 16],
      ['ZONA SUL', 'Cond. Parque Felicitá', 17], ['ZONA SUL', 'Cond. Portal do Sol', 19],
      ['ZONA SUL', 'Cond. Manari', 19], ['ZONA SUL', 'Cond. Arboretto', 19],
      ['ZONA SUL', 'Cond. Villa Tropical', 19], ['ZONA SUL', 'Chefe Clodoaldo', 19],
      ['ZONA SUL', 'Cond. Verana', 20], ['ZONA SUL', 'Fazendinha', 23],
      ['ZONA NORTE', 'Cidade Nova', 10], ['ZONA NORTE', 'Julião Ramos', 7], ['ZONA NORTE', 'Laguinho', 8],
      ['ZONA NORTE', 'Pacoval', 10], ['ZONA NORTE', 'São Lázaro', 12], ['ZONA NORTE', 'Pantanal', 14],
      ['ZONA NORTE', 'Renascer', 12], ['ZONA NORTE', 'Vit. do Renascer', 12], ['ZONA NORTE', 'Infraero 1', 13],
      ['ZONA NORTE', 'Infraero 2', 18], ['ZONA NORTE', 'Sol Nascente', 20], ['ZONA NORTE', 'Ipê', 20],
      ['ZONA NORTE', 'Açaí', 18], ['ZONA NORTE', 'Boné Azul', 17], ['ZONA NORTE', 'Novo Horizonte', 19],
      ['ZONA NORTE', 'Jardim Felidade', 16], ['ZONA NORTE', 'Jardim Felidade 2', 18],
      ['ZONA NORTE', 'Brasil Novo', 20], ['ZONA NORTE', 'Cond. Terra Nova', 23], ['ZONA NORTE', 'Macapaba', 20],
      ['ZONA NORTE', 'Morada das Palmeiras', 18], ['ZONA NORTE', 'Resid. Bella Vista', 23],
      ['ZONA NORTE', 'Amazonas', 25], ['ZONA NORTE', 'Resid. Bouganville', 12],
    ];
    for (let i = 0; i < neighborhoods.length; i++) {
      const [zone, name, fee] = neighborhoods[i];
      await client.query(
        `INSERT INTO neighborhoods (zone, name, delivery_fee, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING RETURNING id`,
        [zone, name, fee, i + 1]
      );
    }

    // Configurações padrão da loja
    await client.query(`
      INSERT INTO settings (key, value) VALUES
        ('store_whatsapp_number', ''),
        ('pix_key', 'confrariacafe@pix.com'),
        ('store_name', 'Confraria Café')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);

    // Produtos em destaque e promoção (exemplo)
    await client.query(`
      UPDATE products SET featured = true
      WHERE name IN ('Cappuccino', 'Cheesecake de Frutas', 'Combo Salgados (3un)')
      RETURNING id
    `);
    await client.query(`
      UPDATE products SET promo_price = 9.90, promo_label = 'OFERTA' WHERE name = 'Cappuccino'
      RETURNING id
    `);

    // Adicionais de exemplo (Cappuccino e Coxinha de Frango)
    async function addonGroup(productName, groupName, { minSelect = 0, maxSelect = 1, required = false, sortOrder = 1 }, options) {
      const prod = await client.query('SELECT id FROM products WHERE name = $1', [productName]);
      if (!prod.rows[0]) return;
      const group = await client.query(
        `INSERT INTO addon_groups (product_id, name, min_select, max_select, required, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [prod.rows[0].id, groupName, minSelect, maxSelect, required, sortOrder]
      );
      for (let i = 0; i < options.length; i++) {
        const [name, price] = options[i];
        await client.query(
          `INSERT INTO addon_options (group_id, name, price, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
          [group.rows[0].id, name, price, i + 1]
        );
      }
    }

    const existingGroups = await client.query('SELECT count(*) FROM addon_groups');
    if (parseInt(existingGroups.rows[0].count) === 0) {
      await addonGroup('Cappuccino', 'Ponto do açúcar', { minSelect: 1, maxSelect: 1, required: true, sortOrder: 1 }, [
        ['Sem açúcar', 0], ['Pouco açúcar', 0], ['Açúcar normal', 0], ['Extra açúcar', 0],
      ]);
      await addonGroup('Cappuccino', 'Tipo de leite', { minSelect: 0, maxSelect: 1, required: false, sortOrder: 2 }, [
        ['Leite integral', 0], ['Leite desnatado', 0], ['Leite vegetal (aveia/amêndoas)', 4],
      ]);
      await addonGroup('Coxinha de Frango', 'Adicionais', { minSelect: 0, maxSelect: 3, required: false, sortOrder: 1 }, [
        ['Catupiry extra', 3], ['Bacon', 4], ['Molho especial', 2],
      ]);
    }

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
