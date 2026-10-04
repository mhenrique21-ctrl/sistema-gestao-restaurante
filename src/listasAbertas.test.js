import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nomeAutomatico, nomeDaLista, listasAbertas, listaPorId,
  listasOciosas, horasAteApagar, proximaAtiva, OCIOSA_HORAS,
} from './listasAbertas.js';

const H = 3600 * 1000;

describe('o nome automático', () => {
  test('é data, hora e quem criou', () => {
    const d = new Date(2026, 9, 4, 21, 14);     // 04/10/2026 21:14 local
    assert.equal(nomeAutomatico(d, 'Mário'), '04/10 · 21:14 · Mário');
  });

  test('usa a hora LOCAL, não UTC', () => {
    // ⚠️ O Amapá é UTC−3: às 21h o UTC já é o dia seguinte, e uma lista criada
    // à noite nasceria com a data de amanhã.
    const d = new Date(2026, 9, 4, 23, 30);
    assert.ok(nomeAutomatico(d, '').startsWith('04/10 · 23:30'), nomeAutomatico(d, ''));
  });

  test('sem usuário, fica só data e hora', () => {
    assert.equal(nomeAutomatico(new Date(2026, 9, 4, 7, 5), ''), '04/10 · 07:05');
  });

  test('nome em branco VOLTA para o automático, nunca grava vazio', () => {
    // Uma lista sem nome na barra do topo é uma lista que ninguém sabe qual é.
    const d = new Date(2026, 9, 4, 21, 14);
    assert.equal(nomeDaLista('   ', d, 'Mário'), '04/10 · 21:14 · Mário');
    assert.equal(nomeDaLista('', d, 'Mário'), '04/10 · 21:14 · Mário');
    assert.equal(nomeDaLista('Feira de sábado', d, 'Mário'), 'Feira de sábado');
  });
});

describe('as listas abertas saem do db', () => {
  test('a lista EM USO aparece mesmo sem cadastro nenhum', () => {
    // ⚠️ É o estado de toda a operação de hoje: itens com listaId e nenhuma
    // entrada em `listasCompra`. Exigir cadastro faria a lista em uso sumir
    // da tela no deploy.
    const ls = listasAbertas({
      listaAtualId: 'X',
      listaAtualAbertaEm: '2026-10-04T10:00:00Z',
      listaCompras: [
        { id: 'a', listaId: 'X', comprado: false, updatedAt: 1000 },
        { id: 'b', listaId: 'X', comprado: true, updatedAt: 2000 },
      ],
    });
    assert.equal(ls.length, 1);
    assert.equal(ls[0].id, 'X');
    assert.equal(ls[0].itens, 2);
    assert.equal(ls[0].pendentes, 1);
    assert.ok(ls[0].ativa);
    assert.ok(ls[0].nome, 'ficou sem rótulo');
  });

  test('a lista aberta existe mesmo vazia — é onde a próxima inserção cai', () => {
    const ls = listasAbertas({ listaAtualId: 'X', listaAtualAbertaEm: '2026-10-04T10:00:00Z' });
    assert.equal(ls.length, 1);
    assert.equal(ls[0].itens, 0);
  });

  test('o cadastro dá nome e autor; os itens dão a contagem', () => {
    const ls = listasAbertas({
      listasCompra: [{ id: 'X', nome: 'Feira de sábado', criadaPor: 'Patrícia', criadaEm: '2026-10-04T09:00:00Z' }],
      listaAtualId: 'X',
      listaCompras: [{ id: 'a', listaId: 'X', comprado: false, updatedAt: 5 }],
    });
    assert.equal(ls[0].nome, 'Feira de sábado');
    assert.equal(ls[0].criadaPor, 'Patrícia');
    assert.equal(ls[0].itens, 1);
  });

  test('itens de OUTRA lista viram outra lista — não somem', () => {
    // Antes isto era o órfão invisível de src/listaId.js.
    const ls = listasAbertas({
      listaAtualId: 'X',
      listaCompras: [
        { id: 'a', listaId: 'X', comprado: false, updatedAt: 10 },
        { id: 'b', listaId: 'Y', comprado: false, updatedAt: 20 },
        { id: 'c', listaId: 'Y', comprado: false, updatedAt: 30 },
      ],
    });
    assert.equal(ls.length, 2);
    assert.equal(listaPorId(ls, 'Y').pendentes, 2);
    assert.equal(listaPorId(ls, 'Y').ativa, false);
  });

  test('item SEM listaId não inventa lista', () => {
    const ls = listasAbertas({ listaAtualId: 'X', listaCompras: [{ id: 'a', comprado: false }] });
    assert.deepEqual(ls.map((l) => l.id), ['X']);
  });

  test('a ativa vem primeiro, e a ordem não oscila', () => {
    const base = {
      listaAtualId: 'X',
      listaCompras: [
        { id: 'a', listaId: 'Y', updatedAt: 900 },
        { id: 'b', listaId: 'X', updatedAt: 100 },
        { id: 'c', listaId: 'Z', updatedAt: 500 },
      ],
    };
    assert.deepEqual(listasAbertas(base).map((l) => l.id), ['X', 'Y', 'Z']);
    assert.deepEqual(listasAbertas(base).map((l) => l.id), ['X', 'Y', 'Z']);
  });
});

describe('as 48 horas', () => {
  const agora = Date.parse('2026-10-04T12:00:00Z');
  const comMovimento = (id, hAtras, extra = {}) => ({
    id, nome: id, itens: 3, pendentes: 1, ativa: false,
    movimento: agora - hAtras * H, ...extra,
  });

  test('sai a que passou de 48 h sem movimento', () => {
    const ids = listasOciosas([comMovimento('velha', 49), comMovimento('nova', 2)], agora);
    assert.deepEqual(ids, ['velha']);
  });

  test('exatamente 48 h já sai', () => {
    assert.deepEqual(listasOciosas([comMovimento('no-limite', OCIOSA_HORAS)], agora), ['no-limite']);
  });

  test('a conta é de OCIOSIDADE, não de idade', () => {
    // ⚠️ Por idade, uma lista aberta na segunda e usada todo dia sumiria na
    // quarta no meio da compra. O relógio reinicia a cada item mexido.
    const usadaHoje = listasAbertas({
      listaAtualId: 'OUTRA',
      listaCompras: [
        { id: 'a', listaId: 'antiga', updatedAt: agora - 200 * H },   // criada há 8 dias
        { id: 'b', listaId: 'antiga', updatedAt: agora - 1 * H },     // mexida há 1 h
      ],
    });
    assert.deepEqual(listasOciosas(usadaHoje, agora), []);
  });

  test('a ATIVA nunca sai sozinha', () => {
    // Ela está na tela de todo mundo; e o motivo de estar parada pode ser só a
    // loja ter fechado no fim de semana.
    assert.deepEqual(listasOciosas([comMovimento('ativa', 500, { ativa: true })], agora), []);
  });

  test('lista VAZIA sai — não há o que perder', () => {
    // ⚠️ Mudou junto com "apagar em vez de arquivar": o motivo de poupá-la era
    // "não há o que arquivar". Apagando, deixá-la para sempre encheria o
    // trocador de lista vazia, que é o que a limpeza existe para evitar. E as
    // 48 h de ociosidade já protegem a que alguém acabou de criar.
    assert.deepEqual(listasOciosas([comMovimento('vazia', 500, { itens: 0 })], agora), ['vazia']);
  });

  test('avisa ANTES, porque apagar não tem desfazer', () => {
    assert.equal(horasAteApagar(comMovimento('x', 47), agora), 1);
    assert.equal(horasAteApagar(comMovimento('x', 49), agora), 0);
    assert.equal(horasAteApagar(comMovimento('x', 0), agora), OCIOSA_HORAS);
    // A ativa e a sem data não estão na fila — logo, não têm contagem.
    assert.equal(horasAteApagar(comMovimento('x', 99, { ativa: true }), agora), null);
    assert.equal(horasAteApagar(comMovimento('x', 99, { movimento: 0 }), agora), null);
  });

  test('sem movimento conhecido, não sai', () => {
    // Chutar "nunca mexeram" apagaria uma lista sobre a qual não se sabe nada.
    assert.deepEqual(listasOciosas([comMovimento('sem-data', 500, { movimento: 0 })], agora), []);
  });
});

describe('quem fica aberta quando a ativa é arquivada', () => {
  test('a de movimento mais recente entre as que sobram', () => {
    const ls = [
      { id: 'X', movimento: 100, ativa: true },
      { id: 'Y', movimento: 900 },
      { id: 'Z', movimento: 500 },
    ];
    assert.equal(proximaAtiva(ls, 'X'), 'Y');
  });

  test('não sobrando nenhuma, devolve null — quem chama cria uma', () => {
    // A aba Lista nunca pode ficar sem lista aberta.
    assert.equal(proximaAtiva([{ id: 'X', movimento: 1, ativa: true }], 'X'), null);
  });

  test('o desempate é estável', () => {
    const ls = [{ id: 'X', ativa: true, movimento: 0 }, { id: 'b', movimento: 5 }, { id: 'a', movimento: 5 }];
    assert.equal(proximaAtiva(ls, 'X'), 'a');
    assert.equal(proximaAtiva(ls, 'X'), 'a');
  });
});
