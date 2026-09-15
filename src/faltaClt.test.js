import test from 'node:test';
import assert from 'node:assert/strict';
import {
  salarioDia, domingoDaSemana, diasDaFalta, descontoDoMes, previaFalta,
  ehJustificada, MOTIVOS_473,
} from './faltaClt.js';

// Salários reais da tela, em 15/09/2026.
const WELISON = 2269.40;   // dia = 75,646666…
const FELIPE = 1687.20;    // dia = 56,24 exato
const inj = (data, dias = 1) => ({ data, dias, tipo: 'injustificada' });

test('salário-dia é o salário sobre 30, sem arredondar', () => {
  // Arredondar aqui e multiplicar por 2 daria 151,30 em vez de 151,29.
  assert.equal(salarioDia(WELISON).toFixed(6), '75.646667');
  assert.equal(salarioDia(FELIPE), 56.24);
});

test('uma falta injustificada desconta o dia E o DSR', () => {
  // Lei 605/49, art. 6º. Antes descontava só o dia.
  const r = descontoDoMes([inj('2026-09-14')], WELISON);
  assert.equal(r.diasDescontados, 1);
  assert.equal(r.dsrPerdidos, 1);
  assert.equal(r.total, 151.29);
  assert.equal(descontoDoMes([inj('2026-09-14')], FELIPE).total, 112.48);
});

test('as parcelas sempre somam o total mostrado', () => {
  // 75,65 + 75,65 = 151,30 ao lado de um total de 151,29 seria a tela se
  // contradizendo. O resíduo do arredondamento vai na linha do DSR.
  const r = descontoDoMes([inj('2026-09-14')], WELISON);
  assert.equal(r.valorDias, 75.65);
  assert.equal(r.valorDsr, 75.64);
  assert.equal(Math.round((r.valorDias + r.valorDsr) * 100) / 100, r.total);
});

test('duas faltas na MESMA semana perdem UM só DSR', () => {
  // Só existe um repouso por semana. Calcular por lançamento cobraria um dia
  // a mais do colaborador.
  const r = descontoDoMes([inj('2026-09-14'), inj('2026-09-18')], WELISON);
  assert.equal(r.diasDescontados, 2);
  assert.equal(r.dsrPerdidos, 1);
  assert.equal(r.total, 226.94);            // 3 × 75,646666…
});

test('faltas em semanas diferentes perdem um DSR cada', () => {
  const r = descontoDoMes([inj('2026-09-18'), inj('2026-09-22')], WELISON);
  assert.equal(r.dsrPerdidos, 2);
  assert.equal(r.total, 302.59);            // 4 × 75,646666…
});

test('a semana vai de segunda a domingo', () => {
  assert.equal(domingoDaSemana('2026-09-14'), '2026-09-20');   // segunda
  assert.equal(domingoDaSemana('2026-09-18'), '2026-09-20');   // sexta
  assert.equal(domingoDaSemana('2026-09-19'), '2026-09-20');   // sábado
  assert.equal(domingoDaSemana('2026-09-21'), '2026-09-27');   // segunda seguinte
  assert.equal(domingoDaSemana('2026-09-20'), '2026-09-20');   // o próprio domingo
});

test('a data não escorrega um dia por causa do fuso', () => {
  // O app guarda "AAAA-MM-DD" e o Amapá é UTC−3: ler como hora local jogaria a
  // segunda-feira para o domingo anterior e trocaria a semana do DSR.
  assert.equal(domingoDaSemana('2026-09-07'), '2026-09-13');
  assert.equal(diasDaFalta('2026-09-07', 1)[0], '2026-09-07');
});

test('falta de vários dias pula o domingo', () => {
  // Não se falta no dia de folga — e contar o domingo como falta descontaria o
  // repouso duas vezes, uma como dia e outra como DSR.
  assert.deepEqual(diasDaFalta('2026-09-18', 3), ['2026-09-18', '2026-09-19', '2026-09-21']);
});

test('falta de vários dias na mesma semana perde um DSR só', () => {
  // Sexta e sábado são a mesma semana, mesmo sendo dois dias.
  const r = descontoDoMes([inj('2026-09-18', 2)], WELISON);
  assert.equal(r.diasDescontados, 2);
  assert.equal(r.dsrPerdidos, 1);
});

test('falta de vários dias que atravessa a semana perde dois DSR', () => {
  // Sexta, sábado e segunda: o domingo no meio não é dia de falta, mas separa
  // duas semanas — e são dois repousos perdidos num lançamento só.
  const r = descontoDoMes([inj('2026-09-18', 3)], WELISON);
  assert.equal(r.diasDescontados, 3);
  assert.equal(r.dsrPerdidos, 2);
  assert.deepEqual(r.semanas.map((s) => s.domingo), ['2026-09-20', '2026-09-27']);
});

test('atestado e art. 473 não descontam nada', () => {
  const r = descontoDoMes([
    { data: '2026-09-14', dias: 1, tipo: 'atestado' },
    { data: '2026-09-21', dias: 2, tipo: 'art473', motivo473: 'obito' },
    { data: '2026-09-23', dias: 1, tipo: 'abonada' },
  ], WELISON);
  assert.equal(r.total, 0);
  assert.equal(r.dsrPerdidos, 0);
  assert.ok(ehJustificada('atestado') && ehJustificada('art473') && ehJustificada('abonada'));
  assert.ok(!ehJustificada('injustificada'));
});

test('falta antiga, gravada sem tipo, conta como injustificada', () => {
  // É como elas eram tratadas antes de o tipo existir — sem isso o histórico
  // deixaria de descontar de uma hora pra outra.
  assert.ok(!ehJustificada(undefined));
  assert.equal(descontoDoMes([{ data: '2026-09-14', dias: 1 }], WELISON).total, 151.29);
});

test('mês sem falta nenhuma não desconta', () => {
  const r = descontoDoMes([], WELISON);
  assert.equal(r.total, 0);
  assert.deepEqual(r.semanas, []);
});

// ── Prévia do formulário ───────────────────────────────────────────────────
test('prévia da primeira falta da semana mostra dia + DSR', () => {
  const p = previaFalta({ faltasExistentes: [], salario: WELISON, data: '2026-09-14', dias: 1 });
  assert.equal(p.total, 151.29);
  assert.equal(p.dsrNovo, true);
  assert.equal(p.domingo, '2026-09-20');
  assert.equal(p.dsrJaDescontadoPor, null);
});

test('prévia da segunda falta da semana não cobra o DSR de novo', () => {
  // É este aviso que impede o erro mais caro da tela.
  const p = previaFalta({ faltasExistentes: [inj('2026-09-14')], salario: WELISON,
    data: '2026-09-18', dias: 1 });
  assert.equal(p.total, 75.65);
  assert.equal(p.dsrNovo, false);
  assert.equal(p.valorDsr, 0);
  assert.equal(p.dsrJaDescontadoPor, '2026-09-14');
});

test('prévia de falta em outra semana volta a cobrar o DSR', () => {
  const p = previaFalta({ faltasExistentes: [inj('2026-09-14')], salario: WELISON,
    data: '2026-09-22', dias: 1 });
  assert.equal(p.dsrNovo, true);
  // 151,30 e não 151,29: a prévia é o quanto o desconto do MÊS aumenta, não o
  // valor da falta isolada. Parece um centavo errado e não é — é o resíduo do
  // arredondamento do mês caindo nesta falta. Mostrar 151,29 nas duas faria a
  // soma da tela dar 302,58 contra os 302,59 do holerite.
  assert.equal(p.total, 151.30);
  const mes = descontoDoMes([inj('2026-09-14'), inj('2026-09-22')], WELISON);
  assert.equal(mes.total, 302.59);
  assert.equal(Math.round((151.29 + p.total) * 100) / 100, mes.total);
});

test('prévia de ausência justificada zera tudo', () => {
  const p = previaFalta({ faltasExistentes: [], salario: WELISON,
    data: '2026-09-14', dias: 1, tipo: 'atestado' });
  assert.equal(p.total, 0);
  assert.equal(p.justificada, true);
});

test('os motivos do art. 473 trazem inciso e limite de dias', () => {
  const obito = MOTIVOS_473.find((m) => m.id === 'obito');
  assert.equal(obito.inciso, 'I');
  assert.equal(obito.dias, 2);
  assert.equal(MOTIVOS_473.find((m) => m.id === 'casamento').dias, 3);
  // Inciso sem limite fixo em dias devolve null, não zero: zero impediria
  // registrar a ausência.
  assert.equal(MOTIVOS_473.find((m) => m.id === 'juizo').dias, null);
});
