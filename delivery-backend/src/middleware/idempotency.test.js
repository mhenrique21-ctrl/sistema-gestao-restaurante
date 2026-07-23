const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { idempotent } = require('./idempotency');

// Análise do código sob teste (idempotency.js):
// - Input: req (com headers, method, originalUrl), res (Express-like), next.
// - Efeito colateral: guarda a resposta de sucesso da PRIMEIRA chamada com uma
//   dada Idempotency-Key num Map em memória (module-level, singleton).
// - Output: se a mesma chave (mesmo método+path) chegar de novo, devolve a
//   resposta salva sem chamar next() de novo — o handler real da rota nunca
//   roda a segunda vez, evitando duplicar o efeito colateral (pedido/cobrança).
// - Sem chave no header: vira passthrough total (sem proteção, sem cache).
// - Resposta de erro (status >= 400) nunca é cacheada, pra não travar um
//   retry legítimo depois de uma falha.
//
// Cada teste usa um path (req.originalUrl) diferente pra não colidir com o
// Map compartilhado entre os testes (é module-level, singleton de propósito).

function makeReq({ key, method = 'POST', url } = {}) {
  return {
    method,
    originalUrl: url,
    headers: key ? { 'idempotency-key': key } : {},
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

describe('idempotent middleware', () => {
  test('sem header Idempotency-Key: passa direto (next chamado, sem proteção)', () => {
    const req = makeReq({ url: '/no-key-test' });
    const res = makeRes();
    let nextCalled = 0;
    idempotent(req, res, () => { nextCalled++; res.status(201).json({ ok: true }); });
    assert.equal(nextCalled, 1);

    // Chamar de novo, idêntico, sem chave — deve executar de novo também
    // (não há nada pra reaproveitar sem chave).
    idempotent(req, res, () => { nextCalled++; });
    assert.equal(nextCalled, 2);
  });

  test('primeira chamada com uma chave nova: executa o handler normalmente', () => {
    const req = makeReq({ key: 'abc-1', url: '/orders/guest-test-1' });
    const res = makeRes();
    let handlerCalls = 0;
    idempotent(req, res, () => { handlerCalls++; res.status(201).json({ id: 1 }); });
    assert.equal(handlerCalls, 1);
    assert.deepEqual(res.body, { id: 1 });
  });

  test('segunda chamada com a MESMA chave: devolve a resposta cacheada sem executar o handler de novo', () => {
    const url = '/orders/guest-test-2';
    const key = 'abc-2';
    let handlerCalls = 0;
    const handler = (res) => { handlerCalls++; res.status(201).json({ id: 42, created: true }); };

    const req1 = makeReq({ key, url });
    const res1 = makeRes();
    idempotent(req1, res1, () => handler(res1));
    assert.equal(handlerCalls, 1);

    const req2 = makeReq({ key, url });
    const res2 = makeRes();
    idempotent(req2, res2, () => handler(res2)); // não deveria nem chegar a rodar

    assert.equal(handlerCalls, 1, 'handler não pode rodar de novo com a mesma chave — evita pedido/cobrança duplicado');
    assert.deepEqual(res2.body, { id: 42, created: true }, 'resposta replay deve ser idêntica à original');
    assert.equal(res2.statusCode, 201);
    assert.equal(res2.headers['Idempotency-Replayed'], 'true', 'precisa sinalizar que essa resposta foi reaproveitada');
  });

  test('chave diferente: executa o handler de novo normalmente', () => {
    const url = '/orders/guest-test-3';
    let handlerCalls = 0;
    const handler = (res) => { handlerCalls++; res.status(201).json({ call: handlerCalls }); };

    const res1 = makeRes();
    idempotent(makeReq({ key: 'key-a', url }), res1, () => handler(res1));
    const res2 = makeRes();
    idempotent(makeReq({ key: 'key-b', url }), res2, () => handler(res2));

    assert.equal(handlerCalls, 2);
    assert.deepEqual(res1.body, { call: 1 });
    assert.deepEqual(res2.body, { call: 2 });
  });

  test('resposta de erro (status >= 400) não é cacheada — permite nova tentativa com a mesma chave', () => {
    const url = '/orders/guest-test-4';
    const key = 'retry-after-error';
    let handlerCalls = 0;

    const req1 = makeReq({ key, url });
    const res1 = makeRes();
    idempotent(req1, res1, () => { handlerCalls++; res1.status(400).json({ error: 'Forma de pagamento indisponível' }); });
    assert.equal(handlerCalls, 1);

    // Cliente corrige o problema e tenta de novo com a MESMA chave — precisa
    // rodar o handler de verdade dessa vez, não replay do erro anterior.
    const req2 = makeReq({ key, url });
    const res2 = makeRes();
    idempotent(req2, res2, () => { handlerCalls++; res2.status(201).json({ id: 99 }); });

    assert.equal(handlerCalls, 2, 'erro anterior não pode bloquear um retry legítimo');
    assert.equal(res2.statusCode, 201);
    assert.deepEqual(res2.body, { id: 99 });
  });

  test('mesma chave em rotas (paths) diferentes não colide — cache é por método+path+chave', () => {
    const key = 'shared-key';
    let handlerCalls = 0;

    const resA = makeRes();
    idempotent(makeReq({ key, url: '/orders/guest-test-5a' }), resA, () => { handlerCalls++; resA.status(201).json({ from: 'A' }); });
    const resB = makeRes();
    idempotent(makeReq({ key, url: '/orders/guest-test-5b' }), resB, () => { handlerCalls++; resB.status(201).json({ from: 'B' }); });

    assert.equal(handlerCalls, 2, 'paths diferentes com a mesma chave devem ser tratados como pedidos distintos');
  });
});
