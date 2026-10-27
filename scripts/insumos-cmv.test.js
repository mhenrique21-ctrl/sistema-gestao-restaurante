import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proporCategoria, listarInsumos, aplicarProposta, foldNome } from './insumos-cmv.mjs';

const compra = (id, nomeProduto, valor, categoria = 'insumos', extra = {}) => ({ id, nomeProduto, valor, categoria, data: '2026-10-01', ...extra });

test('proporCategoria: dicionário do usuário vence a palavra-chave', () => {
  const dic = { 'leite integral 1l': { categoria: 'Mercearia/Secos', origemAprendizado: 'usuario' } };
  assert.deepEqual(proporCategoria('Leite Integral 1L', dic), { categoria: 'Mercearia/Secos', origem: 'dicionario' });
  assert.deepEqual(proporCategoria('Leite Integral 1L', {}), { categoria: 'Laticínios', origem: 'palpite' });
});

test('proporCategoria: limpeza antes de comida, e multi-palavra antes da palavra solta', () => {
  assert.equal(proporCategoria('Água Sanitária 2L').categoria, 'Material de limpeza e higiene');
  assert.equal(proporCategoria('Água Mineral 500ml').categoria, 'Bebidas para revenda');
  assert.equal(proporCategoria('Leite de Coco 200ml').categoria, 'Mercearia/Secos');
  assert.equal(proporCategoria('Creme de Leite').categoria, 'Laticínios');
});

test('proporCategoria: casa palavra inteira — "sal" não é "salame" nem "salsa"', () => {
  assert.equal(proporCategoria('Salame Italiano').categoria, 'Proteínas');
  assert.equal(proporCategoria('Salsa').categoria, 'Hortifruti');
  assert.equal(proporCategoria('Sal Refinado 1kg').categoria, 'Mercearia/Secos');
  assert.equal(proporCategoria('Queijos Mussarela').categoria, 'Laticínios');
});

test('proporCategoria: o que ninguém sabe fica em Outros com origem "nenhuma"', () => {
  assert.deepEqual(proporCategoria('XPTO 123'), { categoria: 'Outros', origem: 'nenhuma' });
  assert.deepEqual(proporCategoria(''), { categoria: 'Outros', origem: 'nenhuma' });
});

test('listarInsumos: só "insumos" (qualquer caixa/acento), agrupado por nome, maior total primeiro', () => {
  const d = { compras: [
    compra('a', 'Leite Integral', '10,00'), compra('b', 'leite  integral', 15), compra('c', 'Café Torrado', 50, 'Insumos'),
    compra('d', 'Detergente', 5, 'Material de limpeza e higiene'), compra('e', 'Queijo', 20, 'Laticínios'),
  ] };
  const r = listarInsumos(d);
  assert.equal(r.compras, 3);
  assert.equal(r.total, 75);
  assert.deepEqual(r.itens.map((i) => [i.nome, i.compras, i.total, i.categoria]), [
    ['Café Torrado', 1, 50, 'Mercearia/Secos'], ['Leite Integral', 2, 25, 'Laticínios'],
  ]);
  assert.deepEqual(r.itens[1].ids, ['a', 'b']);
});

test('aplicarProposta: reescreve categoria, guarda a original, carimba e ensina o dicionário', () => {
  const d = { compras: [compra('a', 'Leite Integral', 10), compra('b', 'Café', 50), compra('c', 'Leite Integral', 7, 'Laticínios')],
    dicionarioClassificacao: { cafe: { categoria: 'Outros', origemAprendizado: 'agente' } } };
  const proposta = { itens: [
    { chave: 'leite integral', nome: 'Leite Integral', categoria: 'Laticínios' },
    { chave: 'cafe', nome: 'Café', categoria: 'Mercearia/Secos' },
  ] };
  const r = aplicarProposta(d, proposta, '2026-10-26T12:00:00.000Z');
  assert.equal(r.alteradas, 2);
  assert.equal(r.aprendidos, 2);
  assert.deepEqual(r.porCat, { 'Laticínios': 10, 'Mercearia/Secos': 50 });
  const a = d.compras.find((c) => c.id === 'a');
  assert.equal(a.categoria, 'Laticínios');
  assert.equal(a.categoriaOriginal, 'insumos');
  assert.equal(a.atualizadoEm, '2026-10-26T12:00:00.000Z');
  // a compra que já era Laticínios não é tocada
  assert.equal(d.compras.find((c) => c.id === 'c').atualizadoEm, undefined);
  assert.deepEqual(d.dicionarioClassificacao.cafe, { categoria: 'Mercearia/Secos', origemAprendizado: 'usuario', ultimaAtualizacao: '2026-10-26T12:00:00.000Z' });
});

test('aplicarProposta: "pular" e categoria fora das 8 oficiais não gravam nada', () => {
  const d = { compras: [compra('a', 'Mistério', 10), compra('b', 'Outro', 5)] };
  const r = aplicarProposta(d, { itens: [
    { chave: 'misterio', categoria: 'Mercearia/Secos', pular: true },
    { chave: 'outro', categoria: 'insumos' },
  ] });
  assert.equal(r.alteradas, 0);
  assert.equal(r.ignoradas, 2);
  assert.equal(d.compras[0].categoria, 'insumos');
  assert.deepEqual(d.dicionarioClassificacao, {});
});

test('foldNome iguala o do App.tsx', () => {
  assert.equal(foldNome('  Açúcar   Cristal '), 'acucar cristal');
});
