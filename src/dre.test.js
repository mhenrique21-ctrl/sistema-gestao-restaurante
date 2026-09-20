import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fatiasDaReceita, conferirCmv, diasNoIntervalo, mesDaData, porDia } from './dre.js';

// O período real do dono, 14–19/09/2026, lido do print da DRE.
const REAL = {
  vendasBrutas: 29128.20,
  despVendas: 3347.14,
  totalCMV: 0,
  totalDesp: 10009.49,
  imposto: 1747.69,
  lucroLiq: 14023.88,
};

describe('as fatias da barra', () => {
  test('as larguras fecham 100% EXATO', () => {
    // ⚠️ A barra é a única parte da tela lida como proporção. A versão antiga
    // somava cinco porcentagens em separado e precisava de uma linha
    // "restante não alocado" — ela já sabia que não fechava.
    const r = fatiasDaReceita(REAL);
    const soma = r.fatias.reduce((s, f) => s + f.largura, 0) + r.sobra.largura;
    assert.equal(soma, 100);
  });

  test('cada fatia é a porcentagem da RECEITA BRUTA', () => {
    const r = fatiasDaReceita(REAL);
    const p = Object.fromEntries(r.fatias.map((f) => [f.chave, f.pct]));
    assert.equal(p.taxa, 11.49);
    assert.equal(p.cmv, 0);
    assert.equal(p.despesa, 34.36);
    assert.equal(p.imposto, 6);
    assert.equal(r.sobra.pct, 48.15);
  });

  test('o CMV zerado deixa a fatia com largura ZERO, não some da lista', () => {
    // Sumindo, a barra pareceria completa e ninguém notaria o buraco — que é
    // justamente o que precisa ser notado.
    const r = fatiasDaReceita(REAL);
    const cmv = r.fatias.find((f) => f.chave === 'cmv');
    assert.equal(cmv.largura, 0);
    assert.equal(r.fatias.length, 4);
  });

  test('PREJUÍZO não encolhe a barra: os custos preenchem e o que faltou é escrito', () => {
    // ⚠️ Desenhar 130% de custo numa barra de 100% mostraria uma sobra que não
    // existe. No negativo a régua passa a ser o custo total.
    const r = fatiasDaReceita({ vendasBrutas: 1000, despVendas: 100, totalCMV: 400, totalDesp: 600, imposto: 60, lucroLiq: -160 });
    assert.equal(r.negativo, true);
    assert.equal(r.faltou, 160);
    assert.equal(r.sobra.largura, 0);
    assert.equal(r.fatias.reduce((s, f) => s + f.largura, 0), 100);
    // A porcentagem CONTINUA sendo sobre a receita — é ela que diz "gastei 60%
    // do faturamento em despesa".
    assert.equal(r.fatias.find((f) => f.chave === 'despesa').pct, 60);
  });

  test('período sem venda nenhuma não divide por zero', () => {
    const r = fatiasDaReceita({ vendasBrutas: 0, despVendas: 0, totalCMV: 0, totalDesp: 500, imposto: 0, lucroLiq: -500 });
    assert.equal(r.base, 0);
    assert.ok(r.fatias.every((f) => f.pct === 0 && f.largura === 0));
  });
});

describe('dá para confiar no CMV deste recorte?', () => {
  const COMPRAS = [
    { data: '2026-09-02', valor: 1200 },
    { data: '2026-09-08', valor: 2000 },
    { data: '2026-09-08', valor: 525.82 },
    { data: '2026-10-01', valor: 900 },
  ];

  test('recorte SEM compra nenhuma vira AVISO', () => {
    // ⚠️ É o caso do dono: CMV zero faz o Lucro Bruto sair igual à Receita
    // Líquida e a tela anunciar 48% de margem.
    const r = conferirCmv(COMPRAS, '2026-09-14', '2026-09-19');
    assert.equal(r.nivel, 'aviso');
    assert.equal(r.total, 0);
    assert.equal(r.totalMes, 3725.82);
    assert.equal(r.ofereceMes, true);
  });

  test('recorte curto COM compra é só uma nota', () => {
    // Gritar nos dois casos é o jeito de ninguém mais ler nenhum aviso.
    const r = conferirCmv(COMPRAS, '2026-09-05', '2026-09-10');
    assert.equal(r.nivel, 'nota');
    assert.equal(r.total, 2525.82);
    assert.equal(r.diasComCompra, 1);
  });

  test('o mês inteiro não avisa nada', () => {
    const r = conferirCmv(COMPRAS, '2026-09-01', '2026-09-30');
    assert.equal(r.nivel, 'nenhum');
    assert.equal(r.total, 3725.82);
    // Nada a oferecer: o recorte JÁ é o mês.
    assert.equal(r.ofereceMes, false);
  });

  test('recorte que atravessa meses não oferece "o mês"', () => {
    // Não existe "o mês" de 25/09 a 05/10 — oferecer um deles escolheria por
    // conta própria qual, e o número sairia de um recorte que ninguém pediu.
    const r = conferirCmv(COMPRAS, '2026-09-25', '2026-10-05');
    assert.equal(r.mesRef, null);
    assert.equal(r.ofereceMes, false);
  });
});

describe('datas', () => {
  test('conta os dois extremos', () => {
    assert.equal(diasNoIntervalo('2026-09-14', '2026-09-19'), 6);
    assert.equal(diasNoIntervalo('2026-09-14', '2026-09-14'), 1);
    assert.equal(diasNoIntervalo('2026-09-19', '2026-09-14'), 0);
  });

  test('o mês vai do dia 1 ao último, em UTC', () => {
    // ⚠️ Lido como hora local, o dia 1º viraria o último do mês anterior (§7).
    assert.deepEqual(mesDaData('2026-09-20'), { inicio: '2026-09-01', fim: '2026-09-30' });
    assert.deepEqual(mesDaData('2026-02-10'), { inicio: '2026-02-01', fim: '2026-02-28' });
    assert.deepEqual(mesDaData('2024-02-10'), { inicio: '2024-02-01', fim: '2024-02-29' });
    assert.equal(mesDaData(''), null);
  });

  test('por dia compara recortes de tamanhos diferentes', () => {
    assert.equal(porDia(14023.88, '2026-09-14', '2026-09-19'), 2337.31);
    assert.equal(porDia(100, '2026-09-19', '2026-09-14'), 0);
  });
});
