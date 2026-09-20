import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canaisDaVenda, diasDoPeriodo, periodoAnterior, resumoPeriodo,
  formasDoPeriodo, porDiaDaSemana, porMes, compararPeriodos, CANAIS,
} from './relatorioPeriodo.js';

// O dia 17/09/2026 da Confraria, como o Histórico mostrou: três origens
// coexistindo no mesmo dia, que é a regra do §6.
const DIA_17 = [
  { data: '2026-09-17', origem: 'pdv_ecletica', total: 2825.32,
    dinheiro: 117, maquininha: 2626.08,
    formas: { dinheiro: 117, credito: 2282.79, pix: 343.29, pendura: 82.24 } },
  { data: '2026-09-17', origem: 'manual', total: 174.42, delivery: 174.42 },
  { data: '2026-09-17', origem: 'relatorio_99food', total: 223.49,
    '99food': 334.40, nfoodTaxa: 33.17, nfoodLiq: 223.49 },
];

describe('o balcão é maquininha + dinheiro + PENDURA', () => {
  test('o PIX está DENTRO da maquininha — somar as formas contaria em dobro', () => {
    // Medido no dado real: maquininha 2.626,08 = crédito 2.282,79 + PIX 343,29.
    const v = DIA_17[0];
    assert.equal(v.formas.credito + v.formas.pix, v.maquininha);
    assert.equal(canaisDaVenda(v).balcao, 2825.32);
    assert.notEqual(canaisDaVenda(v).balcao, 2825.32 + 343.29, 'PIX não entra duas vezes');
  });

  test('sem a pendura o balcão não fecha com o total do dia', () => {
    // ⚠️ R$ 82,24 num dia só, e nada na tela denunciaria.
    const semPendura = { ...DIA_17[0], formas: { ...DIA_17[0].formas, pendura: 0 } };
    assert.equal(canaisDaVenda(semPendura).balcao, 2743.08);
    assert.equal(canaisDaVenda(DIA_17[0]).balcao, DIA_17[0].total, 'com pendura, fecha');
  });

  test('na plataforma o canal é o LÍQUIDO, e o bruto fica à parte', () => {
    const c = canaisDaVenda(DIA_17[2]);
    assert.equal(c.nfood, 223.49);
    assert.notEqual(c.nfood, 334.40, 'o bruto não entra no faturamento');
  });

  test('lançamento sem campo nenhum não inventa canal', () => {
    assert.deepEqual(canaisDaVenda(null), { balcao: 0, extras: 0, entregas: 0, ifood: 0, nfood: 0 });
    assert.deepEqual(canaisDaVenda({ total: 100 }).balcao, 0, 'total sozinho não vira balcão');
  });
});

describe('o resíduo aparece em vez de sumir', () => {
  test('o dia 17/09 fecha canal a canal', () => {
    const r = resumoPeriodo(DIA_17, '2026-09-17', '2026-09-17');
    assert.equal(r.total, 3223.23);
    assert.equal(r.canais.balcao, 2825.32);
    assert.equal(r.canais.extras, 174.42);
    assert.equal(r.canais.nfood, 223.49);
    assert.equal(r.naoClassificado, 0);
    assert.equal(r.bruto.nfood, 334.40, 'o bruto continua disponível');
  });

  test('valor num campo que nenhum canal lê vira "não classificado"', () => {
    // ⚠️ Espalhar a diferença pelos canais — ou usar a soma deles como total —
    // esconderia para sempre um campo novo que alguém esqueceu de mapear.
    const r = resumoPeriodo([{ data: '2026-09-17', total: 500, dinheiro: 300 }], '2026-09-17', '2026-09-17');
    assert.equal(r.canais.balcao, 300);
    assert.equal(r.naoClassificado, 200);
  });
});

describe('o período anterior tem o MESMO número de dias', () => {
  test('20 dias comparam com 20 dias, terminando na véspera', () => {
    // ⚠️ Comparar 01–20/09 com agosto inteiro mostraria uma queda de 35% que é
    // só o calendário — e é o tipo de número que vira decisão errada.
    assert.deepEqual(periodoAnterior('2026-09-01', '2026-09-20'),
      { ini: '2026-08-12', fim: '2026-08-31', dias: 20 });
  });

  test('vira o mês e o ano sem inventar dia', () => {
    assert.deepEqual(periodoAnterior('2026-01-01', '2026-01-07'),
      { ini: '2025-12-25', fim: '2025-12-31', dias: 7 });
    assert.deepEqual(periodoAnterior('2026-03-01', '2026-03-01'),
      { ini: '2026-02-28', fim: '2026-02-28', dias: 1 });
  });

  test('o período conta em UTC — senão anda um dia inteiro', () => {
    // O Amapá é UTC−3: lido como hora local, 2026-09-01 cai em 31/08 às 21h.
    assert.equal(diasDoPeriodo('2026-09-01', '2026-09-20').length, 20);
    assert.equal(diasDoPeriodo('2026-09-01', '2026-09-20')[0], '2026-09-01');
    assert.deepEqual(diasDoPeriodo('2026-09-20', '2026-09-01'), [], 'fim antes do início');
    assert.deepEqual(diasDoPeriodo('', '2026-09-01'), []);
  });
});

describe('a cobertura faz parte do número', () => {
  test('a quebra por forma cobre só o que o PDV apurou', () => {
    // ⚠️ Sem isto, a barra de formas pareceria o período inteiro — e "quase
    // tudo é crédito" seria uma conclusão sobre outro conjunto de vendas.
    const f = formasDoPeriodo(DIA_17, '2026-09-17', '2026-09-17');
    assert.equal(f.totalPeriodo, 3223.23);
    assert.equal(f.coberto, 2825.32);
    assert.equal(f.semQuebra, 397.91);
    assert.equal(f.pctCobertura, 87.65);
    assert.equal(f.diasComQuebra, 1);
  });

  test('pendura sai do "entrou em caixa"', () => {
    // Está no total e fora de dinheiro e maquininha: é venda fiada. Somada ali,
    // o caixa do dia sobraria R$ 82,24.
    const f = formasDoPeriodo(DIA_17, '2026-09-17', '2026-09-17');
    assert.equal(f.pendura, 82.24);
    assert.equal(f.emCaixa, 2743.08);
  });

  test('período sem PDV nenhum: cobertura zero, não divisão por zero', () => {
    const f = formasDoPeriodo([{ data: '2026-09-17', total: 100, delivery: 100 }], '2026-09-17', '2026-09-17');
    assert.equal(f.coberto, 0);
    assert.equal(f.pctCobertura, 0);
    assert.equal(f.semQuebra, 100);
  });
});

describe('dia da semana: a média divide pelos dias ABERTOS', () => {
  test('domingo fechado não vira "domingo vende pouco"', () => {
    // ⚠️ Dividindo pelas ocorrências, dois domingos fechados puxariam a média do
    // domingo para perto de zero — e a leitura seria sobre o produto, não sobre
    // a loja estar fechada.
    const vendas = [
      { data: '2026-09-07', total: 1000, dinheiro: 1000 },   // segunda
      { data: '2026-09-14', total: 1400, dinheiro: 1400 },   // segunda
      { data: '2026-09-12', total: 900, dinheiro: 900 },     // sábado
    ];
    const linhas = porDiaDaSemana(resumoPeriodo(vendas, '2026-09-06', '2026-09-19'));
    const seg = linhas[1], dom = linhas[0];
    assert.equal(seg.total, 2400);
    assert.equal(seg.abertos, 2);
    assert.equal(seg.media, 1200);
    assert.equal(dom.dias, 2, 'os dois domingos estão no período');
    assert.equal(dom.abertos, 0);
    assert.equal(dom.media, 0, 'sem dia aberto, não se inventa média');
  });

  test('a segunda é a segunda — em UTC', () => {
    const linhas = porDiaDaSemana(resumoPeriodo(
      [{ data: '2026-09-07', total: 500, dinheiro: 500 }], '2026-09-07', '2026-09-07'));
    assert.equal(linhas[1].nome, 'Segunda');
    assert.equal(linhas[1].total, 500);
    assert.equal(linhas[0].total, 0, 'não escorregou para domingo');
  });
});

describe('mês a mês — lê o histórico inteiro, de propósito', () => {
  test('é a única visão que responde "e antes disso?"', () => {
    const vendas = [
      { data: '2026-07-10', total: 100 }, { data: '2026-07-20', total: 50 },
      { data: '2026-08-02', total: 300 }, { data: '2026-09-01', total: 200 },
      { data: 'lixo', total: 999 },
    ];
    assert.deepEqual(porMes(vendas, 6), [
      { mes: '2026-07', total: 150 }, { mes: '2026-08', total: 300 }, { mes: '2026-09', total: 200 },
    ]);
    assert.equal(porMes(vendas, 2).length, 2, 'os últimos N');
  });
});

describe('a comparação', () => {
  const vendas = [
    { data: '2026-09-17', total: 1000, dinheiro: 1000 },
    { data: '2026-09-18', total: 500, delivery: 500 },
    { data: '2026-09-15', total: 800, dinheiro: 800 },
    { data: '2026-09-16', total: 200, ifood: 300, ifoodLiq: 200 },
  ];

  test('canal a canal, contra os mesmos dois dias de antes', () => {
    const c = compararPeriodos(vendas, '2026-09-17', '2026-09-18');
    assert.equal(c.anterior.ini, '2026-09-15');
    assert.equal(c.anterior.fim, '2026-09-16');
    assert.equal(c.atual.total, 1500);
    assert.equal(c.anterior.total, 1000);
    assert.equal(c.delta.pct, 50);
    assert.equal(c.delta.canais.balcao.pct, 25);      // 1000 contra 800
  });

  test('canal que NASCEU no período não é "infinito%" nem "0%"', () => {
    // ⚠️ O primeiro enche a tela de lixo; o segundo esconde um canal novo.
    // `null` deixa a tela escrever "novo".
    const c = compararPeriodos(vendas, '2026-09-17', '2026-09-18');
    assert.equal(c.delta.canais.extras.anterior, 0);
    assert.equal(c.delta.canais.extras.atual, 500);
    assert.equal(c.delta.canais.extras.pct, null);
    assert.equal(c.delta.canais.ifood.pct, -100, 'canal que sumiu é −100%, esse existe');
  });

  test('dias sem lançamento nenhum são listados, não somem', () => {
    const r = resumoPeriodo(vendas, '2026-09-15', '2026-09-20');
    assert.deepEqual(r.semLancamento, ['2026-09-19', '2026-09-20']);
    assert.equal(r.diasComVenda, 4);
    assert.equal(r.dias, 6);
    assert.equal(r.mediaDia, 416.67, 'sobre os 6 dias do período');
    assert.equal(r.mediaDiaAberto, 625, 'sobre os 4 que tiveram venda');
    assert.deepEqual(r.melhorDia, { data: '2026-09-17', total: 1000 });
  });

  test('todos os canais do CANAIS aparecem no delta, mesmo zerados', () => {
    // A tela pinta a cor pela POSIÇÃO na lista: um canal que some do objeto
    // faria os seguintes andarem uma cor.
    const c = compararPeriodos(vendas, '2026-09-17', '2026-09-18');
    for (const { k } of CANAIS) assert.ok(c.delta.canais[k], `falta ${k}`);
  });
});
