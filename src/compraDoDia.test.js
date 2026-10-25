import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  HORA_CORTE, diaDaCompra, inicioDaCompra, diaFechado, feriadosDoEnv,
  idDaCompra, diaDoId, nomeDaCompra, ehListaDoDia, aplicarCompraDoDia,
  precisaVirar, msAteProximoCorte, isoLocal,
} from './compraDoDia.js';

// Outubro de 2026: sáb 24, dom 25, seg 26, ter 27 ... sáb 31, dom 1/11, seg 2/11.
const em = (dia, h, min = 0) => new Date(2026, 9, dia, h, min); // hora LOCAL

describe('o corte é ao meio-dia', () => {
  test('antes das 12h o item é da compra de hoje', () => {
    assert.equal(diaDaCompra(em(26, 11, 59)), '2026-10-26'); // seg 11:59 → seg
  });
  test('às 12h em ponto já é a compra de amanhã', () => {
    assert.equal(diaDaCompra(em(26, 12, 0)), '2026-10-27');  // seg 12:00 → ter
    assert.equal(HORA_CORTE, 12);
  });
  test('à noite continua sendo a de amanhã (hora LOCAL, não UTC)', () => {
    // ⚠️ Às 22h locais o UTC já é o dia seguinte; por toISOString o item
    // pularia para depois de amanhã.
    assert.equal(diaDaCompra(em(26, 22, 30)), '2026-10-27');
  });
});

describe('domingo a loja não abre', () => {
  test('sábado antes das 12h é a compra de sábado', () => {
    assert.equal(diaDaCompra(em(24, 9)), '2026-10-24');
  });
  test('sábado depois das 12h vai para a compra de SEGUNDA, não de domingo', () => {
    assert.equal(diaDaCompra(em(24, 12)), '2026-10-26');
    assert.equal(diaDaCompra(em(24, 18)), '2026-10-26');
  });
  test('domingo, a qualquer hora, é compra de segunda — não existe corte no domingo', () => {
    assert.equal(diaDaCompra(em(25, 8)), '2026-10-26');
    assert.equal(diaDaCompra(em(25, 11, 59)), '2026-10-26');
    assert.equal(diaDaCompra(em(25, 12)), '2026-10-26');
    assert.equal(diaDaCompra(em(25, 23, 59)), '2026-10-26');
  });
  test('segunda depois das 12h volta ao normal: compra de terça', () => {
    assert.equal(diaDaCompra(em(26, 15)), '2026-10-27');
  });
  test('a compra de segunda começa sábado 12h e vai até segunda 12h', () => {
    assert.equal(inicioDaCompra('2026-10-26'), '2026-10-24T12:00');
    // e a de terça começa segunda 12h
    assert.equal(inicioDaCompra('2026-10-27'), '2026-10-26T12:00');
  });
  test('nunca devolve um domingo', () => {
    for (let dia = 19; dia <= 31; dia++) for (let h = 0; h < 24; h++) {
      const iso = diaDaCompra(em(dia, h));
      const [a, m, d] = iso.split('-').map(Number);
      assert.notEqual(new Date(a, m - 1, d, 12).getDay(), 0, `${dia}/10 ${h}h → ${iso}`);
    }
  });
});

describe('feriado segue a mesma lógica do domingo', () => {
  const fer = feriadosDoEnv('2026-10-28').feriados; // quarta 28/10 feriado
  test('terça depois das 12h pula o feriado: compra de quinta', () => {
    assert.equal(diaDaCompra(em(27, 13), fer), '2026-10-29');
  });
  test('no feriado, a qualquer hora, é compra de quinta', () => {
    assert.equal(diaDaCompra(em(28, 9), fer), '2026-10-29');
    assert.equal(diaDaCompra(em(28, 20), fer), '2026-10-29');
  });
  test('terça antes das 12h ainda é a compra de terça', () => {
    assert.equal(diaDaCompra(em(27, 10), fer), '2026-10-27');
  });
  test('a compra de quinta começa terça 12h', () => {
    assert.equal(inicioDaCompra('2026-10-29', fer), '2026-10-27T12:00');
  });
  test('feriado na segunda emenda com o domingo: sábado 12h → compra de terça', () => {
    const f = feriadosDoEnv('2026-11-02').feriados; // seg 2/11 (Finados)
    assert.equal(diaDaCompra(em(31, 14), f), '2026-11-03');
    assert.equal(diaDaCompra(new Date(2026, 10, 1, 10), f), '2026-11-03'); // domingo 1/11
    assert.equal(diaDaCompra(new Date(2026, 10, 2, 10), f), '2026-11-03'); // o feriado
    assert.equal(inicioDaCompra('2026-11-03', f), '2026-10-31T12:00');
  });
  test('aceita Set, array ou a string crua do .env', () => {
    assert.equal(diaDaCompra(em(27, 13), ['2026-10-28']), '2026-10-29');
    assert.equal(diaDaCompra(em(27, 13), '2026-10-28'), '2026-10-29');
    assert.equal(diaDaCompra(em(27, 13), undefined), '2026-10-28');
  });
  test('um .env absurdo não trava a tela', () => {
    const todos = [];
    for (let i = 0; i < 400; i++) todos.push(isoLocal(new Date(2026, 9, 20 + i, 12)));
    assert.ok(diaDaCompra(em(27, 13), todos)); // termina, devolve alguma data
  });
});

describe('LISTA_FERIADOS do .env', () => {
  test('lê datas separadas por vírgula, ponto e vírgula ou espaço', () => {
    const { feriados, rejeitados } = feriadosDoEnv('2026-11-02, 2026-11-15;2026-12-25 2027-01-01');
    assert.deepEqual([...feriados].sort(), ['2026-11-02', '2026-11-15', '2026-12-25', '2027-01-01']);
    assert.deepEqual(rejeitados, []);
  });
  test('ignora o que não é data real, e diz o que ignorou', () => {
    const { feriados, rejeitados } = feriadosDoEnv('2026-02-30,25/12/2026,2026-11-15,abc,2026-13-01');
    assert.deepEqual([...feriados], ['2026-11-15']);
    assert.deepEqual(rejeitados, ['2026-02-30', '25/12/2026', 'abc', '2026-13-01']);
  });
  test('vazio ou ausente é nenhum feriado', () => {
    assert.equal(feriadosDoEnv('').feriados.size, 0);
    assert.equal(feriadosDoEnv(undefined).feriados.size, 0);
    assert.equal(feriadosDoEnv(null).feriados.size, 0);
  });
  test('diaFechado: domingo sempre, feriado quando listado', () => {
    assert.equal(diaFechado('2026-10-25'), true);
    assert.equal(diaFechado('2026-10-28'), false);
    assert.equal(diaFechado('2026-10-28', new Set(['2026-10-28'])), true);
  });
});

describe('identidade e nome da lista do dia', () => {
  test('o id é derivado do dia — todo aparelho chega ao MESMO id na virada', () => {
    assert.equal(idDaCompra('2026-10-26'), 'compra-2026-10-26');
    assert.equal(diaDoId('compra-2026-10-26'), '2026-10-26');
    assert.equal(diaDoId('compra-2026-10-26-2'), '2026-10-26');
    assert.equal(diaDoId('lista-inicial'), null);
    assert.equal(diaDoId('compra-xyz'), null);
    assert.equal(diaDoId('compra-2026-02-30'), null);
    assert.equal(diaDoId(undefined), null);
  });
  test('o mesmo dia já arquivado ganha uma SEGUNDA lista, com outro id', () => {
    // ⚠️ Sábado 10h: tudo comprado, a lista se arquiva, e a nova ainda é a
    // compra de sábado. Com o mesmo id o cadastro cairia no tombstone e o
    // segundo arquivamento gravaria por cima do primeiro.
    const db = { pedidosLista: [{ id: 'arq-compra-2026-10-24' }] };
    assert.equal(idDaCompra('2026-10-24', db), 'compra-2026-10-24-2');
    db.pedidosLista.push({ id: 'arq-compra-2026-10-24-2' });
    assert.equal(idDaCompra('2026-10-24', db), 'compra-2026-10-24-3');
    assert.equal(idDaCompra('2026-10-26', db), 'compra-2026-10-26');
    // id apagado (lista apagada à mão / 48 h) também não volta
    assert.equal(idDaCompra('2026-10-27', { listaDeletedIds: ['compra-2026-10-27'] }), 'compra-2026-10-27-2');
  });
  test('o nome é como a loja fala', () => {
    assert.equal(nomeDaCompra('2026-10-26'), 'Compra de segunda · 26/10');
    assert.equal(nomeDaCompra('2026-10-24'), 'Compra de sábado · 24/10');
    assert.equal(nomeDaCompra('2026-10-27'), 'Compra de terça · 27/10');
  });
  test('lista do dia: id de compra, ou lista antiga sem cadastro; lista à mão não', () => {
    const cad = [{ id: 'abc123', nome: 'Feira de sábado' }];
    assert.equal(ehListaDoDia('compra-2026-10-26', cad), true);
    assert.equal(ehListaDoDia('l0abc0def', cad), true);   // antiga, sem cadastro
    assert.equal(ehListaDoDia('', cad), true);
    assert.equal(ehListaDoDia('abc123', cad), false);     // criada à mão
  });
});

describe('aplicar a regra ao db', () => {
  test('lista antiga aberta: vira para a compra do dia, com cadastro, para todo mundo', () => {
    const db = { listaAtualId: 'l0abc0def', listasCompra: [], listaCompras: [] };
    const r = aplicarCompraDoDia(db, em(24, 15));           // sáb 15h
    assert.equal(r.virou, true);
    assert.equal(r.listaId, 'compra-2026-10-26');
    assert.equal(r.db.listaAtualId, 'compra-2026-10-26');
    assert.equal(r.db.listaAtualAbertaEm, em(24, 15).toISOString());
    assert.deepEqual(r.db.listasCompra.map((l) => [l.id, l.nome]), [['compra-2026-10-26', 'Compra de segunda · 26/10']]);
    assert.equal(db.listaAtualId, 'l0abc0def', 'não muta o db de entrada');
  });
  test('já é a lista do dia: não grava nada', () => {
    const db = { listaAtualId: 'compra-2026-10-26', listasCompra: [{ id: 'compra-2026-10-26', nome: 'x' }] };
    const r = aplicarCompraDoDia(db, em(25, 10));           // domingo
    assert.equal(r.virou, false);
    assert.equal(r.listaId, 'compra-2026-10-26');
    assert.equal(r.db, db);
    assert.equal(precisaVirar(db, em(25, 10)), false);
  });
  test('passou o corte: a compra de segunda vira compra de terça às 12h de segunda', () => {
    const db = { listaAtualId: 'compra-2026-10-26', listasCompra: [{ id: 'compra-2026-10-26', nome: 'x' }] };
    assert.equal(precisaVirar(db, em(26, 11, 59)), false);
    const r = aplicarCompraDoDia(db, em(26, 12));
    assert.equal(r.virou, true);
    assert.equal(r.db.listaAtualId, 'compra-2026-10-27');
    assert.equal(r.db.listasCompra.length, 2, 'a anterior fica no trocador, não some');
  });
  test('lista criada à mão aberta: a regra não encosta', () => {
    const db = { listaAtualId: 'abc123', listasCompra: [{ id: 'abc123', nome: 'Feira de sábado' }] };
    const r = aplicarCompraDoDia(db, em(24, 15));
    assert.equal(r.virou, false);
    assert.equal(r.listaId, 'abc123');
    assert.equal(r.db, db);
  });
  test('cadastro já existente (outro aparelho virou primeiro) não é duplicado', () => {
    const db = { listaAtualId: 'l0abc0def', listasCompra: [{ id: 'compra-2026-10-26', nome: 'Compra de segunda · 26/10' }] };
    const r = aplicarCompraDoDia(db, em(25, 9));
    assert.equal(r.db.listasCompra.length, 1);
    assert.equal(r.db.listaAtualId, 'compra-2026-10-26');
  });
  test('a segunda lista do mesmo dia conta como "já é a do dia": não vira de novo', () => {
    const db = { listaAtualId: 'compra-2026-10-24-2', listasCompra: [], pedidosLista: [{ id: 'arq-compra-2026-10-24' }] };
    assert.equal(precisaVirar(db, em(24, 10)), false);
    // e depois do arquivamento, sem lista aberta, nasce a -2 (nunca a já arquivada)
    const r = aplicarCompraDoDia({ ...db, listaAtualId: '' }, em(24, 10, 30));
    assert.equal(r.db.listaAtualId, 'compra-2026-10-24-2');
    assert.equal(r.db.listasCompra[0].nome, 'Compra de sábado · 24/10');
  });
  test('feriado entra na virada', () => {
    const db = { listaAtualId: 'compra-2026-10-27', listasCompra: [] };
    const r = aplicarCompraDoDia(db, em(27, 12), ['2026-10-28']);
    assert.equal(r.db.listaAtualId, 'compra-2026-10-29');
    assert.equal(r.db.listasCompra[0].nome, 'Compra de quinta · 29/10');
  });
});

describe('próximo corte', () => {
  test('antes do meio-dia é hoje 12h; depois, amanhã 12h', () => {
    assert.equal(msAteProximoCorte(em(26, 11)), 3600 * 1000);
    assert.equal(msAteProximoCorte(em(26, 12)), 24 * 3600 * 1000);
    assert.equal(msAteProximoCorte(em(26, 13)), 23 * 3600 * 1000);
  });
});
