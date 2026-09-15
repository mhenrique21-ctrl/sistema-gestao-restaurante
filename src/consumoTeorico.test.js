import test from 'node:test';
import assert from 'node:assert/strict';
import { converterQtd, consumoTeorico, aplicarBaixaVendas } from './consumoTeorico.js';

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

test('baixa de estoque por venda', async (t) => {
  const mps = () => [{ id: 'mp1', nome: 'Polvilho', unidade: 'kg', estoqueAtual: 10 }];
  const agora = '2026-09-14T10:00:00.000Z';

  await t.test('primeira aplicação cria o movimento e desconta', () => {
    const r = aplicarBaixaVendas([], mps(), { '2026-09-12': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } } }, agora);
    assert.equal(r.criados, 1);
    assert.equal(r.movEstoque[0].quantidade, 2);
    assert.equal(r.movEstoque[0].tipo, 'saida');
    assert.equal(r.materiasPrimas[0].estoqueAtual, 8);
  });

  await t.test('reaplicar o MESMO dia não desconta de novo', () => {
    // O agente reenvia ontem e hoje a cada 2 minutos. Sem isso, um dia de
    // venda zeraria o estoque sozinho ao longo da tarde.
    const porDia = { '2026-09-12': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } } };
    const um = aplicarBaixaVendas([], mps(), porDia, agora);
    const dois = aplicarBaixaVendas(um.movEstoque, um.materiasPrimas, porDia, agora);
    assert.equal(dois.criados + dois.atualizados, 0, 'nada a fazer na segunda passada');
    assert.equal(dois.materiasPrimas[0].estoqueAtual, 8, 'o saldo não se move');
    assert.equal(dois.movEstoque.length, 1, 'e não cria um segundo movimento');
  });

  await t.test('ficha corrigida devolve a diferença em vez de somar', () => {
    const um = aplicarBaixaVendas([], mps(), { '2026-09-12': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } } }, agora);
    const dois = aplicarBaixaVendas(um.movEstoque, um.materiasPrimas,
      { '2026-09-12': { mp1: { qtd: 1.6, unidade: 'kg', nome: 'Polvilho' } } }, agora);
    assert.equal(dois.movEstoque.length, 1);
    assert.equal(dois.movEstoque[0].quantidade, 1.6);
    assert.equal(dois.materiasPrimas[0].estoqueAtual, 8.4, '10 − 1,6 — e não 10 − 2 − 1,6');
  });

  await t.test('dias diferentes geram movimentos diferentes', () => {
    const r = aplicarBaixaVendas([], mps(), {
      '2026-09-11': { mp1: { qtd: 1, unidade: 'kg', nome: 'Polvilho' } },
      '2026-09-12': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } },
    }, agora);
    assert.equal(r.movEstoque.length, 2, 'saída tem data: um dia não engole o outro');
    assert.equal(r.materiasPrimas[0].estoqueAtual, 7);
    assert.deepEqual(r.movEstoque.map((m) => m.data).sort(), ['2026-09-11', '2026-09-12']);
  });

  await t.test('venda que virou zero remove o movimento e devolve o estoque', () => {
    // Acontece ao desvincular um produto: aquele dia deixa de consumir o insumo.
    const um = aplicarBaixaVendas([], mps(), { '2026-09-12': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } } }, agora);
    const dois = aplicarBaixaVendas(um.movEstoque, um.materiasPrimas, { '2026-09-12': { mp1: { qtd: 0 } } }, agora);
    assert.equal(dois.removidos, 1);
    assert.equal(dois.movEstoque.length, 0);
    assert.equal(dois.materiasPrimas[0].estoqueAtual, 10, 'volta ao que era');
  });

  await t.test('não mexe em movimento de outra origem', () => {
    const compra = { id: 'x1', mpId: 'mp1', tipo: 'entrada', quantidade: 5, data: '2026-09-12' };
    const r = aplicarBaixaVendas([compra], mps(), { '2026-09-12': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } } }, agora);
    assert.equal(r.movEstoque.length, 2);
    assert.ok(r.movEstoque.find((m) => m.id === 'x1'), 'a entrada de compra continua lá, intacta');
  });

  await t.test('saldo pode ficar negativo em vez de travar', () => {
    // Travar porque o cadastro está desatualizado esconderia a inconsistência.
    const r = aplicarBaixaVendas([], mps(), { '2026-09-12': { mp1: { qtd: 25, unidade: 'kg', nome: 'Polvilho' } } }, agora);
    assert.equal(r.materiasPrimas[0].estoqueAtual, -15);
  });

  await t.test('insumo que não existe mais não quebra a aplicação', () => {
    const r = aplicarBaixaVendas([], mps(), { '2026-09-12': { sumiu: { qtd: 3, unidade: 'kg', nome: '?' } } }, agora);
    assert.equal(r.criados, 1, 'o movimento fica registrado');
    assert.equal(r.materiasPrimas[0].estoqueAtual, 10, 'e nenhum saldo alheio é tocado');
  });
});

test('desfazer a baixa de um período inteiro', async (t) => {
  const agora = '2026-09-14T10:00:00.000Z';
  const mps = () => [
    { id: 'mp1', nome: 'Polvilho', unidade: 'kg', estoqueAtual: 10 },
    { id: 'mp2', nome: 'Queijo', unidade: 'kg', estoqueAtual: 4 },
  ];

  await t.test('devolve tudo e não toca em movimento de outra natureza', () => {
    const compra = { id: 'c1', mpId: 'mp1', tipo: 'entrada', quantidade: 5, data: '2026-09-12' };
    const perda = { id: 'p1', mpId: 'mp2', tipo: 'perda', quantidade: 1, data: '2026-09-12' };
    const aplicado = aplicarBaixaVendas([compra, perda], mps(), {
      '2026-09-11': { mp1: { qtd: 2, unidade: 'kg', nome: 'Polvilho' } },
      '2026-09-12': { mp1: { qtd: 3, unidade: 'kg', nome: 'Polvilho' }, mp2: { qtd: 1, unidade: 'kg', nome: 'Queijo' } },
    }, agora);
    assert.equal(aplicado.materiasPrimas[0].estoqueAtual, 5);
    assert.equal(aplicado.materiasPrimas[1].estoqueAtual, 3);

    // É assim que a tela desfaz: varre os movimentos "vsaida-" já gravados e
    // manda zero pra cada um. Varrer o que EXISTE (e não o que seria calculado
    // agora) é o que garante que um produto desvinculado depois da baixa não
    // deixe movimento órfão segurando estoque.
    const zerar = {};
    aplicado.movEstoque
      .filter((m) => m.id.startsWith('vsaida-'))
      .forEach((m) => { (zerar[m.data] = zerar[m.data] || {})[m.mpId] = { qtd: 0 }; });

    const desfeito = aplicarBaixaVendas(aplicado.movEstoque, aplicado.materiasPrimas, zerar, agora);

    assert.equal(desfeito.materiasPrimas[0].estoqueAtual, 10, 'polvilho volta ao original');
    assert.equal(desfeito.materiasPrimas[1].estoqueAtual, 4, 'queijo também');
    assert.equal(desfeito.movEstoque.filter((m) => m.id.startsWith('vsaida-')).length, 0);
    assert.ok(desfeito.movEstoque.find((m) => m.id === 'c1'), 'a compra continua lá');
    assert.ok(desfeito.movEstoque.find((m) => m.id === 'p1'), 'a perda também');
  });

  await t.test('desfazer e aplicar de novo devolve ao mesmo lugar', () => {
    const porDia = { '2026-09-12': { mp1: { qtd: 3, unidade: 'kg', nome: 'Polvilho' } } };
    const um = aplicarBaixaVendas([], mps(), porDia, agora);
    const zero = aplicarBaixaVendas(um.movEstoque, um.materiasPrimas, { '2026-09-12': { mp1: { qtd: 0 } } }, agora);
    const dois = aplicarBaixaVendas(zero.movEstoque, zero.materiasPrimas, porDia, agora);
    assert.equal(dois.materiasPrimas[0].estoqueAtual, 7, 'mesmo saldo do primeiro apply');
    assert.equal(dois.movEstoque.length, 1);
  });
});

test('reconciliação: baixa que saiu do cálculo é desfeita ao reaplicar', async (t) => {
  const agora = '2026-09-14T10:00:00.000Z';
  const mps = () => [
    { id: 'mp-polvilho', nome: 'Polvilho', unidade: 'kg', estoqueAtual: 10 },
    { id: 'mp-agua', nome: 'Água', unidade: 'cx', estoqueAtual: 8 },
  ];

  await t.test('revenda que migrou pro PDV devolve o estoque que tinha baixado aqui', () => {
    // O laço de aplicação só passa pelas chaves do cálculo ATUAL. Sem somar os
    // órfãos explicitamente, a baixa antiga da água ficaria pendurada segurando
    // estoque que ninguém mais explica — e o saldo do Gestão nunca bateria com
    // o do PDV, que passou a ser o dono daquele produto.
    const antes = aplicarBaixaVendas([], mps(), {
      '2026-09-12': {
        'mp-polvilho': { qtd: 2, unidade: 'kg', nome: 'Polvilho' },
        'mp-agua': { qtd: 3, unidade: 'cx', nome: 'Água' },
      },
    }, agora);
    assert.equal(antes.materiasPrimas[1].estoqueAtual, 5, 'água baixou 3');

    // Novo cálculo: só produzido. A água sumiu do mapa.
    const novoCalculo = { '2026-09-12': { 'mp-polvilho': { qtd: 2, unidade: 'kg', nome: 'Polvilho' } } };
    // É isto que a tela monta: o cálculo + zero para cada órfão do período.
    const orfaos = antes.movEstoque.filter((m) => m.id.startsWith('vsaida-') && !novoCalculo[m.data]?.[m.mpId]);
    const reconciliado = { ...novoCalculo };
    orfaos.forEach((m) => { reconciliado[m.data] = { ...reconciliado[m.data], [m.mpId]: { qtd: 0 } }; });

    const depois = aplicarBaixaVendas(antes.movEstoque, antes.materiasPrimas, reconciliado, agora);

    assert.equal(depois.materiasPrimas[1].estoqueAtual, 8, 'água volta ao saldo original');
    assert.equal(depois.materiasPrimas[0].estoqueAtual, 8, 'polvilho continua baixado');
    assert.equal(depois.movEstoque.filter((m) => m.mpId === 'mp-agua').length, 0, 'e o movimento da água some');
  });
});

test('o resolvedor recebe o produto inteiro, não só o nome', () => {
  // A Conferência casa por CÓDIGO, como a baixa. Recebendo só o nome, um
  // produto renomeado no Gestão baixava estoque e sumia do consumo teórico:
  // a receita caía em "sem ficha" e o CMV saía menor que o real, calado.
  const vistos = [];
  const fichaCod = {
    nome: 'Receita', porcoes: 1,
    insumos: [{ mpId: 'm1', nome: 'Farinha', quantidade: 100, unidade: 'g', custo: 1 }],
  };
  const r = consumoTeorico(
    [{ nome: 'NOME NOVO NO GESTAO', cod: '141', qtd: 2, total: 20 }],
    (nome, produto) => { vistos.push([nome, produto?.cod]); return produto?.cod === '141' ? fichaCod : null; },
  );
  assert.deepEqual(vistos, [['NOME NOVO NO GESTAO', '141']]);
  assert.equal(r.receitaComFicha, 20);
  assert.equal(r.receitaSemFicha, 0);
  assert.equal(r.linhas[0].qtd, 200);
});

test('resolvedor que só olha o nome continua valendo', () => {
  // movimentoEstoque.js e a aba Registrar passam a ficha pronta e ignoram os
  // argumentos — a mudança não pode exigir nada deles.
  const f = { nome: 'F', porcoes: 1, insumos: [{ mpId: 'm1', nome: 'X', quantidade: 5, unidade: 'g', custo: 1 }] };
  const r = consumoTeorico([{ nome: 'Qualquer', qtd: 3, total: 9 }], () => f);
  assert.equal(r.linhas[0].qtd, 15);
});
