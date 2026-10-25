// O dia da Lista vai das 12h às 12h (America/Belem, UTC−3), e às 12h a lista
// aberta vira "Compra de DD/MM" no Arquivo. Ver src/listaCiclo.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diaDaCompra, nomeDaCompra, ultimoCorte, proximoCorte, virarListaNoCorte,
} from './listaCiclo.js';
import { proximaListaId } from './listaId.js';

// Hora de Belém → instante. 24/10 18:30 em Belém é 24/10 21:30 UTC.
const belem = (iso) => Date.parse(iso + '-03:00');

test('o item das 18h30 é da compra do dia SEGUINTE', () => {
  assert.equal(diaDaCompra(belem('2026-10-24T18:30:00')), '2026-10-25');
  assert.equal(nomeDaCompra(diaDaCompra(belem('2026-10-24T18:30:00'))), 'Compra de 25/10');
});

test('antes das 12h é a compra do próprio dia; 12h00 em ponto já é do seguinte', () => {
  assert.equal(diaDaCompra(belem('2026-10-25T09:00:00')), '2026-10-25');
  assert.equal(diaDaCompra(belem('2026-10-25T11:59:59')), '2026-10-25');
  assert.equal(diaDaCompra(belem('2026-10-25T12:00:00')), '2026-10-26');
});

test('o fuso é o de Belém, não o UTC nem o do aparelho', () => {
  // 23h em Belém já é o dia seguinte em UTC — e continua sendo a compra de amanhã, não de depois.
  assert.equal(diaDaCompra('2026-10-25T02:00:00.000Z'), '2026-10-25');   // 24/10 23:00 em Belém
  assert.equal(diaDaCompra('2026-10-25T14:59:00.000Z'), '2026-10-25');   // 25/10 11:59
  assert.equal(diaDaCompra('2026-10-25T15:00:00.000Z'), '2026-10-26');   // 25/10 12:00
});

test('virada de mês e de ano', () => {
  assert.equal(diaDaCompra(belem('2026-10-31T20:00:00')), '2026-11-01');
  assert.equal(diaDaCompra(belem('2026-12-31T13:00:00')), '2027-01-01');
});

test('data ilegível não inventa dia', () => {
  assert.equal(diaDaCompra(''), '');
  assert.equal(diaDaCompra(undefined), '');
});

test('último e próximo corte', () => {
  assert.equal(ultimoCorte(belem('2026-10-25T13:00:00')), belem('2026-10-25T12:00:00'));
  assert.equal(ultimoCorte(belem('2026-10-25T11:00:00')), belem('2026-10-24T12:00:00'));
  assert.equal(ultimoCorte(belem('2026-10-25T12:00:00')), belem('2026-10-25T12:00:00'));
  assert.equal(proximoCorte(belem('2026-10-25T12:00:00')), belem('2026-10-26T12:00:00'));
  assert.equal(proximoCorte(belem('2026-10-25T11:00:00')), belem('2026-10-25T12:00:00'));
});

const docBase = (itens, extra = {}) => ({
  listaAtualId: 'L1', listaAtualAbertaEm: new Date(belem('2026-10-24T12:00:30')).toISOString(),
  listaCompras: itens, pedidosLista: [], listaDeletedIds: [], deletedIds: [], listasCompra: [], ...extra,
});
const it = (id, criado, extra = {}) => ({ id, listaId: 'L1', nome: 'Item ' + id, quantidade: 1, unidade: 'un',
  criadoEm: new Date(belem(criado)).toISOString(), updatedAt: belem(criado), ...extra });

test('às 12h a lista vira "Compra de DD/MM" no Arquivo e abre uma nova', () => {
  const doc = docBase([it('a', '2026-10-24T18:30:00'), it('b', '2026-10-25T08:00:00', { comprado: true })]);
  const agora = belem('2026-10-25T12:00:40');
  const r = virarListaNoCorte(doc, agora);
  assert.ok(r, 'não virou');
  assert.equal(r.pedido.id, 'arq-L1', 'o id do pedido tem que ser o da tela (arq-<listaId>)');
  assert.equal(r.pedido.nome, 'Compra de 25/10');
  assert.equal(r.pedido.data, '2026-10-25');
  assert.equal(r.pedido.automatico, true);
  assert.equal(r.pedido.itens.length, 2);
  assert.equal(r.pedido.itens.find((i) => i.nome === 'Item b').comprado, true);
  assert.equal(r.doc.listaAtualId, proximaListaId('L1'), 'a lista nova tem que nascer de proximaListaId');
  assert.equal(r.doc.listaCompras.length, 0);
  assert.deepEqual([...r.doc.listaDeletedIds].sort(), ['a', 'b'], 'os arquivados saem sem tombstone — voltariam no POST seguinte');
  assert.ok(r.doc.deletedIds.includes('L1'), 'o cadastro da lista sai sem tombstone');
  assert.equal(r.doc.pedidosLista[0].id, 'arq-L1');
});

test('o que foi lançado DEPOIS das 12h passa para a lista nova, não vai para o Arquivo', () => {
  const doc = docBase([it('a', '2026-10-25T08:00:00'), it('depois', '2026-10-25T12:00:10')]);
  const r = virarListaNoCorte(doc, belem('2026-10-25T12:01:00'));
  assert.deepEqual(r.pedido.itens.map((i) => i.nome), ['Item a']);
  const novo = r.doc.listaCompras.find((i) => i.id === 'depois');
  assert.ok(novo, 'o item de depois do corte sumiu');
  assert.equal(novo.listaId, r.doc.listaAtualId, 'o item de depois do corte ficou órfão');
  assert.equal(novo.updatedAt, belem('2026-10-25T12:01:00'), 'sem carimbo novo, a fusão devolveria o listaId velho');
});

test('idempotente: virada a lista, o minuto seguinte não faz nada', () => {
  const doc = docBase([it('a', '2026-10-25T08:00:00'), it('depois', '2026-10-25T12:00:10')]);
  const r1 = virarListaNoCorte(doc, belem('2026-10-25T12:00:30'));
  assert.equal(virarListaNoCorte(r1.doc, belem('2026-10-25T12:01:30')), null);
  assert.equal(virarListaNoCorte(r1.doc, belem('2026-10-26T11:59:00')), null);
  // No corte seguinte, é a vez do item que entrou depois.
  const r2 = virarListaNoCorte(r1.doc, belem('2026-10-26T12:00:30'));
  assert.equal(r2.pedido.nome, 'Compra de 26/10');
  assert.deepEqual(r2.pedido.itens.map((i) => i.nome), ['Item depois']);
});

test('lista sem item anterior ao corte: nada a fazer', () => {
  assert.equal(virarListaNoCorte(docBase([]), belem('2026-10-25T12:00:30')), null);
  assert.equal(virarListaNoCorte(docBase([it('x', '2026-10-25T12:30:00')]), belem('2026-10-25T13:00:00')), null);
});

test('as OUTRAS listas abertas não são tocadas, e o nome dado à lista é preservado', () => {
  const doc = docBase([it('a', '2026-10-25T08:00:00'), it('outra', '2026-10-24T09:00:00', { listaId: 'L2' })],
    { listasCompra: [{ id: 'L1', nome: 'Feira', criadaPor: 'Mario', criadaEm: 'x' }, { id: 'L2', nome: 'Bebidas' }] });
  const r = virarListaNoCorte(doc, belem('2026-10-25T12:00:30'));
  assert.equal(r.pedido.nome, 'Feira');
  assert.equal(r.pedido.criadaPor, 'Mario');
  assert.ok(r.doc.listaCompras.some((i) => i.id === 'outra' && i.listaId === 'L2'));
  assert.deepEqual(r.doc.listasCompra.map((l) => l.id), ['L2']);
});

test('item sem criadoEm (anterior ao carimbo) sai no corte, não fica preso', () => {
  const r = virarListaNoCorte(docBase([{ id: 'velho', listaId: 'L1', nome: 'Velho' }]), belem('2026-10-25T12:00:30'));
  assert.equal(r.arquivados, 1);
});
