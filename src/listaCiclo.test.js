// O dia da Lista vai das 12h de um dia ABERTO às 12h do próximo (America/Belem,
// UTC−3); às 12h a lista aberta vira "Compra de <dia> · DD/MM" no Arquivo.
// Domingo e feriado não têm corte. Ver src/listaCiclo.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  configDoCiclo, ehDiaFechado, diaDaCompra, nomeDaCompra, ultimoCorte, proximoCorte,
  virarListaNoCorte, HORA_CORTE,
} from './listaCiclo.js';
import { proximaListaId } from './listaId.js';

// Hora de Belém → instante. 24/10 18:30 em Belém é 24/10 21:30 UTC.
const belem = (iso) => Date.parse(iso + '-03:00');

// A semana de referência, conferida: 24/10/2026 é SÁBADO.
const SEX = '2026-10-23', SAB = '2026-10-24', DOM = '2026-10-25', SEG = '2026-10-26';
const TER = '2026-10-27', QUA = '2026-10-28', QUI = '2026-10-29';

describe('o corte é ao meio-dia de Belém', () => {
  test('o item das 18h30 é da compra do dia SEGUINTE', () => {
    assert.equal(diaDaCompra(belem(`${SEG}T18:30:00`)), TER);
    assert.equal(nomeDaCompra(diaDaCompra(belem(`${SEG}T18:30:00`))), 'Compra de terça · 27/10');
    assert.equal(HORA_CORTE, 12);
  });

  test('antes das 12h é a compra do próprio dia; 12h00 em ponto já é do seguinte', () => {
    assert.equal(diaDaCompra(belem(`${SEG}T09:00:00`)), SEG);
    assert.equal(diaDaCompra(belem(`${SEG}T11:59:59`)), SEG);
    assert.equal(diaDaCompra(belem(`${SEG}T12:00:00`)), TER);
  });

  test('o fuso é o de Belém, não o UTC nem o do aparelho', () => {
    // 23h em Belém já é o dia seguinte em UTC — e continua sendo a compra de amanhã, não de depois.
    assert.equal(diaDaCompra('2026-10-27T02:00:00.000Z'), TER);   // 26/10 23:00 em Belém
    assert.equal(diaDaCompra('2026-10-27T14:59:00.000Z'), TER);   // 27/10 11:59
    assert.equal(diaDaCompra('2026-10-27T15:00:00.000Z'), QUA);   // 27/10 12:00
  });

  test('virada de mês e de ano', () => {
    assert.equal(diaDaCompra(belem('2026-11-30T20:00:00')), '2026-12-01');   // segunda → terça
    assert.equal(diaDaCompra(belem('2026-12-31T13:00:00')), '2027-01-01');   // quinta → sexta
  });

  test('data ilegível não inventa dia', () => {
    assert.equal(diaDaCompra(''), '');
    assert.equal(diaDaCompra(undefined), '');
    assert.equal(nomeDaCompra(''), 'Compra');
  });
});

describe('domingo a loja não abre: não existe corte no domingo', () => {
  test('sábado antes das 12h ainda é a compra de sábado', () => {
    assert.equal(diaDaCompra(belem(`${SAB}T09:00:00`)), SAB);
    assert.equal(diaDaCompra(belem(`${SAB}T11:59:59`)), SAB);
  });
  test('sábado 12h em diante é a compra de SEGUNDA, nunca de domingo', () => {
    assert.equal(diaDaCompra(belem(`${SAB}T12:00:00`)), SEG);
    assert.equal(diaDaCompra(belem(`${SAB}T18:30:00`)), SEG);
  });
  test('domingo, a qualquer hora, é compra de segunda', () => {
    for (const h of ['00:10', '08:00', '11:59', '12:00', '15:00', '23:59']) {
      assert.equal(diaDaCompra(belem(`${DOM}T${h}:00`)), SEG, `domingo ${h}`);
    }
  });
  test('segunda antes das 12h ainda é a compra de segunda; depois, de terça', () => {
    assert.equal(diaDaCompra(belem(`${SEG}T11:59:00`)), SEG);
    assert.equal(diaDaCompra(belem(`${SEG}T12:00:00`)), TER);
  });
  test('a lista que começa sábado 12h vai até segunda 12h: um ciclo só', () => {
    // De sábado 12h até segunda 11:59 o último corte é o de sábado e o próximo
    // é o de segunda — não há corte no meio.
    for (const q of [`${SAB}T12:00:00`, `${SAB}T23:00:00`, `${DOM}T03:00:00`, `${DOM}T12:00:00`, `${DOM}T20:00:00`, `${SEG}T11:59:59`]) {
      assert.equal(ultimoCorte(belem(q)), belem(`${SAB}T12:00:00`), `último em ${q}`);
      assert.equal(proximoCorte(belem(q)), belem(`${SEG}T12:00:00`), `próximo em ${q}`);
    }
    assert.equal(proximoCorte(belem(`${SEG}T12:00:00`)), belem(`${TER}T12:00:00`));
    assert.equal(ultimoCorte(belem(`${SEG}T12:00:00`)), belem(`${SEG}T12:00:00`));
  });
  test('nenhum corte cai num domingo, hora a hora na semana inteira', () => {
    for (let dia = 19; dia <= 31; dia++) for (let h = 0; h < 24; h++) {
      const t = belem(`2026-10-${String(dia).padStart(2, '0')}T${String(h).padStart(2, '0')}:30:00`);
      const compra = diaDaCompra(t);
      assert.notEqual(new Date(compra + 'T12:00:00Z').getUTCDay(), 0, `${dia}/10 ${h}h → ${compra}`);
      // e as três contas não divergem: o dia da compra é o dia do próximo corte
      assert.equal(diaDaCompra(proximoCorte(t) - 1), compra);
      assert.ok(ultimoCorte(t) <= t && t < proximoCorte(t), `agora fora do ciclo em ${dia}/10 ${h}h`);
    }
  });
});

describe('feriado segue a mesma lógica do domingo', () => {
  const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });   // quarta 28/10 feriado
  test('terça 12h pula o feriado: compra de QUINTA', () => {
    assert.equal(diaDaCompra(belem(`${TER}T12:00:00`), cfg), QUI);
    assert.equal(nomeDaCompra(diaDaCompra(belem(`${TER}T12:00:00`), cfg)), 'Compra de quinta · 29/10');
  });
  test('no feriado, a qualquer hora, é compra de quinta', () => {
    assert.equal(diaDaCompra(belem(`${QUA}T09:00:00`), cfg), QUI);
    assert.equal(diaDaCompra(belem(`${QUA}T20:00:00`), cfg), QUI);
  });
  test('o ciclo da terça 12h vai até quinta 12h', () => {
    assert.equal(ultimoCorte(belem(`${QUA}T15:00:00`), cfg), belem(`${TER}T12:00:00`));
    assert.equal(proximoCorte(belem(`${QUA}T15:00:00`), cfg), belem(`${QUI}T12:00:00`));
  });
  test('sem o feriado configurado, quarta é dia normal', () => {
    assert.equal(diaDaCompra(belem(`${TER}T12:00:00`)), QUA);
  });
  test('feriado na segunda emenda com o domingo: sábado 12h → compra de terça', () => {
    const c = configDoCiclo({ LISTA_FERIADOS: SEG });
    assert.equal(diaDaCompra(belem(`${SAB}T12:00:00`), c), TER);
    assert.equal(diaDaCompra(belem(`${DOM}T10:00:00`), c), TER);
    assert.equal(diaDaCompra(belem(`${SEG}T10:00:00`), c), TER);
    assert.equal(ultimoCorte(belem(`${SEG}T10:00:00`), c), belem(`${SAB}T12:00:00`));
  });
  test('ehDiaFechado: domingo sempre; feriado quando listado', () => {
    assert.equal(ehDiaFechado(DOM), true);
    assert.equal(ehDiaFechado(QUA), false);
    assert.equal(ehDiaFechado(QUA, cfg), true);
  });
});

describe('a configuração do .env', () => {
  test('o padrão fecha só o domingo', () => {
    const p = configDoCiclo({});
    assert.deepEqual([...p.diasFechados], [0]);
    assert.equal(p.feriados.size, 0);
    assert.equal(p.horaCorte, 12);
  });
  test('fecha os dias que o .env mandar', () => {
    const c = configDoCiclo({ LISTA_DIAS_FECHADOS: '0,1' });   // domingo e segunda
    assert.equal(diaDaCompra(belem(`${SAB}T12:00:00`), c), TER);
    assert.equal(ultimoCorte(belem(`${SEG}T15:00:00`), c), belem(`${SAB}T12:00:00`));
  });
  test('vários feriados, por vírgula, ponto e vírgula ou espaço', () => {
    const c = configDoCiclo({ LISTA_FERIADOS: `${QUA}, ${QUI};2026-12-25` });
    assert.deepEqual([...c.feriados].sort(), [QUA, QUI, '2026-12-25']);
    assert.equal(diaDaCompra(belem(`${TER}T12:00:00`), c), '2026-10-30');
  });
  test('⚠️ a semana inteira fechada CAI NO PADRÃO e avisa — não trava', () => {
    const avisos = [];
    const c = configDoCiclo({ LISTA_DIAS_FECHADOS: '0,1,2,3,4,5,6' }, (m) => avisos.push(m));
    assert.deepEqual([...c.diasFechados], [0]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /semana INTEIRA/);
  });
  test('⚠️ valor ilegível cai no padrão e avisa, em vez de abrir a semana toda', () => {
    const avisos = [];
    const c = configDoCiclo({ LISTA_DIAS_FECHADOS: 'domingo' }, (m) => avisos.push(m));
    assert.deepEqual([...c.diasFechados], [0]);
    assert.match(avisos[0], /nenhum dia válido/);
  });
  test('feriado fora do formato (ou data que não existe) é ignorado COM aviso, sem derrubar os outros', () => {
    const avisos = [];
    const c = configDoCiclo({ LISTA_FERIADOS: `25/12/2026,2026-02-30,${QUA}` }, (m) => avisos.push(m));
    assert.deepEqual([...c.feriados], [QUA]);
    assert.match(avisos[0], /AAAA-MM-DD/);
    assert.match(avisos[0], /2026-02-30/);
  });
  test('campo vazio não é "nenhum dia fechado"', () => {
    assert.deepEqual([...configDoCiclo({ LISTA_DIAS_FECHADOS: '' }).diasFechados], [0]);
    assert.deepEqual([...configDoCiclo({}).diasFechados], [0]);
    assert.deepEqual([...configDoCiclo(undefined).diasFechados], [0]);
  });
  test('um ano inteiro de feriados não trava: o laço tem teto', () => {
    const todos = [];
    for (let i = 0; i < 400; i++) todos.push(new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10));
    const c = configDoCiclo({ LISTA_FERIADOS: todos.join(',') }, () => {});
    assert.ok(diaDaCompra(belem(`${SAB}T12:00:00`), c));
  });
});

// ── A virada no servidor ────────────────────────────────────────────────────
const docBase = (itens, extra = {}) => ({
  listaAtualId: 'L1', listaAtualAbertaEm: new Date(belem(`${SEX}T12:00:30`)).toISOString(),
  listaCompras: itens, pedidosLista: [], listaDeletedIds: [], deletedIds: [], listasCompra: [], ...extra,
});
const it = (id, criado, extra = {}) => ({ id, listaId: 'L1', nome: 'Item ' + id, quantidade: 1, unidade: 'un',
  criadoEm: new Date(belem(criado)).toISOString(), updatedAt: belem(criado), ...extra });

describe('às 12h a lista vira no Arquivo e abre uma nova', () => {
  test('segunda 12h: "Compra de segunda" vai para o Arquivo e nasce a "Compra de terça", com nome', () => {
    const doc = docBase([it('a', `${DOM}T18:30:00`), it('b', `${SEG}T08:00:00`, { comprado: true })]);
    const agora = belem(`${SEG}T12:00:40`);
    const r = virarListaNoCorte(doc, agora);
    assert.ok(r, 'não virou');
    assert.equal(r.pedido.id, 'arq-L1', 'o id do pedido tem que ser o da tela (arq-<listaId>)');
    assert.equal(r.pedido.nome, 'Compra de segunda · 26/10');
    assert.equal(r.pedido.data, SEG);
    assert.equal(r.pedido.automatico, true);
    assert.equal(r.pedido.itens.length, 2);
    assert.equal(r.pedido.itens.find((i) => i.nome === 'Item b').comprado, true);
    assert.equal(r.doc.listaAtualId, proximaListaId('L1'), 'a lista nova tem que nascer de proximaListaId');
    assert.equal(r.doc.listaCompras.length, 0);
    assert.deepEqual([...r.doc.listaDeletedIds].sort(), ['a', 'b'], 'os arquivados saem sem tombstone — voltariam no POST seguinte');
    assert.ok(r.doc.deletedIds.includes('L1'), 'o cadastro da lista sai sem tombstone');
    assert.equal(r.doc.pedidosLista[0].id, 'arq-L1');
    // ⚠️ A lista nova nasce COM NOME no cadastro: é o que fica no alto da tela.
    const cad = r.doc.listasCompra.find((l) => l.id === r.doc.listaAtualId);
    assert.ok(cad, 'a lista nova nasceu sem cadastro — apareceria como "26/10 · 12:00"');
    assert.equal(cad.nome, 'Compra de terça · 27/10');
    assert.equal(r.novoNome, 'Compra de terça · 27/10');
  });

  test('sábado 12h: a de sábado vai para o Arquivo e a nova é a "Compra de SEGUNDA"', () => {
    const doc = docBase([it('a', `${SEX}T18:00:00`), it('b', `${SAB}T09:00:00`)]);
    const r = virarListaNoCorte(doc, belem(`${SAB}T12:00:30`));
    assert.equal(r.pedido.nome, 'Compra de sábado · 24/10');
    assert.equal(r.pedido.data, SAB);
    assert.equal(r.novoNome, 'Compra de segunda · 26/10');
  });

  test('não existe corte no domingo: a "Compra de segunda" não é tocada no domingo', () => {
    // Itens de sábado à tarde e de domingo de manhã: todos da compra de segunda.
    const doc = docBase([it('a', `${SAB}T15:00:00`), it('b', `${DOM}T09:00:00`)]);
    assert.equal(virarListaNoCorte(doc, belem(`${DOM}T12:00:30`)), null);
    assert.equal(virarListaNoCorte(doc, belem(`${DOM}T23:00:00`)), null);
    assert.equal(virarListaNoCorte(doc, belem(`${SEG}T11:59:00`)), null);
    // Segunda 12h ela fecha inteira, com os dois.
    const r = virarListaNoCorte(doc, belem(`${SEG}T12:00:30`));
    assert.deepEqual(r.pedido.itens.map((i) => i.nome).sort(), ['Item a', 'Item b']);
    assert.equal(r.pedido.nome, 'Compra de segunda · 26/10');
  });

  test('feriado: a véspera às 12h abre direto a compra do dia seguinte ao feriado', () => {
    const cfg = configDoCiclo({ LISTA_FERIADOS: QUA });
    const doc = docBase([it('a', `${SEG}T18:00:00`)]);
    const r = virarListaNoCorte(doc, belem(`${TER}T12:00:30`), cfg);
    assert.equal(r.pedido.nome, 'Compra de terça · 27/10');
    assert.equal(r.novoNome, 'Compra de quinta · 29/10');
    // e no feriado nada acontece
    assert.equal(virarListaNoCorte(r.doc, belem(`${QUA}T12:00:30`), cfg), null);
  });

  test('o que foi lançado DEPOIS das 12h passa para a lista nova, não vai para o Arquivo', () => {
    const doc = docBase([it('a', `${SEG}T08:00:00`), it('depois', `${SEG}T12:00:10`)]);
    const r = virarListaNoCorte(doc, belem(`${SEG}T12:01:00`));
    assert.deepEqual(r.pedido.itens.map((i) => i.nome), ['Item a']);
    const novo = r.doc.listaCompras.find((i) => i.id === 'depois');
    assert.ok(novo, 'o item de depois do corte sumiu');
    assert.equal(novo.listaId, r.doc.listaAtualId, 'o item de depois do corte ficou órfão');
    assert.equal(novo.updatedAt, belem(`${SEG}T12:01:00`), 'sem carimbo novo, a fusão devolveria o listaId velho');
  });

  test('idempotente: virada a lista, o minuto seguinte não faz nada', () => {
    const doc = docBase([it('a', `${SEG}T08:00:00`), it('depois', `${SEG}T12:00:10`)]);
    const r1 = virarListaNoCorte(doc, belem(`${SEG}T12:00:30`));
    assert.equal(virarListaNoCorte(r1.doc, belem(`${SEG}T12:01:30`)), null);
    assert.equal(virarListaNoCorte(r1.doc, belem(`${TER}T11:59:00`)), null);
    // No corte seguinte, é a vez do item que entrou depois.
    const r2 = virarListaNoCorte(r1.doc, belem(`${TER}T12:00:30`));
    assert.equal(r2.pedido.nome, 'Compra de terça · 27/10');
    assert.deepEqual(r2.pedido.itens.map((i) => i.nome), ['Item depois']);
  });

  test('lista sem item anterior ao corte: nada a fazer', () => {
    assert.equal(virarListaNoCorte(docBase([]), belem(`${SEG}T12:00:30`)), null);
    assert.equal(virarListaNoCorte(docBase([it('x', `${SEG}T12:30:00`)]), belem(`${SEG}T13:00:00`)), null);
  });

  test('as OUTRAS listas abertas não são tocadas, e o nome dado à lista é preservado', () => {
    const doc = docBase([it('a', `${SEG}T08:00:00`), it('outra', `${DOM}T09:00:00`, { listaId: 'L2' })],
      { listasCompra: [{ id: 'L1', nome: 'Feira', criadaPor: 'Mario', criadaEm: 'x' }, { id: 'L2', nome: 'Bebidas' }] });
    const r = virarListaNoCorte(doc, belem(`${SEG}T12:00:30`));
    assert.equal(r.pedido.nome, 'Feira');
    assert.equal(r.pedido.criadaPor, 'Mario');
    assert.ok(r.doc.listaCompras.some((i) => i.id === 'outra' && i.listaId === 'L2'));
    assert.deepEqual(r.doc.listasCompra.map((l) => l.id), ['L2', proximaListaId('L1')]);
    assert.equal(r.doc.listasCompra.find((l) => l.id === 'L2').nome, 'Bebidas');
  });

  test('item sem criadoEm (anterior ao carimbo) sai no corte, não fica preso', () => {
    const r = virarListaNoCorte(docBase([{ id: 'velho', listaId: 'L1', nome: 'Velho' }]), belem(`${SEG}T12:00:30`));
    assert.equal(r.arquivados, 1);
  });
});
