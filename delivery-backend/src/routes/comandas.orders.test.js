// comandas.js carrega ../db/pool, que cria um client do Supabase na hora do
// require — sem isso o módulo nem carrega, mesmo mockando pool.query depois
// (ver db/pool.js). Não é usado de verdade: pool.query é totalmente
// substituído abaixo, nenhuma chamada de rede acontece.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const comandasRouter = require('./comandas');

// Testes da rota POST /:id/orders no mesmo nível de isolamento usado em
// middleware/idempotency.test.js: sem framework de teste novo, sem Postgres
// real — o pool (../db/pool) é mockado por teste (sql casada por substring).
// A rota é extraída direto do router.stack e rodada com req/res falsos, sem
// subir um servidor HTTP de verdade.

function findRouteHandlers(method, path) {
  const layer = comandasRouter.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`rota ${method.toUpperCase()} ${path} não encontrada`);
  return layer.route.stack.map((s) => s.handle);
}

const ORDERS_HANDLERS = findRouteHandlers('post', '/:id/orders');

// requireIdempotencyKey chama next() sem "return" no caminho de sucesso (igual
// o Express de verdade faz) — então não dá pra esperar a cadeia terminar só
// seguindo o valor de retorno de next(). Espera de verdade é res.json() ser
// chamado por algum handler da cadeia (ver makeRes's `_settled`).
async function runOrdersRoute(req, res) {
  let i = 0;
  const next = (err) => {
    if (err) { console.error('[test] erro não tratado na cadeia:', err); res._resolve(); return; }
    const handler = ORDERS_HANDLERS[i++];
    if (!handler) return;
    Promise.resolve(handler(req, res, next)).catch((e) => {
      console.error('[test] handler rejeitou:', e);
      res._resolve();
    });
  };
  next();
  await res._settled;
}

function makeReq({ headers = {}, body = {}, params = {} } = {}) {
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    headers: lowered,
    body,
    params,
    user: null,
    get(name) { return lowered[String(name).toLowerCase()]; },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; res._resolve(); return res; },
  };
  res._settled = new Promise((resolve) => { res._resolve = resolve; });
  return res;
}

// Nibble de versão/variante (posições 3 e 4 dos grupos) tem que ser válido
// de verdade — z.string().uuid() rejeita um UUID "bonito" tipo todo-1 que não
// respeite RFC 4122 (versão 1-5, variante 8/9/a/b).
const VALID_KEY = '11111111-1111-4111-a111-111111111111';
const COMANDA_ID = '22222222-2222-4222-a222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-a333-333333333333';

// Simula a tabela comanda_orders (o UNIQUE em idempotency_key) + comandas +
// products, o suficiente pra exercitar a rota real sem Postgres. `includes()`
// casa pela ordem em que a rota de fato dispara as queries.
function installPoolMock({ comandaStatus = 'aberta', productAvailable = true, productPrice = 42 } = {}) {
  const comandaOrders = new Map(); // idempotency_key -> row
  let itemInsertCount = 0;
  const comanda = {
    id: COMANDA_ID, code: 'mesa5', label: 'Mesa 5', status: comandaStatus,
    subtotal: 0, total: 0, mesa_id: 'mesa-id-1',
  };

  const originalQuery = pool.query;
  pool.query = async (sql, params = []) => {
    if (sql.includes('FROM comandas WHERE id')) {
      return { rows: [{ ...comanda }] };
    }
    if (sql.includes('INSERT INTO comanda_orders')) {
      const [, idempotencyKey] = params;
      if (comandaOrders.has(idempotencyKey)) {
        const err = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        throw err;
      }
      const id = `order-${comandaOrders.size + 1}`;
      comandaOrders.set(idempotencyKey, { id, status: 'processing', status_code: null, response: null });
      return { rows: [{ id }] };
    }
    if (sql.includes('SELECT status, status_code, response FROM comanda_orders')) {
      const [idempotencyKey] = params;
      const row = comandaOrders.get(idempotencyKey);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("UPDATE comanda_orders SET status = 'done'")) {
      const [statusCode, response, id] = params;
      for (const row of comandaOrders.values()) {
        if (row.id === id) { row.status = 'done'; row.status_code = statusCode; row.response = response; }
      }
      return { rows: [] };
    }
    if (sql.includes('DELETE FROM comanda_orders')) {
      const [id] = params;
      for (const [key, row] of comandaOrders) if (row.id === id) comandaOrders.delete(key);
      return { rows: [] };
    }
    if (sql.includes('FROM products WHERE id')) {
      return {
        rows: [{ id: PRODUCT_ID, name: 'Croissant', price: productPrice, promo_price: null, available: productAvailable, print_target: 'cozinha' }],
      };
    }
    if (sql.includes('INSERT INTO comanda_items')) {
      itemInsertCount++;
      return { rows: [{ id: `item-${itemInsertCount}` }] };
    }
    if (sql.includes('UPDATE comandas SET subtotal')) {
      const [addedTotal] = params;
      comanda.subtotal += addedTotal;
      comanda.total += addedTotal;
      return { rows: [{ ...comanda }] };
    }
    // mesas, comanda_item_addons, stock_movements etc. — não exercitados
    // nestes testes, um fallback vazio é inofensivo (ver stock.js/mesas).
    return { rows: [] };
  };

  return {
    itemInsertCount: () => itemInsertCount,
    restore() { pool.query = originalQuery; },
  };
}

describe('POST /api/comandas/:id/orders — idempotência', () => {
  test('sem header Idempotency-Key: 400, não chega a tocar no banco', async () => {
    const mock = installPoolMock();
    try {
      const req = makeReq({ params: { id: COMANDA_ID }, body: { items: [{ product_id: PRODUCT_ID, quantity: 1 }] } });
      const res = makeRes();
      await runOrdersRoute(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(mock.itemInsertCount(), 0);
    } finally {
      mock.restore();
    }
  });

  test('mesma chave 2×: só lança 1 pedido, a segunda devolve a resposta salva', async () => {
    const mock = installPoolMock();
    try {
      const body = { items: [{ product_id: PRODUCT_ID, quantity: 2 }] };
      const req1 = makeReq({ headers: { 'Idempotency-Key': VALID_KEY }, params: { id: COMANDA_ID }, body });
      const res1 = makeRes();
      await runOrdersRoute(req1, res1);
      assert.equal(res1.statusCode, 201, JSON.stringify(res1.body));
      assert.equal(mock.itemInsertCount(), 1);

      const req2 = makeReq({ headers: { 'Idempotency-Key': VALID_KEY }, params: { id: COMANDA_ID }, body });
      const res2 = makeRes();
      await runOrdersRoute(req2, res2);

      assert.equal(mock.itemInsertCount(), 1, 'segunda chamada não pode inserir item de novo');
      assert.equal(res2.headers['Idempotency-Replayed'], 'true');
      assert.deepEqual(res2.body, res1.body, 'replay precisa devolver a MESMA resposta');
    } finally {
      mock.restore();
    }
  });

  test('preço mandado no body é ignorado — usa sempre o preço do banco', async () => {
    const mock = installPoolMock({ productPrice: 42 });
    try {
      const body = { items: [{ product_id: PRODUCT_ID, quantity: 1, price: 0.01, unit_price: 0.01 }] };
      const req = makeReq({ headers: { 'Idempotency-Key': VALID_KEY }, params: { id: COMANDA_ID }, body });
      const res = makeRes();
      await runOrdersRoute(req, res);

      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.items[0].unit_price, 42, 'preço adulterado no body não pode vencer o preço do banco');
      assert.equal(res.body.order_total, 42);
    } finally {
      mock.restore();
    }
  });

  test('comanda fechada: 409', async () => {
    const mock = installPoolMock({ comandaStatus: 'fechada' });
    try {
      const body = { items: [{ product_id: PRODUCT_ID, quantity: 1 }] };
      const req = makeReq({ headers: { 'Idempotency-Key': VALID_KEY }, params: { id: COMANDA_ID }, body });
      const res = makeRes();
      await runOrdersRoute(req, res);
      assert.equal(res.statusCode, 409);
    } finally {
      mock.restore();
    }
  });

  test('produto indisponível: 422', async () => {
    const mock = installPoolMock({ productAvailable: false });
    try {
      const body = { items: [{ product_id: PRODUCT_ID, quantity: 1 }] };
      const req = makeReq({ headers: { 'Idempotency-Key': VALID_KEY }, params: { id: COMANDA_ID }, body });
      const res = makeRes();
      await runOrdersRoute(req, res);
      assert.equal(res.statusCode, 422);
    } finally {
      mock.restore();
    }
  });
});
