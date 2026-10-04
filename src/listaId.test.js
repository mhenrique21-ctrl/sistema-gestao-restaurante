import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { proximaListaId, ID_LISTA_INICIAL } from './listaId.js';

describe('a identidade da lista que sucede uma arquivada', () => {
  test('todo aparelho que fecha a MESMA lista chega no MESMO id', () => {
    // É o ponto inteiro: no fechamento automático os aparelhos disparam juntos.
    assert.equal(proximaListaId('lista-X'), proximaListaId('lista-X'));
  });

  test('listas diferentes dão ids diferentes', () => {
    assert.notEqual(proximaListaId('lista-X'), proximaListaId('lista-Y'));
  });

  test('o id NÃO cresce a cada fechamento', () => {
    // ⚠️ Derivar por concatenação ("pos-"+id) também seria determinístico e
    // cresceria para sempre — uma lista por dia vira um id de milhares de
    // caracteres dentro de TODO item da lista.
    let id = ID_LISTA_INICIAL;
    const tamanhos = new Set();
    for (let i = 0; i < 500; i++) { id = proximaListaId(id); tamanhos.add(id.length); }
    assert.equal(tamanhos.size, 1, 'o tamanho do id variou ao longo da corrente');
    assert.ok(id.length <= 20, `id ficou com ${id.length} caracteres`);
  });

  test('500 fechamentos encadeados não repetem id', () => {
    let id = ID_LISTA_INICIAL;
    const vistos = new Set([id]);
    for (let i = 0; i < 500; i++) { id = proximaListaId(id); assert.ok(!vistos.has(id), 'colidiu'); vistos.add(id); }
  });

  test('sem lista anterior, cai na constante — nunca num id por aparelho', () => {
    assert.equal(proximaListaId(''), ID_LISTA_INICIAL);
    assert.equal(proximaListaId(null), ID_LISTA_INICIAL);
  });
});

// ── A reprodução do problema relatado ───────────────────────────────────────
// "Insiro na lista e não atualiza para os outros usuários, quando a lista
// anterior ainda não foi cancelada."
describe('dois aparelhos fechando a lista ao mesmo tempo', () => {
  // A regra de fusão do `listaAtualId`, como está no App.tsx e no
  // mergeListaCompras.js: vence o `abertaEm` estritamente MAIOR; no empate
  // vence o servidor.
  const fundir = (servidor, local) => {
    const sAb = servidor.abertaEm ? Date.parse(servidor.abertaEm) : 0;
    const pAb = local.abertaEm ? Date.parse(local.abertaEm) : 0;
    return (local.id && pAb > sAb) ? local : servidor;
  };
  // O filtro da tela: item de outra lista NÃO aparece (vira órfão).
  const aparecemNaTela = (itens, listaAtualId) =>
    itens.filter((i) => !i.listaId || i.listaId === listaAtualId);

  // Celular e computador, os dois com a lista aberta, marcam o último pendente.
  // A contagem de 10 s dispara nos dois; o computador grava 5 s depois.
  const fecharEm = (atual, quando, novoId) => ({ id: novoId(atual), abertaEm: quando });

  test('com id por aparelho (uid), o item inserido SOME da tela de todos', () => {
    let n = 0;
    const uidFalso = () => `uid-${++n}`;             // o que o código fazia
    const celular = fecharEm('lista-X', '2026-10-04T10:00:00Z', uidFalso);
    const computador = fecharEm('lista-X', '2026-10-04T10:00:05Z', uidFalso);
    assert.notEqual(celular.id, computador.id, 'a premissa da reprodução');

    // O operador insere um item no CELULAR, antes de o aviso do computador chegar.
    const item = { id: 'i1', nome: 'ACUCAR', listaId: celular.id };

    // A fusão fica com quem fechou por último — o computador.
    const vencedor = fundir(computador, celular);
    assert.equal(vencedor.id, computador.id);

    // O item está no banco, chegou em todo aparelho... e não aparece em nenhum.
    assert.equal(aparecemNaTela([item], vencedor.id).length, 0,
      'a reprodução falhou: o item deveria estar órfão aqui');
  });

  test('com id DETERMINÍSTICO, o item aparece — é a correção', () => {
    const celular = fecharEm('lista-X', '2026-10-04T10:00:00Z', proximaListaId);
    const computador = fecharEm('lista-X', '2026-10-04T10:00:05Z', proximaListaId);
    assert.equal(celular.id, computador.id, 'os dois fecharam a mesma lista');

    const item = { id: 'i1', nome: 'ACUCAR', listaId: celular.id };
    const vencedor = fundir(computador, celular);

    assert.equal(aparecemNaTela([item], vencedor.id).length, 1,
      'o item continua sumindo depois da correção');
  });

  test('o `abertaEm` pode divergir à vontade: quem manda na tela é o ID', () => {
    // Três aparelhos fecham a mesma lista em instantes diferentes.
    const ids = ['10:00:00', '10:00:03', '10:00:09']
      .map((h) => fecharEm('lista-X', `2026-10-04T${h}Z`, proximaListaId).id);
    assert.equal(new Set(ids).size, 1, 'três aparelhos, três listas diferentes');
  });
});
