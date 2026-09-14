import test from 'node:test';
import assert from 'node:assert/strict';
import { converterQtd, consumoTeorico } from './consumoTeorico.js';

test('conversão de unidade', async (t) => {
  await t.test('massa e volume convertem porque a relação é fixa', () => {
    assert.equal(converterQtd(2, 'kg', 'g'), 2000);
    assert.equal(converterQtd(4500, 'g', 'kg'), 4.5);
    assert.equal(converterQtd(1.5, 'L', 'ml'), 1500);
    assert.equal(converterQtd(500, 'ml', 'litro'), 0.5);
  });

  await t.test('acento e caixa não atrapalham', () => {
    assert.equal(converterQtd(1, 'Quilo', 'G'), 1000);
  });

  await t.test('família diferente NÃO converte', () => {
    // 1 kg de farinha não são 1000 ml de nada. Devolver um número aqui seria
    // pior que devolver null: a tela mostraria um comparativo inventado.
    assert.equal(converterQtd(1, 'kg', 'ml'), null);
  });

  await t.test('unidade de contagem só casa com ela mesma', () => {
    assert.equal(converterQtd(10, 'un', 'un'), 10);
    // Quantas unidades tem um pacote é cadastro, não tabela.
    assert.equal(converterQtd(10, 'pct', 'un'), null);
    assert.equal(converterQtd(10, 'cx', 'g'), null);
  });
});

test('consumo teórico', async (t) => {
  const ficha = (over = {}) => ({
    nome: 'Pão de queijo', porcoes: 50,
    insumos: [
      { mpId: 'mp-polvilho', nome: 'Polvilho', quantidade: 1000, unidade: 'g', valorUnd: 0.02 },
      { mpId: 'mp-queijo', nome: 'Queijo', quantidade: 500, unidade: 'g', valorUnd: 0.05 },
    ],
    ...over,
  });
  const resolver = (f) => () => f;

  await t.test('divide pelo rendimento da receita', () => {
    // A receita rende 50 unidades e usa 1000 g de polvilho. Vender 100 pães
    // consome 2 receitas = 2000 g. Sem dividir por porcoes daria 100.000 g —
    // 100 kg de polvilho num dia, e o número ainda "pareceria" plausível numa
    // tela cheia de linhas.
    const r = consumoTeorico([{ nome: 'PAO DE QUEIJO', qtd: 100, total: 500 }], resolver(ficha()));
    const polvilho = r.linhas.find((l) => l.mpId === 'mp-polvilho');
    assert.equal(polvilho.qtd, 2000);
    assert.equal(polvilho.unidade, 'g');
  });

  await t.test('custo acompanha a mesma divisão', () => {
    const r = consumoTeorico([{ nome: 'PAO DE QUEIJO', qtd: 100, total: 500 }], resolver(ficha()));
    // 2000 g × 0,02 = 40 ; 1000 g × 0,05 = 50
    assert.equal(r.linhas.reduce((s, l) => s + l.custo, 0), 90);
  });

  await t.test('mesmo insumo em fichas diferentes soma no mesmo balde', () => {
    const outra = { nome: 'Pão de queijo GG', porcoes: 10,
      insumos: [{ mpId: 'mp-polvilho', nome: 'Polvilho', quantidade: 1000, unidade: 'g', valorUnd: 0.02 }] };
    const r = consumoTeorico(
      [{ nome: 'A', qtd: 50, total: 100 }, { nome: 'B', qtd: 10, total: 50 }],
      (n) => (n === 'A' ? ficha() : outra),
    );
    const polvilho = r.linhas.find((l) => l.mpId === 'mp-polvilho');
    assert.equal(polvilho.qtd, 2000, '1000 (50 de A) + 1000 (10 de B)');
    assert.equal(polvilho.fontes.size, 2, 'e diz de quais produtos veio');
  });

  await t.test('rendimento ausente vira 1 mas ENTRA no aviso', () => {
    // Tratar como 1 em silêncio superestimaria o consumo sem ninguém perceber.
    const r = consumoTeorico([{ nome: 'X', qtd: 10, total: 50 }], resolver(ficha({ porcoes: undefined })));
    assert.equal(r.linhas.find((l) => l.mpId === 'mp-polvilho').qtd, 10000);
    assert.deepEqual(r.semPorcoes, ['Pão de queijo']);
  });

  await t.test('rendimento zero não gera divisão por zero', () => {
    const r = consumoTeorico([{ nome: 'X', qtd: 1, total: 5 }], resolver(ficha({ porcoes: 0 })));
    assert.ok(r.linhas.every((l) => Number.isFinite(l.qtd)), 'nada de Infinity escapando pra tela');
  });

  await t.test('produto sem ficha não some: vira receita descoberta', () => {
    const r = consumoTeorico([{ nome: 'Água', qtd: 10, total: 40 }], () => null);
    assert.equal(r.linhas.length, 0);
    assert.equal(r.receitaSemFicha, 40, 'é o que diz que o CMV teórico não cobre a loja inteira');
  });

  await t.test('ficha sem insumos é avisada em vez de contar como custo zero', () => {
    const r = consumoTeorico([{ nome: 'X', qtd: 10, total: 90 }], resolver(ficha({ insumos: [] })));
    assert.deepEqual(r.semInsumos, ['Pão de queijo']);
    assert.equal(r.receitaComFicha, 90, 'a receita conta — senão o CMV sairia otimista de graça');
  });

  await t.test('insumo sem mpId agrupa pelo nome em vez de ser descartado', () => {
    const r = consumoTeorico([{ nome: 'X', qtd: 1, total: 5 }],
      resolver({ nome: 'Y', porcoes: 1, insumos: [{ nome: 'Sal', quantidade: 5, unidade: 'g' }] }));
    assert.equal(r.linhas.length, 1);
    assert.equal(r.linhas[0].chave, 'nome:sal');
  });
});
