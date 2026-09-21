import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  rotuloDelivery, ROTULO_DELIVERY, LEGADO_ROTULO_DELIVERY,
  bucketDoRecibo, BUCKET_RECIBO_BALCAO, BUCKET_RECIBO_ENCOMENDA,
  taxasDePlataforma, statusDoDia, progressoDoDia, serieDosDias, mediaDaSerie,
  HORA_PENDENCIA_PADRAO,
} from './fechamentoVendas.js';

describe('o nome do canal de delivery', () => {
  test('o padrão antigo é traduzido na leitura', () => {
    // ⚠️ `setAj` congela TODOS os defaults no `db` na primeira vez que a pessoa
    // mexe em qualquer ajuste, então trocar só o default deixaria o nome antigo
    // em quem já abriu a tela de Ajustes uma vez.
    assert.equal(rotuloDelivery({ legVendasExtras: LEGADO_ROTULO_DELIVERY }), ROTULO_DELIVERY);
    assert.equal(rotuloDelivery({}), ROTULO_DELIVERY);
    assert.equal(rotuloDelivery(null), ROTULO_DELIVERY);
    assert.equal(rotuloDelivery({ legVendasExtras: '   ' }), ROTULO_DELIVERY);
  });

  test('rótulo que a pessoa escolheu de verdade sobrevive', () => {
    // Traduzir na leitura em vez de migrar o dado é o que salva este caso.
    assert.equal(rotuloDelivery({ legVendasExtras: 'Balcão 2' }), 'Balcão 2');
    assert.equal(rotuloDelivery({ legVendasExtras: 'Delivery' }), 'Delivery');
  });
});

describe('onde o recibo cai', () => {
  test('balcão e encomenda vão para buckets diferentes', () => {
    assert.equal(bucketDoRecibo('venda'), BUCKET_RECIBO_BALCAO);
    assert.equal(bucketDoRecibo(undefined), BUCKET_RECIBO_BALCAO);
    assert.equal(bucketDoRecibo('producao'), BUCKET_RECIBO_ENCOMENDA);
  });

  test('o recibo de balcão NÃO cai mais em delivery', () => {
    // ⚠️ Somados, "Delivery" no Dashboard incluía venda que não foi entregue a
    // ninguém — e não havia como separar depois, porque o campo era um só.
    assert.notEqual(bucketDoRecibo('venda'), 'delivery');
  });
});

describe('TAREFA 3 · a taxa das plataformas não pode mudar', () => {
  // O dia real do dono, 16/09/2026: bruto 879,18 · líquido 584,44.
  const VENDAS = [
    { data: '2026-09-16', ifood: 879.18, ifoodLiq: 584.44, '99food': 0, nfoodLiq: 0 },
    { data: '2026-09-17', ifood: 0, ifoodLiq: 0, '99food': 500, nfoodLiq: 400 },
    // Lançamento sem líquido gravado: a taxa dele é ZERO, não o bruto inteiro.
    { data: '2026-09-18', ifood: 300, '99food': 200 },
    { data: '2026-09-30', ifood: 1000, ifoodLiq: 0 },
  ];

  test('soma (bruto − líquido) dos dois canais', () => {
    const r = taxasDePlataforma(VENDAS, '2026-09-16', '2026-09-18');
    assert.equal(r.ifood, 294.74);
    assert.equal(r.nfood, 100);
    assert.equal(r.total, 394.74);
  });

  test('sem líquido gravado a taxa é ZERO, nunca o bruto', () => {
    // ⚠️ Trocando `?? v.ifood` por `|| 0`, a DRE mostraria o faturamento do
    // iFood inteiro como despesa.
    const r = taxasDePlataforma([VENDAS[2]], '2026-09-18', '2026-09-18');
    assert.equal(r.total, 0);
  });

  test('líquido ZERO gravado é despesa cheia — e é diferente de não ter líquido', () => {
    const r = taxasDePlataforma([VENDAS[3]], '2026-09-30', '2026-09-30');
    assert.equal(r.total, 1000);
  });

  test('o recorte respeita as duas pontas', () => {
    assert.equal(taxasDePlataforma(VENDAS, '2026-09-17', '2026-09-17').total, 100);
    assert.equal(taxasDePlataforma(VENDAS, '2026-10-01', '2026-10-31').total, 0);
    // Sem recorte, tudo.
    assert.equal(taxasDePlataforma(VENDAS).total, 1394.74);
  });

  test('nenhum campo novo do fechamento entra na conta', () => {
    // A blindagem: delivery, recibo de balcão e entrega de encomenda NÃO são
    // taxa de plataforma. Se um dia alguém somá-los aqui, a DRE passa a cobrar
    // taxa de um canal que não tem comissão.
    const comNovos = [{ data: '2026-09-16', ifood: 879.18, ifoodLiq: 584.44,
      delivery: 296.65, recibosBalcao: 462, entregasClientes: 120, maquininha: 2494.95, dinheiro: 234.89 }];
    assert.equal(taxasDePlataforma(comNovos).total, 294.74);
  });
});

describe('TAREFA 2 · loja fechada não é pendência', () => {
  const base = { data: '2026-09-20', hoje: '2026-09-21', faltando: ['99Food'], temAlgumValor: true };

  test('o marcador da pessoa vence qualquer heurística', () => {
    const r = statusDoDia({ ...base, semMovimento: true });
    assert.equal(r.status, 'fechado');
    assert.equal(r.cor, 'cinza');
  });

  test('nada faltando é dia completo', () => {
    assert.equal(statusDoDia({ ...base, faltando: [] }).status, 'completo');
  });

  test('ANTES da hora limite é "aguardando", não pendência', () => {
    // ⚠️ Sem a hora, a tela acusaria o iFood às 9h da manhã, todo dia.
    const r = statusDoDia({ ...base, data: '2026-09-21', hora: 9 });
    assert.equal(r.status, 'aguardando');
    assert.equal(r.cor, 'neutro');
  });

  test('DEPOIS da hora limite, no mesmo dia, é pendência real', () => {
    const r = statusDoDia({ ...base, data: '2026-09-21', hora: 22 });
    assert.equal(r.status, 'pendente');
    assert.equal(r.rotulo, '1 pendência');
    assert.equal(r.cor, 'ambar');
  });

  test('a hora limite é configurável', () => {
    assert.equal(statusDoDia({ ...base, data: '2026-09-21', hora: 19 }).status, 'aguardando');
    assert.equal(statusDoDia({ ...base, data: '2026-09-21', hora: 19, horaLimite: 18 }).status, 'pendente');
    assert.equal(HORA_PENDENCIA_PADRAO, 21);
  });

  test('dia PASSADO é pendência independente da hora', () => {
    const r = statusDoDia({ ...base, hora: 3 });
    assert.equal(r.status, 'pendente');
  });

  test('dia FUTURO nunca é pendência', () => {
    const r = statusDoDia({ ...base, data: '2026-09-25', hora: 23 });
    assert.equal(r.status, 'aguardando');
  });

  test('dia sem valor NENHUM oferece o marcador em vez de listar 5 pendências', () => {
    // É o candidato a "esqueci de marcar que fechou", não a "faltou um canal".
    const r = statusDoDia({ ...base, temAlgumValor: false, faltando: ['a', 'b', 'c', 'd', 'e'] });
    assert.equal(r.status, 'vazio');
    assert.equal(r.ofereceFechado, true);
    assert.equal(r.rotulo, 'Nenhum lançamento');
  });
});

describe('o progresso do dia', () => {
  const cards = [
    { label: 'Maquininha', temValor: true },
    { label: 'Dinheiro', temValor: true },
    { label: 'iFood', temValor: true },
    { label: '99Food', temValor: false },
    { label: 'Delivery', temValor: true },
  ];

  test('conta canal, e diz o que falta pelo nome', () => {
    const p = progressoDoDia(cards);
    assert.equal(p.feitos, 4);
    assert.equal(p.total, 5);
    assert.equal(p.pct, 80);
    assert.deepEqual(p.faltando, ['99Food']);
  });

  test('canal DESLIGADO em Ajustes sai da conta', () => {
    // ⚠️ Senão o progresso nunca fecharia numa loja que não usa 99Food, e
    // "4/5" viraria um número que não chega a 5 nunca.
    const p = progressoDoDia(cards.map((c) => c.label === '99Food' ? { ...c, ativo: false } : c));
    assert.equal(p.feitos, 4);
    assert.equal(p.total, 4);
    assert.equal(p.pct, 100);
    assert.deepEqual(p.faltando, []);
  });

  test('sem card nenhum não divide por zero', () => {
    assert.deepEqual(progressoDoDia([]), { feitos: 0, total: 0, pct: 0, faltando: [] });
  });
});

describe('a série dos últimos dias', () => {
  const VENDAS = [
    { data: '2026-09-19', total: 3873.6 },
    { data: '2026-09-19', total: 100 },   // outra origem no MESMO dia: soma
    { data: '2026-09-18', total: 5001.53 },
    { data: '2026-09-15', total: 4590.29 },
  ];

  test('soma todas as origens do dia e devolve a janela inteira', () => {
    const s = serieDosDias(VENDAS, '2026-09-21', 7);
    assert.equal(s.length, 7);
    assert.equal(s[0].data, '2026-09-15');
    assert.equal(s[6].data, '2026-09-21');
    assert.equal(s.find((d) => d.data === '2026-09-19').total, 3973.6);
  });

  test('dia sem venda entra como ZERO, não sai da série', () => {
    // ⚠️ Fora dela, a linha ligaria sexta direto em domingo e o desenho
    // mentiria sobre o ritmo da semana.
    const s = serieDosDias(VENDAS, '2026-09-21', 7);
    assert.equal(s.find((d) => d.data === '2026-09-20').total, 0);
    assert.equal(s.find((d) => d.data === '2026-09-16').total, 0);
  });

  test('a média conta só os dias que venderam', () => {
    // Incluindo os fechados, "média/dia" mediria quantos domingos caíram na semana.
    const s = serieDosDias(VENDAS, '2026-09-21', 7);
    assert.equal(mediaDaSerie(s), 4521.81); // (3973,60 + 5001,53 + 4590,29) ÷ 3
    assert.equal(mediaDaSerie([{ data: 'x', total: 0 }]), 0);
    assert.equal(mediaDaSerie([]), 0);
  });

  test('data inválida devolve série vazia', () => {
    assert.deepEqual(serieDosDias(VENDAS, '', 7), []);
    assert.deepEqual(serieDosDias(VENDAS, '2026-09-21', 0), []);
  });
});
