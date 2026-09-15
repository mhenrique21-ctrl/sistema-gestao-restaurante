import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectarPlataforma, resolverOrigem, temLeitor, rotuloPlataforma } from './plataforma.js';

describe('de qual aplicativo veio a comanda', () => {
  test('reconhece o 99Food', () => {
    assert.equal(detectarPlataforma('99FOOD\nPedido #871001\nCobrar do cliente R$51,70'), '99food');
    assert.equal(detectarPlataforma('Pedido via 99 Food'), '99food');
  });

  test('reconhece o iFood', () => {
    assert.equal(detectarPlataforma('iFood\nPedido #4821\nENTREGA'), 'ifood');
    assert.equal(detectarPlataforma('www.ifood.com.br'), 'ifood');
  });

  test('"99food" não é confundido com "ifood"', () => {
    // A separação inteira depende disto: "99food" não contém "ifood".
    assert.equal(detectarPlataforma('99FOOD'), '99food');
    assert.notEqual(detectarPlataforma('99FOOD'), 'ifood');
  });

  test('acento quebrado pela térmica não impede o reconhecimento', () => {
    // Numa captura real a impressora devolveu "verificação" como "verificaúo".
    assert.equal(detectarPlataforma('PEDIDO IFOOD - CÓDIGO DE VERIFICAÇÃO'), 'ifood');
  });

  test('comanda de origem desconhecida não é chutada', () => {
    assert.equal(detectarPlataforma('CUPOM NAO FISCAL\nTOTAL 20,00'), '');
  });
});

describe('rótulo da pasta x conteúdo da comanda', () => {
  test('sem rótulo, vale o que a comanda diz', () => {
    assert.deepEqual(resolverOrigem('', 'iFood pedido 1'), { origem: 'ifood', avisos: [] });
  });

  test('sem nada reconhecível, o rótulo da pasta vale', () => {
    assert.deepEqual(resolverOrigem('ifood', 'COMANDA\nTOTAL 10,00'), { origem: 'ifood', avisos: [] });
  });

  test('pasta trocada: a COMANDA vence e o erro aparece', () => {
    // Seguir o rótulo mandaria um pedido do iFood pro canal 99Food em Vendas —
    // taxas diferentes, faturamento errado, nada denunciando.
    const r = resolverOrigem('99food', 'iFood\nPedido #4821');
    assert.equal(r.origem, 'ifood');
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /99Food/);
    assert.match(r.avisos[0], /iFood/);
  });
});

describe('leitor por plataforma', () => {
  test('o do 99Food existe; o do iFood ainda não', () => {
    assert.equal(temLeitor('99food'), true);
    // Escrito em cima de layout imaginado seria o erro que este projeto já
    // pagou duas vezes. Sem comanda real, a captura guarda e avisa.
    assert.equal(temLeitor('ifood'), false);
    assert.equal(temLeitor(''), false);
  });

  test('o rótulo de tela nunca sai vazio', () => {
    assert.equal(rotuloPlataforma('99food'), '99Food');
    assert.equal(rotuloPlataforma('ifood'), 'iFood');
    assert.equal(rotuloPlataforma(''), 'origem desconhecida');
  });
});
