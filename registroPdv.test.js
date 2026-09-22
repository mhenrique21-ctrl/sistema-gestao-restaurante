import test from 'node:test';
import assert from 'node:assert/strict';
import { idDoRegistroPdv, idPadraoDoDia } from './registroPdv.js';
import { mergeDocument } from './mergeDocument.js';

// Análise do código sob teste (registroPdv.js):
// - Input: a origem/empresa/data do envio, o id que o arquivo já usa para esse
//   dia, e o tombstone do documento.
// - Output: com que id gravar — o estável de sempre, ou um novo quando o
//   estável está morto.
// - Sem efeitos colaterais: função pura.
// - Existe porque errar aqui é INVISÍVEL: o POST responde 200, o agente mostra
//   ✅, e a linha some do app na fusão seguinte.

const ARGS = {
  prefixo: 'pdv-ecletica', empresa: 'CONFRARIA', data: '2026-09-22', marca: 'abc',
};

test('o id do dia é estável — é ele que faz reenviar ATUALIZAR em vez de somar', () => {
  assert.equal(idPadraoDoDia('pdv-ecletica', 'CONFRARIA', '2026-09-22'), 'pdv-ecletica-confraria-2026-09-22');
  const a = idDoRegistroPdv({ ...ARGS, deletados: [] });
  const b = idDoRegistroPdv({ ...ARGS, deletados: [], marca: 'outra' });
  assert.equal(a.id, b.id);
  assert.equal(a.renasceu, false);
});

test('linha já gravada mantém o id dela', () => {
  const r = idDoRegistroPdv({ ...ARGS, idExistente: 'pdv-ecletica-confraria-2026-09-22', deletados: [] });
  assert.equal(r.id, 'pdv-ecletica-confraria-2026-09-22');
  assert.equal(r.renasceu, false);
});

test('⚠️ id no tombstone NÃO é reusado — era o envio que sumia calado', () => {
  const morto = 'pdv-ecletica-confraria-2026-09-22';
  const r = idDoRegistroPdv({ ...ARGS, deletados: [morto] });
  assert.notEqual(r.id, morto);
  assert.equal(r.renasceu, true);
});

test('⚠️ o id novo é cunhado UMA vez — senão o dia vira uma linha por ciclo', () => {
  // Depois do primeiro envio o arquivo já tem a linha com o id novo; o ciclo
  // seguinte tem que reconhecê-la, não cunhar outra. Cunhar a cada dois
  // minutos multiplicaria o faturamento do dia por quantos ciclos rodassem.
  const morto = 'pdv-ecletica-confraria-2026-09-22';
  const primeiro = idDoRegistroPdv({ ...ARGS, deletados: [morto] });
  const segundo = idDoRegistroPdv({ ...ARGS, idExistente: primeiro.id, deletados: [morto], marca: 'zzz' });
  assert.equal(segundo.id, primeiro.id);
  assert.equal(segundo.renasceu, false);
});

test('apagar de novo cunha outro — a linha antiga continua apagada', () => {
  const morto = 'pdv-ecletica-confraria-2026-09-22';
  const primeiro = idDoRegistroPdv({ ...ARGS, deletados: [morto] });
  const depois = idDoRegistroPdv({ ...ARGS, idExistente: primeiro.id, deletados: [morto, primeiro.id], marca: 'zzz' });
  assert.notEqual(depois.id, primeiro.id);
  assert.notEqual(depois.id, morto);
  assert.equal(depois.renasceu, true);
});

test('aceita o tombstone como Set — é assim que o servidor o tem em mãos', () => {
  const r = idDoRegistroPdv({ ...ARGS, deletados: new Set(['pdv-ecletica-confraria-2026-09-22']) });
  assert.equal(r.renasceu, true);
});

// ── A prova do bug, ponta a ponta contra a fusão de verdade ────────────────
const vendaPdv = (id) => ({
  id, data: '2026-09-22', origem: 'pdv_ecletica', total: 1234.5,
  criadoEm: '2026-09-22T12:00:00.000Z', atualizadoEm: '2026-09-22T20:00:00.000Z',
});

test('⚠️ com o id determinístico, a fusão ENGOLE o que o caixa acabou de mandar', () => {
  // O agente reenviou o dia, o endpoint gravou 200 OK — e o primeiro POST de
  // qualquer aparelho apaga a linha, porque o id está no tombstone. É o bug
  // "não sobe pro Gestão e o agente está funcionando normalmente".
  const morto = idPadraoDoDia('pdv-ecletica', 'CONFRARIA', '2026-09-22');
  const noServidor = { vendas: [vendaPdv(morto)], deletedIds: [morto] };
  const doAparelho = { vendas: [], deletedIds: [morto] };
  assert.equal(mergeDocument(noServidor, doAparelho).vendas.length, 0);
});

test('com o id novo, o envio do caixa sobrevive à fusão', () => {
  const morto = idPadraoDoDia('pdv-ecletica', 'CONFRARIA', '2026-09-22');
  const { id } = idDoRegistroPdv({ ...ARGS, deletados: [morto] });
  const noServidor = { vendas: [vendaPdv(id)], deletedIds: [morto] };
  const doAparelho = { vendas: [], deletedIds: [morto] };
  const vendas = mergeDocument(noServidor, doAparelho).vendas;
  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].total, 1234.5);
});

test('e não duplica o dia: a linha morta não volta junto com a nova', () => {
  // As duas têm a mesma data+origem. A fusão de vendas dedupe por essa chave,
  // e a morta é descartada pelo tombstone — sobra uma linha só.
  const morto = idPadraoDoDia('pdv-ecletica', 'CONFRARIA', '2026-09-22');
  const { id } = idDoRegistroPdv({ ...ARGS, deletados: [morto] });
  const noServidor = { vendas: [vendaPdv(morto), vendaPdv(id)], deletedIds: [morto] };
  const vendas = mergeDocument(noServidor, { vendas: [], deletedIds: [morto] }).vendas;
  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].id, id);
});
