import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  rendimentoDaMarca, ultimaCompra, marcaNoGrupo, custoDoGrupo, saldoDoGrupo,
  buscarMarcas, agruparMarcas, desagruparMarca, marcasDoGrupo, unidadeBaseDo,
  custoParaUnidade, ratearEntreMarcas, grupoDoInsumo, grupoDaMarca, trocarUnidadeBase,
  insumosSemGrupo, agruparPendentes, sugerirGrupo, tokensDoNome, termoDeBusca,
  tamanhoNoNome, sugerirRendimento, gravarRendimentos,
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

describe('trocar a unidade em que o grupo conta', () => {
  const DB = {
    produtosLista: [{ id: 'g', nome: 'Nescau', unidadeBase: 'g', mpVinculados: ['a', 'b'] }],
    materiasPrimas: [
      { id: 'a', nome: 'lata 395g', unidade: 'un', porUnidadeBase: 395, estoqueAtual: 2, ultimoValor: 8.49 },
      { id: 'b', nome: '2,1kg', unidade: 'kg', estoqueAtual: 6.3, ultimoValor: 17.5714 },
    ],
  };

  test('CONVERTE as declarações — senão 900 viraria 900 kg', () => {
    // ⚠️ `porUnidadeBase` é declarado na unidade do GRUPO. Trocando g→kg sem
    // mexer nele, o saldo ficaria mil vezes maior e continuaria plausível.
    const r = trocarUnidadeBase(DB, 'g', 'kg');
    assert.equal(r.materiasPrimas.find((m) => m.id === 'a').porUnidadeBase, 0.395);
    assert.equal(r.produtosLista[0].unidadeBase, 'kg');
    // A marca que não declarava nada continua não declarando: kg→kg sai da
    // conversão de família sozinho.
    assert.equal(r.materiasPrimas.find((m) => m.id === 'b').porUnidadeBase, undefined);
  });

  test('o saldo do grupo continua o mesmo, só muda a régua', () => {
    const antes = saldoDoGrupo(marcasDoGrupo(DB, DB.produtosLista[0]), 'g', []).saldoBase;
    const r = trocarUnidadeBase(DB, 'g', 'kg');
    const dbNovo = { ...DB, produtosLista: r.produtosLista, materiasPrimas: r.materiasPrimas };
    const depois = saldoDoGrupo(marcasDoGrupo(dbNovo, r.produtosLista[0]), 'kg', []).saldoBase;
    assert.equal(antes, 7090);            // 2×395 + 6,3×1000
    assert.equal(depois, 7.09);           // os mesmos, em kg
  });

  test('sem conversão possível, a declaração é APAGADA e vira pendência', () => {
    // ⚠️ Manter um número sem significado é pior que pedir de novo: o grupo
    // continuaria somando com ele.
    const r = trocarUnidadeBase(DB, 'g', 'un');
    assert.deepEqual(r.avisos, ['lata 395g']);
    assert.equal(r.materiasPrimas.find((m) => m.id === 'a').porUnidadeBase, undefined);
  });

  test('trocar para a mesma unidade não mexe em nada', () => {
    const r = trocarUnidadeBase(DB, 'g', 'g');
    assert.deepEqual(r.avisos, []);
    assert.equal(r.materiasPrimas.find((m) => m.id === 'a').porUnidadeBase, 395);
  });

  test('grupo que não existe devolve null', () => {
    assert.equal(trocarUnidadeBase(DB, 'nao-existe', 'kg'), null);
  });
});

// ── A pasta dos insumos comprados sem grupo ─────────────────────────────────
describe('a pasta dos insumos que ainda não foram conciliados', () => {
  const DB = {
    produtosLista: [
      { id: 'p1', nome: 'Creme de leite', mpVinculados: ['ja'] },
      { id: 'p2', nome: 'Leite condensado', mpVinculados: [] },
      { id: 'p3', nome: 'Leite', mpVinculados: [] },
    ],
    materiasPrimas: [
      { id: 'ja', nome: 'CREME DE LEITE PIRACANJUBA 200G', unidade: 'un', estoqueAtual: 12, ultimoValor: 3.20 },
      { id: 'm1', nome: 'CREME DE LEITE ITALAC 200G', unidade: 'un', estoqueAtual: 30, ultimoValor: 2.99 },
      { id: 'm2', nome: 'CREME DE LEITE FRIMESA 200G', unidade: 'un', estoqueAtual: 4, ultimoValor: 3.49 },
      { id: 'm3', nome: 'LEITE CONDENSADO ITALAC 395G', unidade: 'un', estoqueAtual: 6, ultimoValor: 6.50 },
      { id: 'm4', nome: 'DETERGENTE YPE 500ML', unidade: 'un', estoqueAtual: 10, ultimoValor: 2.10, categoria: 'Material de limpeza e higiene' },
      { id: 'cod', nome: 'TORTA BANOFFEE FATIA', codigoEcletica: '141', estoqueAtual: 3 },
      { id: 'prod', nome: 'Frango cremoso', unidade: 'kg', estoqueAtual: 2, ultimoValor: 18 },
    ],
    movEstoque: [
      { mpId: 'm1', tipo: 'entrada', data: '2026-09-18' },
      { mpId: 'm2', tipo: 'entrada', data: '2026-07-02' },
      { mpId: 'm3', tipo: 'entrada', data: '2026-09-19' },
      // ⚠️ Saída não é compra: se contasse, "comprado ontem" viraria "vendido
      // ontem" e a ordem da pasta responderia outra pergunta.
      { mpId: 'm4', tipo: 'saida', data: '2026-09-20' },
    ],
  };
  const tipoDe = (m) => (m.id === 'prod' ? 'produzido' : 'insumo');

  test('o que JÁ tem grupo não aparece', () => {
    const { itens } = insumosSemGrupo(DB, fold, tipoDe);
    assert.ok(!itens.some((i) => i.id === 'ja'));
  });

  test('produto do cardápio e item feito na cozinha ficam FORA, e contados à parte', () => {
    // ⚠️ É o que faz a fila chegar a zero. O banner antigo conta os dois e
    // nunca zera — fila que não zera deixa de ser lida.
    const { itens, fora } = insumosSemGrupo(DB, fold, tipoDe);
    assert.deepEqual(itens.map((i) => i.id), ['m1', 'm2', 'm3', 'm4']);
    assert.deepEqual(fora, { cardapio: 1, produzido: 1 });
  });

  test('mostra o dinheiro parado — é o tamanho do estoque que nenhuma ficha enxerga', () => {
    const { dinheiro } = insumosSemGrupo(DB, fold, tipoDe);
    assert.equal(dinheiro, r2(30 * 2.99 + 4 * 3.49 + 6 * 6.50 + 10 * 2.10));
  });

  test('sem a função de tipo, o produzido entra — o db é que decide, não a pasta', () => {
    const { fora } = insumosSemGrupo(DB, fold, null);
    assert.equal(fora.produzido, 0);
  });

  test('a ordem padrão é a COMPRA mais recente, e quem nunca entrou vai pro fim', () => {
    const { itens } = insumosSemGrupo(DB, fold, tipoDe);
    const [bloco] = agruparPendentes(itens, 'compra');
    assert.deepEqual(bloco.itens.map((i) => i.id), ['m3', 'm1', 'm2', 'm4']);
  });

  test('por nome é alfabético, e por semelhança junta o que divide a primeira palavra', () => {
    const { itens } = insumosSemGrupo(DB, fold, tipoDe);
    // Frimesa antes de Italac, Detergente antes de Leite.
    assert.deepEqual(agruparPendentes(itens, 'nome')[0].itens.map((i) => i.id), ['m2', 'm1', 'm4', 'm3']);

    const blocos = agruparPendentes(itens, 'semelhanca');
    assert.equal(blocos[0].rotulo, 'creme');
    assert.deepEqual(blocos[0].itens.map((i) => i.id), ['m2', 'm1']);
    // ⚠️ Os solitários viram UM bloco no fim. Cinquenta títulos com uma linha
    // embaixo de cada são mais difíceis de ler que a lista simples.
    assert.equal(blocos[1].rotulo, 'sem semelhante na fila');
    assert.deepEqual(blocos[1].itens.map((i) => i.id), ['m4', 'm3']);
  });

  test('a embalagem NÃO entra nas palavras — é ela que difere entre duas marcas', () => {
    assert.deepEqual(tokensDoNome('CREME DE LEITE ITALAC 200G', fold), ['creme', 'leite', 'italac']);
    assert.deepEqual(tokensDoNome('NESCAU 2,1KG', fold), ['nescau']);
  });

  test('o "conciliar" joga UMA palavra na busca, não o nome inteiro', () => {
    // O nome inteiro acha aquele item e mais nenhum — e o ponto é ver as outras
    // marcas do mesmo produto na mesma tela.
    assert.equal(termoDeBusca('CR AVELA NUTELLA 375G', fold), 'avela');
    assert.equal(termoDeBusca('CREME DE LEITE ITALAC 200G', fold), 'creme');
    // Nome que é só embalagem não fica sem termo: cai no nome cru.
    assert.equal(termoDeBusca('2,1kg', fold), '2,1kg');
  });

  test('o palpite de destino escolhe o produto MAIS LONGO que casa', () => {
    // ⚠️ "Leite" também casa em "LEITE CONDENSADO ITALAC". Sem o mais longo
    // vencer, o condensado iria para o grupo do leite e o custo sairia do
    // produto errado — aparecendo só no CMV, meses depois.
    assert.equal(sugerirGrupo(DB, 'LEITE CONDENSADO ITALAC 395G', fold).id, 'p2');
    assert.equal(sugerirGrupo(DB, 'CREME DE LEITE ITALAC 200G', fold).id, 'p1');
  });

  test('palavra parcial não casa, e empate não escolhe', () => {
    // "Leite" não pode casar dentro de "leiteria".
    assert.equal(sugerirGrupo({ produtosLista: [{ id: 'x', nome: 'Leite' }] }, 'LEITERIA SUL', fold), null);
    // Dois nomes do mesmo tamanho casando: a tela fica sem palpite em vez de
    // escolher um em silêncio — a recusa do `acharColunas`.
    const empatado = { produtosLista: [{ id: 'a', nome: 'Suco' }, { id: 'b', nome: 'suco' }] };
    assert.equal(sugerirGrupo(empatado, 'SUCO DE UVA 1L', fold), null);
  });

  test('sem palpite nenhum devolve null, nunca o primeiro da lista', () => {
    assert.equal(sugerirGrupo(DB, 'DETERGENTE YPE 500ML', fold), null);
  });
});

function r2(n) { return Math.round(n * 100) / 100; }

// ── Converter direto na linha que está "sem conversão" ──────────────────────
describe('o tamanho da embalagem que está no nome', () => {
  test('lê o formato normal da nota', () => {
    assert.deepEqual(tamanhoNoNome('ACUCAR TRITURADO ITAMARATI 1KG', fold),
      { multiplicador: 1, quantidade: 1, unidade: 'kg', total: 1 });
    assert.equal(tamanhoNoNome('NESCAU 2,1KG', fold).total, 2.1);
    assert.equal(tamanhoNoNome('CR AVELA NUTELLA 375G', fold).unidade, 'g');
  });

  test('a caixa com N unidades MULTIPLICA', () => {
    // "200X5G" é a caixa de 200 sachês de 5 g. Lendo só o "5G", o grupo somaria
    // 5 gramas onde há mil.
    assert.deepEqual(tamanhoNoNome('ACUCAR REF ITAMARATI SACHET 200X5G', fold),
      { multiplicador: 200, quantidade: 5, unidade: 'g', total: 1000 });
    assert.equal(tamanhoNoNome('açúcar itambarati 1x1kg', fold).total, 1);
  });

  test('vale a ÚLTIMA medida do nome — é onde a embalagem fica', () => {
    assert.equal(tamanhoNoNome('CAFE 3 CORACOES 500G', fold).total, 500);
  });

  test('"1.000G" é mil gramas, não um', () => {
    // Mesma regra do numeroBr da planilha: sem ela o grupo ficaria mil vezes
    // menor, com cara de número certo.
    assert.equal(tamanhoNoNome('ACUCAR 1.000G', fold).total, 1000);
  });

  test('nome sem medida nenhuma não vira palpite', () => {
    assert.equal(tamanhoNoNome('Açucar', fold), null);
    assert.equal(tamanhoNoNome('ACUCAR TRITURADO 2026', fold), null);
  });

  test('o palpite converte para a unidade DO GRUPO', () => {
    const mp = { id: 'x', nome: 'ACUCAR REF ITAMARATI SACHET 200X5G', unidade: 'un' };
    const s = sugerirRendimento(mp, 'kg', fold);
    assert.equal(s.valor, 1);              // 200 × 5 g = 1.000 g = 1 kg
    assert.equal(s.total, 1000);
    assert.equal(sugerirRendimento(mp, 'g', fold).valor, 1000);
  });

  test('marca que JÁ sabe converter não recebe palpite', () => {
    // Palpitar por cima de um cadastro existente troca um número certo por um
    // plausível.
    assert.equal(sugerirRendimento({ nome: 'Nescau lata 395g', unidade: 'un', porUnidadeBase: 395 }, 'g', fold), null);
    // E a marca em kg num grupo em kg converte sozinha — não é pendência.
    assert.equal(sugerirRendimento({ nome: 'açúcar 1kg', unidade: 'kg' }, 'kg', fold), null);
  });

  test('sem conversão possível entre as duas unidades, não há palpite', () => {
    // Grupo contando em "un" e nome em gramas: não é conversão, é cadastro.
    assert.equal(sugerirRendimento({ nome: 'ACUCAR 1KG', unidade: 'un' }, 'un', fold), null);
  });
});

describe('gravar as conversões de uma vez', () => {
  const DB = { materiasPrimas: [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }, { id: 'c', nome: 'C' }] };

  test('grava só o que foi preenchido, e carimba', () => {
    const r = gravarRendimentos(DB, { a: '1', b: '', c: 0.5 });
    assert.equal(r.quantas, 2);
    assert.equal(r.materiasPrimas.find((m) => m.id === 'a').porUnidadeBase, 1);
    assert.equal(r.materiasPrimas.find((m) => m.id === 'c').porUnidadeBase, 0.5);
    assert.ok(r.materiasPrimas.find((m) => m.id === 'a').atualizadoEm);
    // ⚠️ Campo em branco é "ainda não sei". Gravado como zero, a marca renderia
    // nada e sumiria da soma parecendo resolvida.
    assert.equal(r.materiasPrimas.find((m) => m.id === 'b').porUnidadeBase, undefined);
  });

  test('aceita vírgula, como todo campo de número do app', () => {
    assert.equal(gravarRendimentos(DB, { a: '2,1' }).materiasPrimas[0].porUnidadeBase, 2.1);
  });

  test('nada preenchido não grava nada', () => {
    assert.equal(gravarRendimentos(DB, { a: '', b: '0' }), null);
  });
});
