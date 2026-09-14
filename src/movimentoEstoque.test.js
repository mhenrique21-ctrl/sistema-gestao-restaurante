import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarMovimento, insumosDaProducao, distribuirEntreMarcas } from './movimentoEstoque.js';

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

test('rateio entre marcas do mesmo produto', async (t) => {
  const marca = (id, estoque, emb = 1) => ({ id, nome: id, estoqueAtual: estoque, unidadesPorEmbalagem: emb, unidade: emb > 1 ? 'cx' : 'un' });

  await t.test('uma marca só recebe tudo', () => {
    const r = distribuirEntreMarcas([marca('A', 10)], 4);
    assert.equal(r.length, 1);
    assert.equal(r[0].qtd, 4);
  });

  await t.test('tira primeiro de quem tem mais saldo', () => {
    // Sem isso, uma marca ficaria muito negativa enquanto a outra seguia cheia,
    // e nenhuma das duas refletiria a prateleira.
    const r = distribuirEntreMarcas([marca('A', 3), marca('B', 10)], 8);
    assert.equal(r[0].mp.id, 'B');
    assert.equal(r[0].unidades, 8, 'B sozinha cobre');
    assert.equal(r.length, 1);
  });

  await t.test('cascateia quando a primeira não cobre', () => {
    const r = distribuirEntreMarcas([marca('A', 3), marca('B', 10)], 12);
    assert.deepEqual(r.map((x) => [x.mp.id, x.unidades]), [['B', 10], ['A', 2]]);
  });

  await t.test('cada marca converte pela PRÓPRIA embalagem', () => {
    // 12 latas podem ser 1 caixa numa marca e 2 packs de 6 noutra.
    const r = distribuirEntreMarcas([marca('cx12', 5, 12)], 24);
    assert.equal(r[0].unidades, 24);
    assert.equal(r[0].qtd, 2, '24 latas = 2 caixas de 12');
  });

  await t.test('ninguém com saldo: tudo na primeira, negativo', () => {
    // "Vendeu sem ter registrado compra" é a informação honesta; espalhar o
    // negativo faria parecer que todas as marcas estão erradas.
    const r = distribuirEntreMarcas([marca('A', 0), marca('B', 0)], 5);
    assert.equal(r.length, 1);
    assert.equal(r[0].unidades, 5);
  });

  await t.test('sem marcas ou sem quantidade não inventa linha', () => {
    assert.deepEqual(distribuirEntreMarcas([], 5), []);
    assert.deepEqual(distribuirEntreMarcas([marca('A', 10)], 0), []);
  });

  await t.test('a soma distribuída fecha com o vendido', () => {
    const r = distribuirEntreMarcas([marca('A', 2), marca('B', 3), marca('C', 1)], 10);
    assert.equal(r.reduce((s, x) => s + x.unidades, 0), 10);
  });
});
