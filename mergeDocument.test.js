import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeArrayById, mergeDocument } from './mergeDocument.js';

function conta(id, overrides = {}) {
  return { id, descricao: `Conta ${id}`, valor: 100, status: 'pendente', vencimento: '2026-07-20', ...overrides };
}

describe('mergeArrayById', () => {
  test('item só no existing é preservado', () => {
    const result = mergeArrayById([conta('a')], [], new Set());
    assert.deepEqual(result.map((c) => c.id), ['a']);
  });

  test('item só no incoming (recém-criado) é preservado', () => {
    const result = mergeArrayById([], [conta('b')], new Set());
    assert.deepEqual(result.map((c) => c.id), ['b']);
  });

  test('item nos dois lados: vence quem tem atualizadoEm mais recente', () => {
    const existing = [conta('a', { status: 'pago', atualizadoEm: '2026-07-20T10:00:00.000Z' })];
    const incoming = [conta('a', { status: 'pendente', atualizadoEm: '2026-07-20T09:00:00.000Z' })];
    const result = mergeArrayById(existing, incoming, new Set());
    assert.equal(result[0].status, 'pago', 'existing tinha atualizadoEm maior, devia vencer');
  });

  test('mistura updatedAt (número) e atualizadoEm (ISO string) — compara corretamente', () => {
    const existing = [conta('a', { status: 'pago', updatedAt: Date.parse('2026-07-20T10:00:00.000Z') })];
    const incoming = [conta('a', { status: 'pendente', atualizadoEm: '2026-07-20T09:00:00.000Z' })];
    const result = mergeArrayById(existing, incoming, new Set());
    assert.equal(result[0].status, 'pago');
  });

  test('sem timestamp em nenhum dos dois lados: incoming vence (comportamento anterior, sem regressão)', () => {
    const existing = [conta('a', { status: 'pago' })];
    const incoming = [conta('a', { status: 'pendente' })];
    const result = mergeArrayById(existing, incoming, new Set());
    assert.equal(result[0].status, 'pendente');
  });

  test('id em deletedIds nunca reaparece, mesmo com timestamp mais recente', () => {
    const existing = [];
    const incoming = [conta('a', { atualizadoEm: new Date().toISOString() })];
    const result = mergeArrayById(existing, incoming, new Set(['a']));
    assert.equal(result.length, 0);
  });

  test('regressão: marcar conta como paga em dois dispositivos concorrentes não se perde', () => {
    // Cenário real relatado: usuário marca conta A como paga; ao mesmo tempo
    // (ou pouco depois), outro POST baseado num snapshot mais antigo chega —
    // a marcação não pode "voltar".
    const base = [conta('a'), conta('b')];
    const deviceA = [conta('a', { status: 'pago', atualizadoEm: '2026-07-20T10:00:00.000Z' }), conta('b')];
    // deviceB nem sabe da mudança de A — seu snapshot ainda tem "a" pendente,
    // sem atualizadoEm (ex: POST de auto-save disparado por outra tela).
    const deviceB = [conta('a'), conta('b', { atualizadoEm: '2026-07-20T10:00:01.000Z' })];

    const afterA = mergeArrayById(base, deviceA, new Set());
    const afterBoth = mergeArrayById(afterA, deviceB, new Set());

    const a = afterBoth.find((c) => c.id === 'a');
    assert.equal(a.status, 'pago', 'marcação de pago não pode se perder — a tinha atualizadoEm, b (pra esse item) não');
  });
});

describe('mergeDocument', () => {
  test('sem estado existente, devolve incoming sem alterar', () => {
    const incoming = { contas: [conta('a')] };
    const result = mergeDocument(null, incoming);
    assert.equal(result, incoming);
  });

  test('funde contas por id, preservando o que só existe em cada lado', () => {
    const existing = { contas: [conta('a')], deletedIds: [] };
    const incoming = { contas: [conta('b')], deletedIds: [] };
    const result = mergeDocument(existing, incoming);
    assert.deepEqual(result.contas.map((c) => c.id).sort(), ['a', 'b']);
  });

  test('deletedIds é a união dos dois lados e some qualquer entidade correspondente', () => {
    const existing = { contas: [conta('a')], vendas: [{ id: 'v1' }], deletedIds: ['a'] };
    const incoming = { contas: [conta('a', { atualizadoEm: new Date().toISOString() })], vendas: [{ id: 'v1' }], deletedIds: [] };
    const result = mergeDocument(existing, incoming);
    assert.equal(result.contas.length, 0, 'conta excluída não pode reaparecer mesmo com atualizadoEm novo');
    assert.deepEqual(result.deletedIds, ['a']);
  });

  test('campos não listados em MERGEABLE_FIELDS (ex: config) vêm direto do incoming', () => {
    const existing = { config: { snAliquota: 6 } };
    const incoming = { config: { snAliquota: 8 } };
    const result = mergeDocument(existing, incoming);
    assert.deepEqual(result.config, { snAliquota: 8 });
  });

  test('listaCompras continua sendo resolvido pela lógica própria (mergeListaCompras), não pela genérica', () => {
    const existing = { listaAtualId: 'nova', listaAtualAbertaEm: '2026-01-02T00:00:00.000Z', listaCompras: [] };
    const incoming = { listaAtualId: 'antiga', listaAtualAbertaEm: '2026-01-01T00:00:00.000Z', listaCompras: [{ id: 'x', updatedAt: 1 }] };
    const result = mergeDocument(existing, incoming);
    assert.equal(result.listaAtualId, 'nova', 'identidade da lista mais recente devia vencer, como testado em mergeListaCompras.test.js');
  });

  test('regressão completa: conta marcada como paga sobrevive a um POST concorrente baseado em snapshot antigo', () => {
    const base = { contas: [conta('a'), conta('b')], deletedIds: [] };
    const payloadMarcarPaga = { ...base, contas: [conta('a', { status: 'pago', atualizadoEm: '2026-07-20T10:00:00.000Z' }), conta('b')] };
    // Outro dispositivo, no mesmo instante, salva uma edição em "b" sem saber
    // que "a" acabou de ser marcada como paga em outro lugar.
    const payloadConcorrente = { ...base, contas: [conta('a'), conta('b', { valor: 200, atualizadoEm: '2026-07-20T10:00:01.000Z' })] };

    const afterPagar = mergeDocument(base, payloadMarcarPaga);
    const final = mergeDocument(afterPagar, payloadConcorrente);

    const a = final.contas.find((c) => c.id === 'a');
    const b = final.contas.find((c) => c.id === 'b');
    assert.equal(a.status, 'pago', 'conta marcada como paga não pode voltar a pendente');
    assert.equal(b.valor, 200, 'edição concorrente em outro registro também não pode se perder');
  });
});
