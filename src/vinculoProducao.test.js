import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNome, tokens, pontuar, sugerirVinculo, itemDeEstoqueDaProducao, apelidosDoItem } from './vinculoProducao.js';

// Análise do código sob teste (vinculoProducao.js):
// - Input: nome digitado no catálogo de produção ("Coxinha de frango") e a
//   lista de itens de estoque (produtos do Eclética, "SALG COXINHA FRANGO").
// - Output: sugestão de par com pontuação e a marca `seguro`, e o resolvedor
//   que a produção usa de verdade (vínculo explícito → nome → nada).
// - Sem efeitos colaterais: funções puras.
// - Existe porque sugerir par errado erra em SILÊNCIO — a produção entraria no
//   saldo do produto errado e só a contagem física denunciaria.

const mp = (id, nome) => ({ id, nome });
const ECLETICA = [
  mp('e1', 'SALG COXINHA FRANGO'),
  mp('e2', 'TRANCA CALABRESA'),
  mp('e3', 'TRANCA CAMARAO'),
  mp('e4', 'BOLO CHOCOLATE FATIA'),
  mp('e5', 'EMPADA FRANGO'),
];

test('normaliza acento, caixa e pontuação', () => {
  assert.equal(normalizarNome('Trança de salame (burguesa)'), 'tranca de salame burguesa');
  assert.equal(normalizarNome('SALG. COXINHA'), 'salg coxinha');
});

test('as palavras de ruído do catálogo saem dos tokens', () => {
  // "salg" e "de" não distinguem produto nenhum; deixá-los inflaria a
  // semelhança entre coisas diferentes.
  assert.deepEqual(tokens('SALG. COXINHA DE FRANGO'), ['coxinha', 'frango']);
  assert.deepEqual(tokens('Pasta de brigadeiro P/ café'), ['pasta', 'brigadeiro', 'cafe']);
});

test('ordem das palavras não atrapalha', () => {
  assert.equal(pontuar('Trança de salame (burguesa)', 'TRANCA SALAME BURGUESA'), 1);
  assert.equal(pontuar('Coxinha de frango', 'SALG COXINHA FRANGO'), 1);
});

test('nomes sem nada em comum pontuam zero', () => {
  assert.equal(pontuar('Bolo de milho', 'TRANCA CAMARAO'), 0);
});

test('sugere o par certo e marca como seguro', () => {
  const s = sugerirVinculo('Coxinha de frango', ECLETICA);
  assert.equal(s.mp.id, 'e1');
  assert.equal(s.seguro, true);
});

test('⚠️ par ambíguo NÃO é seguro — o lote não pode ligar camarão na calabresa', () => {
  // "Trança de camarão" casa 1.0 com TRANCA CAMARAO, mas TRANCA CALABRESA vem
  // logo atrás; a margem é o que impede o lote de errar em silêncio.
  const s = sugerirVinculo('Trança', ECLETICA);
  assert.equal(s.seguro, false, 'nome genérico demais não pode entrar no lote');
});

test('sem candidato parecido, devolve null em vez de chutar', () => {
  assert.equal(sugerirVinculo('Pão de batata', ECLETICA), null);
});

test('item já vinculado sai da lista de candidatos', () => {
  const s = sugerirVinculo('Coxinha de frango', ECLETICA, { excluirIds: ['e1'] });
  assert.equal(s, null);
});

test('o resolvedor usa o VÍNCULO antes do nome', () => {
  const produtosProducao = [{ id: 'c1', nome: 'Coxinha de frango', mpId: 'e1' }];
  const r = itemDeEstoqueDaProducao('Coxinha de frango', { produtosProducao, materiasPrimas: ECLETICA });
  assert.equal(r.mp.id, 'e1');
  assert.equal(r.origem, 'vinculo');
});

test('sem vínculo, casa pelo nome igual — é como tudo funcionava antes', () => {
  const mps = [...ECLETICA, mp('e9', 'Bolo de milho')];
  const r = itemDeEstoqueDaProducao('bolo de MILHO', { produtosProducao: [], materiasPrimas: mps });
  assert.equal(r.mp.id, 'e9');
  assert.equal(r.origem, 'nome');
});

test('⚠️ o resolvedor NUNCA chuta por semelhança', () => {
  // Semelhança é sugestão de tela; baixar saldo por palpite é o erro que este
  // módulo existe para evitar.
  assert.equal(itemDeEstoqueDaProducao('Coxinha de frango', { produtosProducao: [], materiasPrimas: ECLETICA }), null);
});

test('vínculo apontando para produto excluído cai no nome, não quebra', () => {
  const produtosProducao = [{ id: 'c1', nome: 'Coxinha de frango', mpId: 'sumiu' }];
  assert.equal(itemDeEstoqueDaProducao('Coxinha de frango', { produtosProducao, materiasPrimas: ECLETICA }), null);
});

test('apelidos: o fechamento do pedido precisa conhecer os dois nomes', () => {
  const produtosProducao = [
    { id: 'c1', nome: 'Coxinha de frango', mpId: 'e1' },
    { id: 'c2', nome: 'Coxinha frango grande', mpId: 'e1' },
    { id: 'c3', nome: 'Bolo de milho', mpId: 'e4' },
  ];
  assert.deepEqual(apelidosDoItem('e1', produtosProducao), ['Coxinha de frango', 'Coxinha frango grande']);
  assert.deepEqual(apelidosDoItem('nao-existe', produtosProducao), []);
});
