import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  configDoCiclo, diaDaCompra, ultimoCorte, proximoCorte, nomeDaCompra,
  cicloAtual, ehDiaFechado, emBelem, FUSO, HORA_CORTE,
} from './listaCiclo.js';

// Belém é UTC−3 o ano inteiro (sem horário de verão — conferido em janeiro e
// julho). Então 12:00 na loja é 15:00 UTC, e é assim que os instantes abaixo
// estão escritos: o teste tem que falar do relógio da LOJA, não do servidor.
const belem = (data, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...data.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), h + 3, m, 0));
};

// A semana de referência, conferida: 24/10/2026 é sábado.
const SAB = '2026-10-24', DOM = '2026-10-25', SEG = '2026-10-26';
const TER = '2026-10-27', QUA = '2026-10-28', QUI = '2026-10-29';

const padrao = configDoCiclo({});

describe('o relógio é o de Belém, não o do servidor', () => {
  test('12:00 na loja é 15:00 UTC', () => {
    assert.equal(emBelem(belem(SAB, '12:00')).hora, 12);
    assert.equal(belem(SAB, '12:00').toISOString(), '2026-10-24T15:00:00.000Z');
  });

  test('a semana de referência é a que o teste diz que é', () => {
    assert.equal(emBelem(belem(SAB, '09:00')).diaSemana, 6, 'sábado');
    assert.equal(emBelem(belem(DOM, '09:00')).diaSemana, 0, 'domingo');
    assert.equal(emBelem(belem(SEG, '09:00')).diaSemana, 1, 'segunda');
  });

  test('Belém não tem horário de verão — o corte não anda no meio do ano', () => {
    // ⚠️ Se um dia voltar, é este teste que avisa: um `-3` cravado erraria uma
    // hora durante meses sem nada denunciando.
    for (const d of ['2026-01-15', '2026-07-15', '2026-12-15']) {
      assert.equal(emBelem(belem(d, '12:00')).hora, 12, `${d} saiu fora das 12h`);
    }
  });
});

// ── Os casos que o dono pediu, um a um ──────────────────────────────────────
describe('domingo não tem corte: sábado 12h vai até segunda 12h', () => {
  const compra = (data, hora) => diaDaCompra(belem(data, hora), padrao);

  test('sábado 11:59 → compra de SÁBADO', () => {
    assert.equal(compra(SAB, '11:59'), SAB);
  });

  test('sábado 12:00 → compra de SEGUNDA', () => {
    // O corte do sábado abre um ciclo que não encontra corte no domingo.
    assert.equal(compra(SAB, '12:00'), SEG);
  });

  test('domingo 15:00 → SEGUNDA', () => {
    assert.equal(compra(DOM, '15:00'), SEG);
  });

  test('segunda 11:59 → SEGUNDA', () => {
    assert.equal(compra(SEG, '11:59'), SEG);
  });

  test('segunda 12:00 → TERÇA', () => {
    assert.equal(compra(SEG, '12:00'), TER);
  });

  test('domingo de manhã também é segunda — dia fechado não tem corte', () => {
    // Antes das 12h o dia da compra seria "hoje"; hoje está fechado, então anda.
    assert.equal(compra(DOM, '08:00'), SEG);
    assert.equal(compra(DOM, '23:59'), SEG);
  });

  test('o ciclo de sábado 12h termina na segunda 12h, inteiro', () => {
    for (const [d, h] of [[SAB, '12:00'], [SAB, '18:00'], [DOM, '03:00'], [DOM, '15:00'], [SEG, '11:59']]) {
      const t = belem(d, h);
      assert.equal(ultimoCorte(t, padrao).toISOString(), belem(SAB, '12:00').toISOString(), `${d} ${h}: abertura`);
      assert.equal(proximoCorte(t, padrao).toISOString(), belem(SEG, '12:00').toISOString(), `${d} ${h}: fechamento`);
    }
  });
});

describe('feriado numa quarta pula para quinta', () => {
  const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });

  test('terça 12:00 → QUINTA, porque quarta é feriado', () => {
    assert.equal(diaDaCompra(belem(TER, '12:00'), cfg), QUI);
  });

  test('a própria quarta, de manhã, também já é quinta', () => {
    assert.equal(diaDaCompra(belem(QUA, '09:00'), cfg), QUI);
  });

  test('o ciclo da terça 12h vai até quinta 12h', () => {
    const t = belem(QUA, '20:00');
    assert.equal(ultimoCorte(t, cfg).toISOString(), belem(TER, '12:00').toISOString());
    assert.equal(proximoCorte(t, cfg).toISOString(), belem(QUI, '12:00').toISOString());
  });

  test('sem o feriado configurado, quarta é dia normal', () => {
    assert.equal(diaDaCompra(belem(TER, '12:00'), padrao), QUA);
  });
});

describe('as três contas não podem divergir', () => {
  test('o dia da compra é SEMPRE o dia do próximo corte', () => {
    // ⚠️ É a invariante que impede a tela dizer "compra de segunda" com o
    // servidor cortando na terça. Varre a semana inteira, de hora em hora.
    const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });
    for (const d of [SAB, DOM, SEG, TER, QUA, QUI]) {
      for (let h = 0; h < 24; h++) {
        const t = belem(d, `${String(h).padStart(2, '0')}:00`);
        assert.equal(diaDaCompra(t, cfg), emBelem(proximoCorte(t, cfg)).data, `${d} ${h}h`);
      }
    }
  });

  test('agora está sempre dentro do ciclo: ultimoCorte ≤ agora < proximoCorte', () => {
    const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });
    for (const d of [SAB, DOM, SEG, TER, QUA, QUI]) {
      for (let h = 0; h < 24; h++) {
        const t = belem(d, `${String(h).padStart(2, '0')}:00`);
        assert.ok(ultimoCorte(t, cfg).getTime() <= t.getTime(), `${d} ${h}h: abertura no futuro`);
        assert.ok(proximoCorte(t, cfg).getTime() > t.getTime(), `${d} ${h}h: fechamento no passado`);
      }
    }
  });

  test('todo corte cai às 12h de um dia ABERTO', () => {
    const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });
    for (const d of [SAB, DOM, SEG, TER, QUA, QUI]) {
      for (const h of ['00:30', '11:59', '12:00', '18:00']) {
        for (const corte of [ultimoCorte(belem(d, h), cfg), proximoCorte(belem(d, h), cfg)]) {
          const b = emBelem(corte);
          assert.equal(b.hora, HORA_CORTE, `${d} ${h}: corte fora das 12h`);
          assert.ok(!ehDiaFechado({ ano: b.ano, mes: b.mes, dia: b.dia }, cfg), `${d} ${h}: corte em dia fechado`);
        }
      }
    }
  });
});

describe('o nome da lista é o do dia da compra', () => {
  test('sábado 12:00 leva o nome da compra de segunda', () => {
    assert.equal(nomeDaCompra(belem(SAB, '12:00'), padrao), 'Compra de segunda · 26/10');
  });
  test('sábado 11:59 ainda é a compra de sábado', () => {
    assert.equal(nomeDaCompra(belem(SAB, '11:59'), padrao), 'Compra de sábado · 24/10');
  });
  test('o feriado aparece no nome como o dia para onde pulou', () => {
    assert.equal(nomeDaCompra(belem(QUA, '09:00'), configDoCiclo({ LISTA_FERIADOS: QUA })), 'Compra de quinta · 29/10');
  });
});

describe('a configuração do .env', () => {
  test('o padrão fecha só o domingo', () => {
    assert.deepEqual([...padrao.diasFechados], [0]);
    assert.equal(padrao.feriados.size, 0);
    assert.equal(padrao.horaCorte, 12);
  });

  test('fecha os dias que o .env mandar', () => {
    const cfg = configDoCiclo({ LISTA_DIAS_FECHADOS: '0,1' });   // domingo e segunda
    assert.equal(diaDaCompra(belem(SAB, '12:00'), cfg), TER);
  });

  test('vários feriados, separados por vírgula', () => {
    const cfg = configDoCiclo({ LISTA_FERIADOS: `${QUA},${QUI}` });
    assert.equal(diaDaCompra(belem(TER, '12:00'), cfg), '2026-10-30');
  });

  test('⚠️ a semana inteira fechada CAI NO PADRÃO e avisa — não trava', () => {
    // Sem isto, uma vírgula a mais no .env põe o servidor num laço infinito na
    // subida. Falhar fechado aqui bricaria o sistema (lição do §10.1).
    const avisos = [];
    const cfg = configDoCiclo({ LISTA_DIAS_FECHADOS: '0,1,2,3,4,5,6' }, (m) => avisos.push(m));
    assert.deepEqual([...cfg.diasFechados], [0]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /semana INTEIRA/);
  });

  test('⚠️ valor ilegível cai no padrão e avisa, em vez de abrir a semana toda', () => {
    const avisos = [];
    const cfg = configDoCiclo({ LISTA_DIAS_FECHADOS: 'domingo' }, (m) => avisos.push(m));
    assert.deepEqual([...cfg.diasFechados], [0], 'abriu o domingo por causa de um texto errado');
    assert.match(avisos[0], /nenhum dia válido/);
  });

  test('feriado fora do formato é ignorado COM aviso, não derruba os outros', () => {
    const avisos = [];
    const cfg = configDoCiclo({ LISTA_FERIADOS: `25/12/2026,${QUA}` }, (m) => avisos.push(m));
    assert.deepEqual([...cfg.feriados], [QUA]);
    assert.match(avisos[0], /AAAA-MM-DD/);
  });

  test('campo vazio não é "nenhum dia fechado"', () => {
    // String vazia é "não configurei", e aí vale o padrão — abrir o domingo
    // porque alguém deixou a linha em branco seria o pior desfecho.
    assert.deepEqual([...configDoCiclo({ LISTA_DIAS_FECHADOS: '' }).diasFechados], [0]);
    assert.deepEqual([...configDoCiclo({}).diasFechados], [0]);
  });
});

describe('cicloAtual, o objeto que a tela e o servidor leem', () => {
  test('traz as quatro coisas, coerentes entre si', () => {
    const c = cicloAtual(belem(DOM, '15:00'), padrao);
    assert.equal(c.diaDaCompra, SEG);
    assert.equal(c.nome, 'Compra de segunda · 26/10');
    assert.equal(c.ultimoCorte, belem(SAB, '12:00').toISOString());
    assert.equal(c.proximoCorte, belem(SEG, '12:00').toISOString());
    assert.equal(c.fuso, FUSO);
  });
});

// ── O timer do servidor ─────────────────────────────────────────────────────
// Reproduz o laço do `agendarCorte` do new_server.js (dormir em saltos de no
// máximo 1 h, recalculando do relógio) e corre uma semana inteira.
describe('o timer do servidor corta nos dias certos', () => {
  const SALTO_MAX = 60 * 60 * 1000;

  const correr = (de, ate, cfg) => {
    const cortes = [];
    let agora = de.getTime();
    let voltas = 0;
    while (agora < ate.getTime()) {
      if (++voltas > 5000) throw new Error('laço do timer não terminou');
      const alvo = proximoCorte(new Date(agora), cfg).getTime();
      const espera = Math.min(Math.max(alvo - agora, 1000), SALTO_MAX);
      agora += espera;
      if (agora >= alvo) cortes.push(new Date(alvo).toISOString());
    }
    return cortes;
  };

  test('na semana normal, corta de segunda a sábado e PULA o domingo', () => {
    const cortes = correr(belem(SAB, '00:00'), belem('2026-11-01', '00:00'), padrao);
    assert.deepEqual(cortes, [
      belem(SAB, '12:00').toISOString(),
      belem(SEG, '12:00').toISOString(),
      belem(TER, '12:00').toISOString(),
      belem(QUA, '12:00').toISOString(),
      belem(QUI, '12:00').toISOString(),
      belem('2026-10-30', '12:00').toISOString(),   // sexta
      belem('2026-10-31', '12:00').toISOString(),   // sábado
    ]);
  });

  test('nenhum corte sai repetido — o alvo fica no fechamento, não é recalculado ao acordar', () => {
    // ⚠️ Recalculando `proximoCorte` na hora de acordar, passado o corte ele já
    // devolve o SEGUINTE: a comparação nunca daria verdadeira e o anúncio não
    // sairia nunca.
    const cortes = correr(belem(SAB, '00:00'), belem('2026-11-01', '00:00'), padrao);
    assert.equal(new Set(cortes).size, cortes.length);
  });

  test('o feriado de quarta some da lista de cortes', () => {
    const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });
    const cortes = correr(belem(TER, '00:00'), belem('2026-10-30', '00:00'), cfg);
    assert.deepEqual(cortes, [belem(TER, '12:00').toISOString(), belem(QUI, '12:00').toISOString()]);
  });

  test('acordar ATRASADO não perde o corte', () => {
    // Máquina suspensa, relógio acertado: o timer acorda depois da hora. O
    // corte tem que sair assim mesmo, não ser pulado.
    const cfg = padrao;
    const alvo = proximoCorte(belem(SAB, '11:00'), cfg).getTime();
    const acordouTarde = alvo + 37 * 60 * 1000;
    assert.ok(acordouTarde >= alvo, 'o anúncio sairia');
    assert.equal(new Date(alvo).toISOString(), belem(SAB, '12:00').toISOString());
  });
});
