import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarMovimento, insumosDaProducao } from './movimentoEstoque.js';

let n = 0;
const uid = () => `id${++n}`;
const agora = '2026-09-14T10:00:00.000Z';
const data = '2026-09-14';

const bolo = { id: 'p-bolo', nome: 'Bolo de Chocolate', unidade: 'un', estoqueAtual: 4, ultimoValor: 20 };
const farinha = { id: 'i-farinha', nome: 'Farinha', unidade: 'kg', estoqueAtual: 15, ultimoValor: 6 };
const choco = { id: 'i-choco', nome: 'Chocolate em pó', unidade: 'kg', estoqueAtual: 2, ultimoValor: 40 };
const base = () => [{ ...bolo }, { ...farinha }, { ...choco }];

// Rende 5 bolos e usa 1,2 kg de farinha (escrita em GRAMAS, como ficha real)
// e 400 g de chocolate.
const ficha = {
  nome: 'Bolo de Chocolate', porcoes: 5,
  insumos: [
    { mpId: 'i-farinha', nome: 'Farinha', quantidade: 1200, unidade: 'g', valorUnd: 0.006 },
    { mpId: 'i-choco', nome: 'Chocolate em pó', quantidade: 400, unidade: 'g', valorUnd: 0.04 },
  ],
};

test('operações manuais', async (t) => {
  await t.test('entrada soma ao saldo', () => {
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'entrada', quantidade: 6, data, agora, uid });
    assert.equal(r.materiasPrimas[0].estoqueAtual, 10);
    assert.equal(r.movEstoque[0].tipo, 'entrada');
    assert.equal(r.movEstoque[0].quantidade, 6);
  });

  await t.test('saída subtrai e pode ficar negativa', () => {
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'saida', quantidade: 10, motivo: 'Perda', data, agora, uid });
    assert.equal(r.materiasPrimas[0].estoqueAtual, -6, 'mostrar a inconsistência é melhor que escondê-la');
    assert.equal(r.movEstoque[0].descricao, 'Perda');
  });

  await t.test('ajuste informa o saldo CONTADO, não a diferença', () => {
    // É como a contagem física funciona: o operador conta 12 e digita 12.
    // Misturar os dois sentidos no mesmo campo é erro clássico de inventário.
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'ajuste', quantidade: 12, data, agora, uid });
    assert.equal(r.materiasPrimas[0].estoqueAtual, 12);
    assert.equal(r.movEstoque[0].quantidade, 8, 'o movimento registra a diferença de 8');
  });

  await t.test('quantidade inválida é recusada em vez de gravar NaN', () => {
    assert.throws(() => aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'entrada', quantidade: 'abc', data, agora, uid }));
    assert.throws(() => aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'entrada', quantidade: -5, data, agora, uid }));
  });
});

test('produção: entra o produto e saem os insumos', async (t) => {
  await t.test('divide pelo rendimento e converte a unidade', () => {
    // 10 bolos = 2 receitas. Farinha: 1200 g × 2 = 2400 g = 2,4 kg.
    const { linhas, avisos } = insumosDaProducao(ficha, 10, base());
    assert.equal(avisos.length, 0);
    assert.equal(linhas.find((l) => l.mp.id === 'i-farinha').qtd, 2.4);
    assert.equal(linhas.find((l) => l.mp.id === 'i-choco').qtd, 0.8);
  });

  await t.test('os dois lados acontecem juntos, no mesmo grupo', () => {
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'producao', quantidade: 10, ficha, data, agora, uid });
    const saldo = (id) => r.materiasPrimas.find((m) => m.id === id).estoqueAtual;
    assert.equal(saldo('p-bolo'), 14, '4 + 10');
    assert.equal(saldo('i-farinha'), 12.6, '15 − 2,4');
    assert.equal(saldo('i-choco'), 1.2, '2 − 0,8');
    assert.equal(r.movEstoque.length, 3, 'uma entrada e duas saídas');
    // Sem o grupo, conferir ou desfazer a produção depois seria adivinhação.
    assert.equal(new Set(r.movEstoque.map((m) => m.grupoId)).size, 1);
  });

  await t.test('produzir SEM ficha não é bloqueado — entra e avisa', () => {
    // Decisão do dono: travar a cozinha porque o cadastro está incompleto é
    // pior que registrar o que já aconteceu e dizer o que faltou.
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'producao', quantidade: 10, ficha: null, data, agora, uid });
    assert.equal(r.materiasPrimas[0].estoqueAtual, 14, 'o produto entrou mesmo assim');
    assert.equal(r.movEstoque.length, 1, 'e nenhum insumo saiu');
    assert.match(r.avisos.join(' '), /não tem ficha/);
  });

  await t.test('insumo da ficha fora do cadastro vira aviso, não erro', () => {
    const fichaOrfa = { nome: 'X', porcoes: 1, insumos: [{ mpId: 'nao-existe', nome: 'Fermento', quantidade: 10, unidade: 'g' }] };
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'producao', quantidade: 1, ficha: fichaOrfa, data, agora, uid });
    assert.equal(r.materiasPrimas[0].estoqueAtual, 5);
    assert.match(r.avisos.join(' '), /Fermento/);
  });

  await t.test('unidade sem conversão possível avisa em vez de baixar errado', () => {
    // Ficha em "un" e insumo em "kg": qualquer número inventado aqui viraria
    // um rombo de estoque que ninguém explica.
    const fichaRuim = { nome: 'X', porcoes: 1, insumos: [{ mpId: 'i-farinha', nome: 'Farinha', quantidade: 2, unidade: 'un' }] };
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'producao', quantidade: 1, ficha: fichaRuim, data, agora, uid });
    assert.equal(r.materiasPrimas.find((m) => m.id === 'i-farinha').estoqueAtual, 15, 'farinha intacta');
    assert.match(r.avisos.join(' '), /sem conversão/);
  });

  await t.test('insumo pode ficar negativo: a produção já aconteceu', () => {
    const r = aplicarMovimento({ movEstoque: [], materiasPrimas: base(), item: bolo, operacao: 'producao', quantidade: 100, ficha, data, agora, uid });
    assert.equal(r.materiasPrimas.find((m) => m.id === 'i-choco').estoqueAtual, -6, '2 − 8');
  });

  await t.test('movimento de compra alheio não é tocado', () => {
    const compra = { id: 'c1', mpId: 'i-farinha', tipo: 'entrada', quantidade: 5, data };
    const r = aplicarMovimento({ movEstoque: [compra], materiasPrimas: base(), item: bolo, operacao: 'producao', quantidade: 5, ficha, data, agora, uid });
    assert.ok(r.movEstoque.find((m) => m.id === 'c1'));
  });
});
