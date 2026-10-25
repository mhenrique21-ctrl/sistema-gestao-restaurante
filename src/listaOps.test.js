// Gravação da Lista item a item: a operação aplicada no servidor tem que
// seguir a MESMA regra da fusão, senão o POST seguinte de qualquer aparelho
// desfaz o que ela gravou. Ver src/listaOps.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarOpsLista, podarTombstones, lixeiraValida, idDaLixeira, MAX_TOMBSTONES, LIXEIRA_DIAS,
} from './listaOps.js';
import { mergeListaCompras } from '../mergeListaCompras.js';
import { mergeDocument } from '../mergeDocument.js';

const item = (id, extra = {}) => ({ id, listaId: 'L1', nome: 'Item ' + id, quantidade: 1, unidade: 'un',
  comprado: false, updatedAt: 1000, criadoEm: '2026-10-25T10:00:00.000Z', ...extra });
const doc = (extra = {}) => ({ listaCompras: [], listaDeletedIds: [], deletedIds: [], vendas: [{ id: 'v1' }], ...extra });

test('add insere, e o resto do documento fica intacto', () => {
  const r = aplicarOpsLista(doc(), [{ tipo: 'add', item: item('a') }]);
  assert.equal(r.mudou, true);
  assert.deepEqual(r.doc.listaCompras.map((i) => i.id), ['a']);
  assert.deepEqual(r.doc.vendas, [{ id: 'v1' }], 'a operação da Lista mexeu em outro campo');
  assert.equal(r.resultados[0].status, 'ok');
});

test('reenviar a MESMA operação é inócuo (a fila reenvia depois de uma queda)', () => {
  const ops = [{ tipo: 'add', item: item('a') }];
  const r1 = aplicarOpsLista(doc(), ops);
  const r2 = aplicarOpsLista(r1.doc, ops);
  assert.equal(r2.doc.listaCompras.length, 1);
});

test('dois aparelhos lançando 20 itens cada ao mesmo tempo: os 40 ficam', () => {
  const a = Array.from({ length: 20 }, (_, k) => ({ tipo: 'add', item: item('a' + k) }));
  const b = Array.from({ length: 20 }, (_, k) => ({ tipo: 'add', item: item('b' + k) }));
  let d = doc();
  for (let k = 0; k < 20; k++) {   // intercalados, como chegariam
    d = aplicarOpsLista(d, [a[k]]).doc;
    d = aplicarOpsLista(d, [b[k]]).doc;
  }
  assert.equal(d.listaCompras.length, 40);
});

test('update/marcar: carimbo maior vence, empate é da operação', () => {
  const base = doc({ listaCompras: [item('a', { updatedAt: 2000 })] });
  const velho = aplicarOpsLista(base, [{ tipo: 'update', id: 'a', campos: { quantidade: 9 }, em: 1500 }]);
  assert.equal(velho.resultados[0].status, 'antigo');
  assert.equal(velho.doc.listaCompras[0].quantidade, 1);
  const empate = aplicarOpsLista(base, [{ tipo: 'marcar', id: 'a', campos: { comprado: true }, em: 2000 }]);
  assert.equal(empate.doc.listaCompras[0].comprado, true);
  const novo = aplicarOpsLista(base, [{ tipo: 'update', id: 'a', campos: { quantidade: 3, id: 'X', updatedAt: 1 }, em: 3000 }]);
  assert.equal(novo.doc.listaCompras[0].quantidade, 3);
  assert.equal(novo.doc.listaCompras[0].id, 'a', 'a operação conseguiu trocar o id do item');
  assert.equal(novo.doc.listaCompras[0].updatedAt, 3000, 'o carimbo não é o da operação');
});

test('update de item que ainda não chegou não cria nada', () => {
  const r = aplicarOpsLista(doc(), [{ tipo: 'update', id: 'z', campos: { quantidade: 2 } }]);
  assert.equal(r.resultados[0].status, 'ausente');
  assert.equal(r.doc.listaCompras.length, 0);
});

test('remove: sai da lista, entra no tombstone e na LIXEIRA', () => {
  const r = aplicarOpsLista(doc({ listaCompras: [item('a')] }),
    [{ tipo: 'remove', id: 'a', por: 'Lopes', em: Date.parse('2026-10-25T10:00:00Z') }],
    { agora: Date.parse('2026-10-25T10:00:00Z') });
  assert.equal(r.doc.listaCompras.length, 0);
  assert.ok(r.doc.listaDeletedIds.includes('a'));
  assert.equal(r.doc.listaLixeira.length, 1);
  assert.equal(r.doc.listaLixeira[0].id, idDaLixeira('a'));
  assert.equal(r.doc.listaLixeira[0].item.nome, 'Item a');
  assert.equal(r.doc.listaLixeira[0].excluidoPor, 'Lopes');
});

test('id no tombstone NÃO volta, nem por add (aparelho atrasado)', () => {
  const r = aplicarOpsLista(doc({ listaDeletedIds: ['a'] }), [{ tipo: 'add', item: item('a', { updatedAt: 9e12 }) }]);
  assert.equal(r.resultados[0].status, 'excluido');
  assert.equal(r.doc.listaCompras.length, 0);
});

test('restaurar = add com id NOVO + descartar a entrada da lixeira', () => {
  const r1 = aplicarOpsLista(doc({ listaCompras: [item('a')] }), [{ tipo: 'remove', id: 'a' }]);
  const r2 = aplicarOpsLista(r1.doc, [
    { tipo: 'add', item: item('a2', { restauradoDe: 'a' }) },
    { tipo: 'descartar', id: idDaLixeira('a') },
  ]);
  assert.deepEqual(r2.doc.listaCompras.map((i) => i.id), ['a2']);
  assert.equal(r2.doc.listaLixeira.length, 0);
  assert.ok(r2.doc.deletedIds.includes(idDaLixeira('a')), 'a entrada descartada voltaria de um aparelho atrasado');
  // E o POST do documento de um aparelho que ainda tem a entrada não a ressuscita.
  const atrasado = { ...r1.doc };
  const m = mergeDocument(r2.doc, atrasado);
  assert.equal((m.listaLixeira || []).length, 0);
});

test('a lixeira guarda 30 dias, não mais', () => {
  const agora = Date.parse('2026-10-25T12:00:00Z');
  const dia = 24 * 3600 * 1000;
  const lx = [
    { id: 'lx-a', item: {}, excluidoEm: new Date(agora - (LIXEIRA_DIAS - 1) * dia).toISOString() },
    { id: 'lx-b', item: {}, excluidoEm: new Date(agora - (LIXEIRA_DIAS + 1) * dia).toISOString() },
  ];
  assert.deepEqual(lixeiraValida(lx, agora).map((e) => e.id), ['lx-a']);
});

test('operação inválida não grava nada', () => {
  const r = aplicarOpsLista(doc(), [{ tipo: 'apagarTudo', id: 'x' }, { tipo: 'add', item: { id: 'y' } }]);
  assert.equal(r.mudou, false);
  assert.deepEqual(r.resultados.map((x) => x.status), ['invalida', 'invalida']);
});

test('o POST do documento de um aparelho atrasado NÃO desfaz a operação', () => {
  // O aparelho B baixou o documento antes da operação de A e posta depois.
  const antes = doc({ listaCompras: [item('a', { updatedAt: 1000 })] });
  const depoisDaOp = aplicarOpsLista(antes, [
    { tipo: 'add', item: item('novo', { updatedAt: 5000 }) },
    { tipo: 'marcar', id: 'a', campos: { comprado: true }, em: 5000 },
  ]).doc;
  const m = mergeListaCompras(depoisDaOp, antes);
  assert.ok(m.listaCompras.some((i) => i.id === 'novo'), 'o item lançado pela operação sumiu');
  assert.equal(m.listaCompras.find((i) => i.id === 'a').comprado, true, 'a marcação foi revertida');
});

test('arquivar 6000 itens não ressuscita nenhum', () => {
  // Bug real: `listaDeletedIds` estava em 5000 = o teto. Arquivar 6000 itens
  // empurrava 1000 tombstones para fora, e o aparelho atrasado — que ainda
  // tinha esses itens — os devolvia no POST seguinte.
  const antigos = Array.from({ length: 5000 }, (_, k) => 'velho' + k);
  const itens = Array.from({ length: 6000 }, (_, k) => item('arq' + k));
  const servidor = { listaCompras: [], listaDeletedIds: [...antigos, ...itens.map((i) => i.id)] };
  const atrasado = { listaCompras: itens, listaDeletedIds: antigos };
  const m = mergeListaCompras(servidor, atrasado);
  assert.equal(m.listaCompras.length, 0, `${m.listaCompras.length} item(ns) ressuscitado(s)`);
  // E de novo, contra o tombstone que foi GRAVADO (o que o próximo POST vê).
  const m2 = mergeListaCompras(m, atrasado);
  assert.equal(m2.listaCompras.length, 0);
});

test('podarTombstones: sem saber quem está vivo, não poda; sabendo, poupa os vivos', () => {
  const ids = Array.from({ length: MAX_TOMBSTONES + 5 }, (_, k) => 'i' + k);
  assert.equal(podarTombstones(ids).length, MAX_TOMBSTONES + 5);
  const vivos = new Set(['i0', 'i3']);
  const p = podarTombstones(ids, { vivos });
  assert.ok(p.length <= MAX_TOMBSTONES);
  assert.ok(p.includes('i0') && p.includes('i3'), 'podou id que ainda está num backup');
  assert.ok(!p.includes('i1'), 'não começou pelos mais antigos');
  assert.deepEqual(podarTombstones(['a', 'a', 'b']), ['a', 'b']);
});
