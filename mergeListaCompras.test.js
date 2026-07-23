import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeListaCompras } from './mergeListaCompras.js';

// Análise do código sob teste (mergeListaCompras.js):
// - Input: dois documentos JSON (o que está de fato salvo no servidor
//   "existing", e o que o cliente acabou de mandar "incoming").
// - Output: um novo documento, com os campos de listaCompras/listaDeletedIds/
//   listaAtualId/listaAtualAbertaEm/pedidosLista fundidos; todo o resto do
//   documento vem direto de "incoming" sem alteração.
// - Sem efeitos colaterais: função pura, não lê/escreve arquivo nem rede.
// - Existe pra evitar que dois dispositivos escrevendo perto um do outro
//   apaguem silenciosamente a mudança um do outro (ver commit "fix: fusão
//   da Lista de Compras no servidor").

function item(id, overrides = {}) {
  return { id, nome: `Item ${id}`, quantidade: 1, unidade: 'un', categoria: 'outros', comprado: false, naoTem: false, updatedAt: 1000, ...overrides };
}

describe('mergeListaCompras', () => {
  test('sem estado existente (existing null), devolve incoming sem alterar', () => {
    const incoming = { listaCompras: [item('a')], outroCampo: 'x' };
    const result = mergeListaCompras(null, incoming);
    assert.equal(result, incoming);
  });

  test('item que só existe no servidor é preservado no resultado', () => {
    const existing = { listaCompras: [item('a')] };
    const incoming = { listaCompras: [] };
    const result = mergeListaCompras(existing, incoming);
    assert.deepEqual(result.listaCompras.map((i) => i.id), ['a']);
  });

  test('item que só existe no incoming (recém-adicionado) é preservado', () => {
    const existing = { listaCompras: [] };
    const incoming = { listaCompras: [item('b')] };
    const result = mergeListaCompras(existing, incoming);
    assert.deepEqual(result.listaCompras.map((i) => i.id), ['b']);
  });

  test('item em ambos os lados: vence quem tem updatedAt mais recente (servidor mais novo)', () => {
    const existing = { listaCompras: [item('a', { comprado: true, updatedAt: 2000 })] };
    const incoming = { listaCompras: [item('a', { comprado: false, updatedAt: 1000 })] };
    const result = mergeListaCompras(existing, incoming);
    assert.equal(result.listaCompras[0].comprado, true, 'servidor tinha updatedAt maior, devia vencer');
  });

  test('item em ambos os lados: vence quem tem updatedAt mais recente (incoming mais novo)', () => {
    const existing = { listaCompras: [item('a', { naoTem: false, updatedAt: 1000 })] };
    const incoming = { listaCompras: [item('a', { naoTem: true, updatedAt: 2000 })] };
    const result = mergeListaCompras(existing, incoming);
    assert.equal(result.listaCompras[0].naoTem, true, 'incoming tinha updatedAt maior, devia vencer');
  });

  test('regressão: duas mudanças concorrentes em itens DIFERENTES sobrevivem as duas', () => {
    // Cenário real do bug relatado: dois dispositivos, cada um marcando um
    // item diferente, baseados no mesmo snapshot — nenhuma marcação pode
    // se perder.
    const base = { listaCompras: [item('a'), item('b')] };
    const deviceA = { listaCompras: [item('a', { comprado: true, updatedAt: 2000 }), item('b')] };
    const deviceB = { listaCompras: [item('a'), item('b', { naoTem: true, updatedAt: 2001 })] };

    const afterA = mergeListaCompras(base, deviceA);
    const afterBoth = mergeListaCompras(afterA, deviceB);

    const a = afterBoth.listaCompras.find((i) => i.id === 'a');
    const b = afterBoth.listaCompras.find((i) => i.id === 'b');
    assert.equal(a.comprado, true, 'marcação do dispositivo A não pode se perder');
    assert.equal(b.naoTem, true, 'marcação do dispositivo B não pode se perder');
  });

  test('item marcado como excluído (listaDeletedIds) nunca reaparece, mesmo se um lado ainda o inclui', () => {
    const existing = { listaCompras: [item('a')], listaDeletedIds: ['a'] };
    const incoming = { listaCompras: [item('a', { updatedAt: 9999 })], listaDeletedIds: [] };
    const result = mergeListaCompras(existing, incoming);
    assert.equal(result.listaCompras.find((i) => i.id === 'a'), undefined);
  });

  test('listaDeletedIds é a união dos dois lados', () => {
    const existing = { listaDeletedIds: ['x', 'y'] };
    const incoming = { listaDeletedIds: ['y', 'z'] };
    const result = mergeListaCompras(existing, incoming);
    assert.deepEqual([...result.listaDeletedIds].sort(), ['x', 'y', 'z']);
  });

  test('listaDeletedIds é limitado aos últimos 5000', () => {
    const many = Array.from({ length: 6000 }, (_, i) => `id${i}`);
    const existing = { listaDeletedIds: many };
    const incoming = { listaDeletedIds: [] };
    const result = mergeListaCompras(existing, incoming);
    assert.equal(result.listaDeletedIds.length, 5000);
  });

  test('regressão: uma identidade forjada com timestamp "época" (migração de dispositivo desatualizado) nunca pode vencer a lista real', () => {
    // Bug real: um dispositivo com cache local antigo inventava um
    // listaAtualId novo carimbado com `new Date().toISOString()` ("agora") —
    // como isso é sempre "mais recente" que qualquer lista real já aberta,
    // ele vencia a corrida e tornava todos os itens reais órfãos sem
    // ninguém ter fechado a lista de propósito. A correção usa `new Date(0)`
    // (época mínima) pro fallback do dispositivo, que nunca deve vencer.
    const listaReal = {
      listaAtualId: 'lista-real',
      listaAtualAbertaEm: '2026-07-01T00:00:00.000Z', // aberta há semanas, bem antes de "agora"
      listaCompras: [item('a'), item('b')],
    };
    const dispositivoDesatualizado = {
      listaAtualId: 'lista-forjada-por-migracao',
      listaAtualAbertaEm: new Date(0).toISOString(), // época — o fallback correto
      listaCompras: [], // esse dispositivo nem sabe dos itens reais
    };
    const result = mergeListaCompras(listaReal, dispositivoDesatualizado);
    assert.equal(result.listaAtualId, 'lista-real', 'identidade real não pode ser substituída por um fallback de migração');
    // Os itens reais continuam presentes e visíveis (mesmo listaId da lista real)
    const idsPresentes = result.listaCompras.map((i) => i.id);
    assert.ok(idsPresentes.includes('a') && idsPresentes.includes('b'), 'itens reais não podem virar órfãos por causa de uma migração de outro dispositivo');
  });

  test('lista aberta mais recentemente (listaAtualAbertaEm) vence a identidade atual', () => {
    // Simula: admin fechou a lista e abriu uma nova (existing mais recente);
    // um dispositivo atrasado manda incoming com a identidade antiga.
    const existing = { listaAtualId: 'nova', listaAtualAbertaEm: '2026-01-02T00:00:00.000Z' };
    const incoming = { listaAtualId: 'antiga', listaAtualAbertaEm: '2026-01-01T00:00:00.000Z' };
    const result = mergeListaCompras(existing, incoming);
    assert.equal(result.listaAtualId, 'nova');
    assert.equal(result.listaAtualAbertaEm, '2026-01-02T00:00:00.000Z');
  });

  test('quando o incoming tem a lista mais recente, sua identidade vence (fluxo normal)', () => {
    const existing = { listaAtualId: 'antiga', listaAtualAbertaEm: '2026-01-01T00:00:00.000Z' };
    const incoming = { listaAtualId: 'nova', listaAtualAbertaEm: '2026-01-02T00:00:00.000Z' };
    const result = mergeListaCompras(existing, incoming);
    assert.equal(result.listaAtualId, 'nova');
  });

  test('regressão: fechar lista vence um POST atrasado baseado no snapshot antigo', () => {
    const base = { listaAtualId: 'lista-1', listaAtualAbertaEm: '2026-01-01T00:00:00.000Z', listaCompras: [item('a')], pedidosLista: [] };
    const fechamento = {
      listaAtualId: 'lista-2',
      listaAtualAbertaEm: '2026-01-02T00:00:00.000Z',
      listaCompras: [],
      listaDeletedIds: ['a'],
      pedidosLista: [{ id: 'pedido-1', itens: [item('a')] }],
    };
    const operadorAtrasado = { ...base, listaCompras: [item('a', { comprado: true, updatedAt: 5000 })] };

    const afterFechamento = mergeListaCompras(base, fechamento);
    const final = mergeListaCompras(afterFechamento, operadorAtrasado);

    assert.equal(final.listaAtualId, 'lista-2', 'fechamento devia vencer o POST atrasado');
    assert.equal(final.listaCompras.find((i) => i.id === 'a'), undefined, 'item da lista fechada não deve reaparecer');
    assert.equal(final.pedidosLista.length, 1, 'arquivamento não pode se perder');
  });

  test('pedidosLista é união por id — arquivamentos nunca se perdem', () => {
    const existing = { pedidosLista: [{ id: 'p1' }] };
    const incoming = { pedidosLista: [{ id: 'p2' }] };
    const result = mergeListaCompras(existing, incoming);
    assert.deepEqual(result.pedidosLista.map((p) => p.id).sort(), ['p1', 'p2']);
  });

  test('campos fora da Lista de Compras vêm direto do incoming, sem alteração', () => {
    const existing = { vendas: [{ id: 'v1' }] };
    const incoming = { vendas: [{ id: 'v2' }], contas: [{ id: 'c1' }] };
    const result = mergeListaCompras(existing, incoming);
    assert.deepEqual(result.vendas, [{ id: 'v2' }]);
    assert.deepEqual(result.contas, [{ id: 'c1' }]);
  });

  test('edge case: existing sem nenhum campo de lista (documento novo) não lança erro', () => {
    const result = mergeListaCompras({}, { listaCompras: [item('a')] });
    assert.deepEqual(result.listaCompras.map((i) => i.id), ['a']);
    assert.deepEqual(result.listaDeletedIds, []);
    assert.deepEqual(result.pedidosLista, []);
  });

  test('edge case: incoming sem listaCompras (documento só mexendo em outro painel) preserva o que já existia', () => {
    const existing = { listaCompras: [item('a')] };
    const incoming = { vendas: [{ id: 'v1' }] };
    const result = mergeListaCompras(existing, incoming);
    assert.deepEqual(result.listaCompras.map((i) => i.id), ['a']);
  });
});
