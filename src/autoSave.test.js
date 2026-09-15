import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirAutoSave, empresasComMudanca, ATRASO_REAGENDAR } from './autoSave.js';

const base = { primeiroRender: false, veioDoPoll: false, saveDiretoEmAndamento: false, mudou: true };

test('mudança normal é salva', () => {
  const r = decidirAutoSave(base);
  assert.equal(r.acao, 'salvar');
  assert.equal(r.atualizarPrev, true);
});

test('mudança durante save direto REAGENDA e NÃO marca como processada', () => {
  // É o bug inteiro. `atualizarPrev: true` aqui fazia o ciclo seguinte não ver
  // diferença nenhuma — a mudança sumia sem erro, sem log, sem nada.
  const r = decidirAutoSave({ ...base, saveDiretoEmAndamento: true });
  assert.equal(r.acao, 'reagendar');
  assert.equal(r.atualizarPrev, false, 'tocar em prevState aqui é o que apaga a mudança');
  assert.equal(r.atrasoMs, ATRASO_REAGENDAR);
});

test('o save direto vence o "nada mudou"', () => {
  // Mesmo que a comparação diga que nada mudou, enquanto o save direto roda o
  // prevState não pode ser mexido: ele é a referência que guarda a pendência.
  const r = decidirAutoSave({ ...base, saveDiretoEmAndamento: true, mudou: false });
  assert.equal(r.acao, 'reagendar');
  assert.equal(r.atualizarPrev, false);
});

test('primeiro render e eco do poll sincronizam sem salvar', () => {
  for (const k of ['primeiroRender', 'veioDoPoll']) {
    const r = decidirAutoSave({ ...base, [k]: true });
    assert.equal(r.acao, 'ignorar', k);
    assert.equal(r.atualizarPrev, true, `${k} pode atualizar: o dado veio de fora`);
  }
});

test('sem mudança, não posta', () => {
  const r = decidirAutoSave({ ...base, mudou: false });
  assert.equal(r.acao, 'ignorar');
});

test('a mudança sobrevive a vários ciclos de save direto', () => {
  // Simula o ciclo real: o usuário mexe, o save direto está rodando, o efeito
  // roda várias vezes até o save terminar. A pendência não pode se perder no
  // meio do caminho.
  let prev = { CONFRARIA: { v: 1 } };
  const state = { CONFRARIA: { v: 2 } };          // mudança do usuário
  let salvou = false;

  for (const emAndamento of [true, true, true, false]) {
    const d = decidirAutoSave({ primeiroRender: false, veioDoPoll: false,
      saveDiretoEmAndamento: emAndamento, mudou: empresasComMudanca(state, prev).length > 0 });
    if (d.atualizarPrev) prev = state;
    if (d.acao === 'salvar') salvou = true;
  }
  assert.equal(salvou, true, 'quando o save direto termina, a mudança ainda está visível e é salva');
});

test('o bug antigo: atualizar prevState durante o save direto perde a mudança', () => {
  // Reproduz o comportamento anterior para deixar registrado POR QUE mudou.
  let prev = { CONFRARIA: { v: 1 } };
  const state = { CONFRARIA: { v: 2 } };
  let salvou = false;
  for (const emAndamento of [true, false]) {
    const mudou = empresasComMudanca(state, prev).length > 0;
    if (emAndamento) { prev = state; continue; }   // ← o `prevState = state` de antes
    if (mudou) salvou = true;
  }
  assert.equal(salvou, false, 'era assim que a mudança sumia calada');
});

test('só a empresa que mudou é postada', () => {
  const a = { x: 1 }, b = { y: 1 };
  assert.deepEqual(empresasComMudanca({ CONFRARIA: a, SEAMA: b }, { CONFRARIA: a, SEAMA: b }), []);
  assert.deepEqual(empresasComMudanca({ CONFRARIA: { x: 2 }, SEAMA: b }, { CONFRARIA: a, SEAMA: b }), ['CONFRARIA']);
});

test('prevState ausente conta como tudo mudado', () => {
  // Primeiro ciclo depois de um reload: não dá pra afirmar que nada mudou.
  assert.deepEqual(empresasComMudanca({ CONFRARIA: { x: 1 }, SEAMA: { y: 1 } }, null),
    ['CONFRARIA', 'SEAMA']);
});
