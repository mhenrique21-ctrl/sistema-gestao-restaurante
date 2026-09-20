import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  rendimentoDaMarca, ultimaCompra, marcaNoGrupo, custoDoGrupo, saldoDoGrupo,
  buscarMarcas, agruparMarcas, desagruparMarca, marcasDoGrupo, unidadeBaseDo,
  custoParaUnidade, ratearEntreMarcas, grupoDoInsumo, grupoDaMarca,
} from './grupoMarcas.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// O Nescau do dono: quatro embalagens, e a lata é contada em "un".
const NESCAU = [
  { id: 'a', nome: 'Nescau lata 395g', unidade: 'un', porUnidadeBase: 395, estoqueAtual: 2, ultimoValor: 8.49 },
  { id: 'b', nome: 'Nescau pacote 700g', unidade: 'un', porUnidadeBase: 700, estoqueAtual: 1, ultimoValor: 13.90 },
  { id: 'c', nome: 'Nescau pacote 900g', unidade: 'un', porUnidadeBase: 900, estoqueAtual: 0, ultimoValor: 17.50 },
  { id: 'd', nome: 'Nescau 2,1kg', unidade: 'kg', estoqueAtual: 6.3, ultimoValor: 17.5714 },
];
const MOV = [
  { mpId: 'a', tipo: 'entrada', data: '2026-08-02', custo: 8.49, quantidade: 6 },
  { mpId: 'd', tipo: 'entrada', data: '2026-09-18', custo: 17.5714, quantidade: 6.3 },
  { mpId: 'd', tipo: 'saida', data: '2026-09-19', custo: 17.5714, quantidade: 1 },
];

describe('quanto 1 unidade de estoque da marca rende', () => {
  test('a declaração explícita VENCE — "un" não converte para "g"', () => {
    // ⚠️ Nenhuma tabela converte "un" em "g", porque isso não é conversão: é
    // cadastro. Só a lata sabe que tem 395 g dentro.
    assert.equal(rendimentoDaMarca(NESCAU[0], 'g'), 395);
  });

  test('kg↔g sai de graça, sem declarar nada', () => {
    assert.equal(rendimentoDaMarca(NESCAU[3], 'g'), 1000);
    assert.equal(rendimentoDaMarca({ unidade: 'L' }, 'ml'), 1000);
    assert.equal(rendimentoDaMarca({ unidade: 'kg' }, 'kg'), 1);
  });

  test('sem rendimento é NULL, nunca 1', () => {
    // ⚠️ Com fator 1, 3 latas somariam 3 gramas ao lado de 6.300 — o grupo
    // passaria a mentir em silêncio, e o número continuaria plausível.
    assert.equal(rendimentoDaMarca({ unidade: 'un' }, 'g'), null);
    assert.equal(rendimentoDaMarca({ unidade: 'un', porUnidadeBase: 0 }, 'g'), null);
  });
});

describe('a última COMPRA, não a última edição', () => {
  test('sai da entrada de estoque, que tem a data da nota', () => {
    // ⚠️ O "mais recente" que já existia ordena por `atualizadoEm`, carimbado
    // sempre que o preço muda — inclusive numa correção à mão. "Repreçada por
    // último" não é "comprada por último".
    assert.deepEqual(ultimaCompra(MOV, 'd'), { data: '2026-09-18', custo: 17.5714, quantidade: 6.3 });
    assert.equal(ultimaCompra(MOV, 'c'), null, 'marca sem entrada nenhuma');
  });

  test('saída não conta como compra', () => {
    const so = [{ mpId: 'x', tipo: 'saida', data: '2026-09-30', custo: 9, quantidade: 1 }];
    assert.equal(ultimaCompra(so, 'x'), null);
  });
});

describe('o grupo soma na língua dele', () => {
  test('quatro embalagens diferentes viram um saldo só', () => {
    const { saldoBase, pendentes } = saldoDoGrupo(NESCAU, 'g', MOV);
    // 2×395 + 1×700 + 0 + 6,3kg×1000
    assert.equal(saldoBase, 7790);
    assert.equal(pendentes.length, 0);
  });

  test('marca sem rendimento fica FORA da soma e vira pendência', () => {
    const comSolto = [...NESCAU, { id: 'e', nome: 'Nescau sachê', unidade: 'un', estoqueAtual: 40, ultimoValor: 1.20 }];
    const { saldoBase, pendentes } = saldoDoGrupo(comSolto, 'g', MOV);
    assert.equal(saldoBase, 7790, 'não somou 40 como se fossem 40 g');
    assert.deepEqual(pendentes.map((p) => p.nome), ['Nescau sachê']);
  });

  test('o custo por unidade base de cada marca', () => {
    const l = marcaNoGrupo(NESCAU[0], 'g', MOV);
    assert.equal(l.saldoBase, 790);
    assert.equal(r4(l.custoBase), 0.0215);        // 8,49 ÷ 395
    assert.equal(l.valorEmCasa, 16.98);           // 2 × 8,49
    function r4(n) { return Math.round(n * 10000) / 10000; }
  });
});

describe('MÉDIA PONDERADA pelo saldo — decisão do dono', () => {
  test('é o custo do que está REALMENTE na despensa', () => {
    // dinheiro parado: 2×8,49 + 1×13,90 + 0 + 6,3×17,5714 = 141,58
    // saldo: 7.790 g  →  0,018174…/g
    const c = custoDoGrupo(NESCAU, 'g', MOV);
    assert.equal(c.origem, 'ponderado');
    assert.equal(c.saldoBase, 7790);
    assert.equal(c.dinheiro, 141.58);
    assert.equal(Math.round(c.custo * 10000) / 10000, 0.0182);
  });

  test('uma promoção isolada NÃO derruba o custo de todas as fichas', () => {
    // É a diferença entre a ponderada e o "último comprado": o pacote de 2,1 kg
    // a 0,0176/g é o mais barato, e sozinho ele puxaria toda receita.
    const c = custoDoGrupo(NESCAU, 'g', MOV);
    const ultimoComprado = 17.5714 / 1000;
    assert.ok(c.custo > ultimoComprado, 'a ponderada fica acima do preço da promoção');
  });

  test('marca com saldo ZERO não entra na média', () => {
    // O pacote de 900 g é o segundo mais caro por grama e tem saldo zero:
    // incluí-lo encareceria um custo de algo que não está na casa.
    const semZerada = NESCAU.filter((m) => m.id !== 'c');
    assert.equal(custoDoGrupo(semZerada, 'g', MOV).custo, custoDoGrupo(NESCAU, 'g', MOV).custo);
  });

  test('ESTOQUE ZERADO NÃO CUSTA ZERO — vale a última compra', () => {
    // ⚠️ 0÷0 devolvendo zero diria "este insumo é de graça", a mesma mentira do
    // produzido que entrava no estoque valendo nada.
    const vazio = NESCAU.map((m) => ({ ...m, estoqueAtual: 0 }));
    const c = custoDoGrupo(vazio, 'g', MOV);
    assert.equal(c.origem, 'ultimaCompra');
    assert.equal(Math.round(c.custo * 10000) / 10000, 0.0176, 'o 2,1kg, comprado em 18/09');
    assert.notEqual(c.custo, 0);
  });

  test('sem saldo e sem compra registrada, cai no preço de catálogo', () => {
    const c = custoDoGrupo([{ id: 'z', nome: 'x', unidade: 'kg', estoqueAtual: 0, ultimoValor: 10 }], 'g', []);
    assert.equal(c.origem, 'catalogo');
    assert.equal(c.custo, 0.01);
  });

  test('grupo vazio devolve null, não zero', () => {
    assert.equal(custoDoGrupo([], 'g', []).custo, null);
    assert.equal(custoDoGrupo([{ id: 'q', unidade: 'kg', estoqueAtual: 0 }], 'g', []).custo, null);
  });
});

describe('a busca que alimenta a ferramenta', () => {
  const DB = {
    materiasPrimas: [
      { id: '1', nome: 'Creme de leite Piracanjuba 200g', unidade: 'un' },
      { id: '2', nome: 'CREME DE LEITE ITALAC 200G', unidade: 'un' },
      { id: '3', nome: 'Creme de leite Frimesa', unidade: 'un' },
      { id: '4', nome: 'Leite condensado Italac', unidade: 'un' },
      { id: '5', nome: 'CREME DE LEITE FATIA', unidade: 'un', codigoEcletica: '141' },
    ],
    produtosLista: [{ id: 'p1', nome: 'Creme de leite 200 g', mpVinculados: ['1'] }],
  };

  test('acha as marcas sem acento e sem caixa', () => {
    const r = buscarMarcas(DB, 'creme de leite', fold);
    assert.deepEqual(r.map((x) => x.mp.id), ['3', '2', '1']);
  });

  test('diz quais já estão num grupo', () => {
    const r = buscarMarcas(DB, 'creme de leite', fold);
    assert.equal(r.find((x) => x.mp.id === '1').grupo.nome, 'Creme de leite 200 g');
    assert.equal(r.find((x) => x.mp.id === '2').grupo, null);
  });

  test('PRODUTO DO CARDÁPIO não aparece para ser agrupado', () => {
    // ⚠️ Ele mora na MESMA coleção que o insumo comprado (§6). Agrupá-lo ligaria
    // a fornada ao saldo do que se compra: o insumo pareceria nunca acabar, e só
    // a contagem física denunciaria.
    const r = buscarMarcas(DB, 'creme de leite', fold);
    assert.ok(!r.some((x) => x.mp.id === '5'));
  });

  test('busca vazia não devolve o catálogo inteiro', () => {
    assert.deepEqual(buscarMarcas(DB, '  ', fold), []);
  });
});

describe('agrupar e desagrupar', () => {
  const DB = {
    materiasPrimas: [
      { id: '1', nome: 'Piracanjuba', unidade: 'un' },
      { id: '2', nome: 'Italac', unidade: 'un' },
      { id: '3', nome: 'Frimesa', unidade: 'un' },
    ],
    produtosLista: [
      { id: 'p1', nome: 'Creme de leite 200 g', mpVinculados: ['1'] },
      { id: 'p2', nome: 'Creme de leite (antigo)', mpVinculados: ['2', '3'] },
    ],
  };

  test('agrupa no produto que já existe e carimba', () => {
    const r = agruparMarcas(DB, { prodId: 'p1', unidadeBase: 'un', mpIds: ['2'] });
    const p1 = r.produtosLista.find((p) => p.id === 'p1');
    assert.deepEqual(p1.mpVinculados, ['1', '2']);
    assert.equal(p1.unidadeBase, 'un');
    assert.ok(p1.atualizadoEm, 'sem carimbo a fusão reverte no poll');
  });

  test('UMA MARCA SÓ PODE ESTAR EM UM GRUPO', () => {
    // ⚠️ Entrando no novo sem sair do antigo, ela seria somada em dois produtos
    // diferentes — e os dois ficariam plausíveis, que é o pior caso.
    const r = agruparMarcas(DB, { prodId: 'p1', unidadeBase: 'un', mpIds: ['2', '3'] });
    assert.deepEqual(r.produtosLista.find((p) => p.id === 'p1').mpVinculados, ['1', '2', '3']);
    assert.deepEqual(r.produtosLista.find((p) => p.id === 'p2').mpVinculados, []);
  });

  test('cria o grupo novo quando não existe', () => {
    const r = agruparMarcas(DB, { nomeNovo: 'Nescau em pó', cat: 'chocolates', unidadeBase: 'g', mpIds: ['1'] });
    const novo = r.produtosLista[0];
    assert.equal(novo.nome, 'Nescau em pó');
    assert.equal(novo.unidadeBase, 'g');
    assert.deepEqual(novo.mpVinculados, ['1']);
    assert.ok(novo.atualizadoEm);
    assert.deepEqual(r.produtosLista.find((p) => p.id === 'p1').mpVinculados, [], 'saiu do antigo');
  });

  test('grava o rendimento declarado de cada marca', () => {
    const r = agruparMarcas(DB, { nomeNovo: 'Nescau', unidadeBase: 'g', mpIds: ['1', '2'], rendimentos: { 1: 395, 2: 0 } });
    assert.equal(r.materiasPrimas.find((m) => m.id === '1').porUnidadeBase, 395);
    assert.equal(r.materiasPrimas.find((m) => m.id === '2').porUnidadeBase, undefined, 'zero não sobrescreve');
  });

  test('sem marca nenhuma não faz nada', () => {
    assert.equal(agruparMarcas(DB, { prodId: 'p1', mpIds: [] }), null);
  });

  test('desagrupar é o inverso, e também carimba', () => {
    const r = desagruparMarca(DB, 'p2', '2');
    const p2 = r.produtosLista.find((p) => p.id === 'p2');
    assert.deepEqual(p2.mpVinculados, ['3']);
    assert.ok(p2.atualizadoEm);
    // A matéria-prima continua existindo, com saldo e histórico.
    assert.ok(!r.materiasPrimas, 'desagrupar não toca em matéria-prima nenhuma');
  });

  test('marcasDoGrupo resolve os ids e ignora o que sumiu', () => {
    const prod = { mpVinculados: ['1', '9', '3'] };
    assert.deepEqual(marcasDoGrupo(DB, prod).map((m) => m.nome), ['Piracanjuba', 'Frimesa']);
    assert.equal(unidadeBaseDo({ unidade: 'kg' }), 'kg');
    assert.equal(unidadeBaseDo({ unidade: 'kg', unidadeBase: 'g' }), 'g');
    assert.equal(unidadeBaseDo(null), 'un');
  });
});

describe('o custo que a ficha lê', () => {
  const N = [
    { id: 'a', nome: 'lata 395g', unidade: 'un', porUnidadeBase: 395, estoqueAtual: 2, ultimoValor: 8.49 },
    { id: 'd', nome: '2,1kg', unidade: 'kg', estoqueAtual: 6.3, ultimoValor: 17.5714 },
  ];

  test('a conversão MULTIPLICA — dividir dá um custo mil vezes menor', () => {
    // ⚠️ custo por kg = custo por g × (quantos g cabem em 1 kg). Invertido, o
    // número continua parecendo um número.
    const porG = custoParaUnidade(N, 'g', 'g', []).valor;
    const porKg = custoParaUnidade(N, 'g', 'kg', []).valor;
    assert.equal(Math.round(porKg * 100) / 100, Math.round(porG * 1000 * 100) / 100);
    assert.ok(porKg > porG, 'o quilo custa mais que o grama');
  });

  test('sem conversão devolve null e o motivo, nunca o número cru', () => {
    // Ficha em "un" com o grupo contando em "g" é cadastro incompleto. Entregar
    // o custo por grama como se fosse por unidade multiplicaria o CMV por mil.
    const r = custoParaUnidade(N, 'g', 'un', []);
    assert.equal(r.valor, null);
    assert.match(r.motivo, /ficha está em "un" e o grupo conta em "g"/);
  });

  test('carrega de onde veio o custo, para a tela avisar', () => {
    assert.equal(custoParaUnidade(N, 'g', 'g', []).origem, 'ponderado');
    const vazio = N.map((m) => ({ ...m, estoqueAtual: 0 }));
    assert.equal(custoParaUnidade(vazio, 'g', 'g', []).origem, 'catalogo');
  });

  test('grupo sem preço nenhum devolve null, não zero', () => {
    assert.equal(custoParaUnidade([], 'g', 'g', []).valor, null);
  });
});

describe('o rateio entre as marcas — cascata da que tem mais saldo', () => {
  const M = [
    { id: 'a', nome: 'lata 395g', unidade: 'un', porUnidadeBase: 395, estoqueAtual: 2, ultimoValor: 8.49 },
    { id: 'b', nome: '2,1kg', unidade: 'kg', estoqueAtual: 6.3, ultimoValor: 17.5714 },
  ];

  test('tira da maior primeiro, e devolve na unidade DA MARCA', () => {
    // 6.300 g na de 2,1 kg contra 790 g nas latas: 500 g saem todos de lá.
    const r = ratearEntreMarcas(M, 500, 'g');
    assert.equal(r.length, 1);
    assert.equal(r[0].mpId, 'b');
    assert.equal(r[0].qtdBase, 500);
    assert.equal(r[0].qtd, 0.5, 'em kg, que é como o saldo dela é contado');
  });

  test('cascateia quando a maior não dá conta', () => {
    const r = ratearEntreMarcas(M, 6500, 'g');
    assert.deepEqual(r.map((x) => x.mpId), ['b', 'a']);
    assert.equal(r[0].qtdBase, 6300);
    assert.equal(r[1].qtdBase, 200);
    assert.equal(r[1].qtd, 0.506, '200 g ÷ 395 g por lata');
    assert.equal(r.reduce((s, x) => s + x.qtdBase, 0), 6500, 'não perde nem inventa grama');
  });

  test('faltando para todo mundo, o resto vai INTEIRO na primeira', () => {
    // ⚠️ Espalhar o negativo entre as marcas faria parecer que todas estão
    // erradas. "Usou sem ter registrado a compra" é a informação honesta.
    const r = ratearEntreMarcas(M, 10000, 'g');
    assert.equal(r.reduce((s, x) => s + x.qtdBase, 0), 10000);
    assert.equal(r.find((x) => x.mpId === 'b').qtdBase, 6300 + 2910);
    assert.equal(r.find((x) => x.mpId === 'a').qtdBase, 790);
  });

  test('estoque zerado em tudo continua baixando, negativo de propósito', () => {
    const zerado = M.map((m) => ({ ...m, estoqueAtual: 0 }));
    const r = ratearEntreMarcas(zerado, 300, 'g');
    assert.equal(r.length, 1);
    assert.equal(r[0].qtdBase, 300);
  });

  test('marca sem rendimento fica de fora do rateio', () => {
    const comSolta = [...M, { id: 'z', nome: 'sachê', unidade: 'un', estoqueAtual: 99 }];
    const r = ratearEntreMarcas(comSolta, 500, 'g');
    assert.ok(!r.some((x) => x.mpId === 'z'), 'não baixa de quem não sabe converter');
  });

  test('sem marca nenhuma devolve vazio, para quem chama avisar', () => {
    assert.deepEqual(ratearEntreMarcas([], 500, 'g'), []);
    assert.deepEqual(ratearEntreMarcas(M, 0, 'g'), []);
  });
});

describe('achar o grupo de um insumo de ficha', () => {
  const DB = {
    materiasPrimas: [{ id: '1', nome: 'Piracanjuba', unidade: 'un' }, { id: '2', nome: 'Italac', unidade: 'un' }],
    produtosLista: [{ id: 'p1', nome: 'Creme de leite', unidadeBase: 'un', mpVinculados: ['1', '2'] }],
  };

  test('pelo prodListaId que a ficha guarda', () => {
    const g = grupoDoInsumo(DB, { prodListaId: 'p1', mpId: '' });
    assert.equal(g.prod.id, 'p1');
    assert.equal(g.marcas.length, 2);
    assert.equal(g.unidadeBase, 'un');
  });

  test('e, na falta dele, pelo grupo em que a marca gravada está', () => {
    // Ficha antiga, feita antes do agrupamento existir: ela só tem `mpId`.
    // Sem este caminho, agrupar não mudaria nada nas fichas já montadas.
    const g = grupoDoInsumo(DB, { mpId: '2' });
    assert.equal(g.prod.id, 'p1');
  });

  test('marca solta não inventa grupo', () => {
    assert.equal(grupoDoInsumo(DB, { mpId: '9' }), null);
    assert.equal(grupoDoInsumo(DB, {}), null);
    assert.equal(grupoDaMarca(DB, '1').id, 'p1');
  });

  test('grupo sem marca nenhuma não conta como grupo', () => {
    const vazio = { ...DB, produtosLista: [{ id: 'p2', nome: 'X', mpVinculados: [] }] };
    assert.equal(grupoDoInsumo(vazio, { prodListaId: 'p2' }), null);
  });
});
