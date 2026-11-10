import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { enviarPedido, ApiError } from './api.js';

// enviarPedido (api.js): AbortController com timeout de 8s + até 3 retries
// (0.5s/1s/2s), sempre com a MESMA Idempotency-Key -- só retenta falha de
// REDE (fetch rejeitando), nunca uma resposta HTTP real (ApiError). Os
// delays aqui são os de verdade (sem mock de timer): ~1.5s/~3.5s por teste,
// aceitável pra uma suíte pequena sem precisar simular o relógio.

function jsonResponse(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

describe('enviarPedido', () => {
  test('falha de rede nas duas primeiras tentativas, sucesso na terceira — mesma Idempotency-Key sempre', async () => {
    const chamadas = [];
    let i = 0;
    globalThis.fetch = async (url, opts) => {
      chamadas.push({ url, key: opts.headers['Idempotency-Key'] });
      i++;
      if (i < 3) throw new TypeError('fetch failed');
      return jsonResponse(201, { id: 'comanda-1', order_total: 42 });
    };

    const resultado = await enviarPedido('comanda-1', [{ product_id: 'p1', qty: 1 }], '07', 'chave-fixa-123');

    assert.equal(chamadas.length, 3, 'deveria ter tentado 3 vezes (2 falhas + 1 sucesso)');
    assert.ok(chamadas.every((c) => c.key === 'chave-fixa-123'), 'toda tentativa precisa usar a MESMA Idempotency-Key');
    assert.deepEqual(resultado, { id: 'comanda-1', order_total: 42 });
  });

  test('falha de rede em todas as tentativas (inicial + 3 retries): estoura o erro, sem tentativa extra', async () => {
    let chamadas = 0;
    globalThis.fetch = async () => { chamadas++; throw new TypeError('fetch failed'); };

    await assert.rejects(
      () => enviarPedido('comanda-1', [{ product_id: 'p1', qty: 1 }], '07', 'chave-fixa-456'),
      TypeError
    );
    assert.equal(chamadas, 4, 'inicial + 3 retries, nem uma tentativa a mais');
  });

  test('erro HTTP (ApiError) não é reenviado automaticamente — é definitivo', async () => {
    let chamadas = 0;
    globalThis.fetch = async () => { chamadas++; return jsonResponse(409, { error: 'Comanda não está aberta' }); };

    await assert.rejects(
      () => enviarPedido('comanda-1', [{ product_id: 'p1', qty: 1 }], '07', 'chave-fixa-789'),
      ApiError
    );
    assert.equal(chamadas, 1, 'erro 4xx/5xx real do servidor não deve ser retried automaticamente');
  });
});
