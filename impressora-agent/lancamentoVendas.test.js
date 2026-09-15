import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lancamentoDoPedido, lancamentoDoDia, entregaDaPlataforma } from './lancamentoVendas.js';

// O pedido real de 15/09/2026, 20:10 — R$ 29,90 de bolo, R$ 15,00 de promoção,
// entrega da parceira. É em cima dele que as três decisões foram tomadas.
const BOLO_COM_DESCONTO = {
  plataforma: 'ifood', numero: '8290', tipoEntrega: 'Entrega Parceira',
  total: 29.90, taxaServico: 0.99, taxaEntrega: 7.00, descontos: 15.00,
  pagoPeloApp: 22.89, cobrarDoCliente: 0,
};

describe('as três decisões do dono, no pedido que as originou', () => {
  const l = lancamentoDoPedido(BOLO_COM_DESCONTO);

  test('1. o faturamento é o que o cliente PAGOU, não a mercadoria de tabela', () => {
    assert.equal(l.bruto, 22.89);
    assert.notEqual(l.bruto, 29.90, 'a mercadoria de tabela não é o faturamento');
  });

  test('2. taxa de serviço E entrega da parceira são despesa do canal', () => {
    // 0,99 o cliente paga e a plataforma fica; 7,00 é a entrega que ela fez.
    assert.equal(l.taxa, 7.99);
    assert.equal(l.liquido, 14.90, 'o que a loja vendeu, antes da comissão');
  });

  test('3. o desconto NÃO vira despesa — já está dentro do que o cliente pagou', () => {
    // Somar os R$ 15,00 como despesa contaria o mesmo dinheiro duas vezes: o
    // cliente já pagou 22,89 em vez de 37,89. Regra do folhaRh: cada real
    // aparece UMA vez.
    assert.equal(l.desconto, 15);
    assert.equal(l.bruto - l.taxa, l.liquido);
    assert.equal(l.liquido, 14.90, 'o desconto não pode aparecer de novo aqui');
  });
});

describe('entrega própria x entrega da plataforma', () => {
  test('na entrega PRÓPRIA a taxa fica com a loja: receita, não despesa', () => {
    // Aplicar "despesa do canal" nos dois casos tiraria do faturamento um
    // dinheiro que entrou na gaveta da loja.
    const l = lancamentoDoPedido({
      plataforma: 'ifood', numero: '1', tipoEntrega: 'Entrega Propria',
      taxaServico: 0.99, taxaEntrega: 10, pagoPeloApp: 44.87, cobrarDoCliente: 0,
    });
    assert.equal(l.taxa, 0.99, 'só a taxa de serviço');
    assert.equal(l.liquido, 43.88);
  });

  test('sem saber quem entregou, a taxa fica FORA e sai aviso', () => {
    // Chutar "parceira" tiraria do faturamento um dinheiro que pode ter
    // entrado na gaveta. Pendência na tela, nunca palpite.
    const l = lancamentoDoPedido({
      plataforma: 'ifood', numero: '2', tipoEntrega: null,
      taxaEntrega: 7, pagoPeloApp: 30, cobrarDoCliente: 0,
    });
    assert.equal(l.taxa, 0);
    assert.match(l.avisos.join(' '), /não sei quem entregou/);
  });

  test('reconhece as três formas que as comandas usam', () => {
    assert.equal(entregaDaPlataforma('Entrega Parceira'), true);
    assert.equal(entregaDaPlataforma('Entrega da plataforma'), true);
    assert.equal(entregaDaPlataforma('| Entrega Propria |'), false);
    assert.equal(entregaDaPlataforma(''), null);
  });
});

describe('o dinheiro que o entregador recebe na porta', () => {
  test('entra como DINHEIRO do dia, não como repasse da plataforma', () => {
    // Trocar um pelo outro joga dinheiro de caixa na conta a receber da
    // plataforma — e o caixa do dia fecha errado.
    const dia = lancamentoDoDia('2026-09-15', [{
      plataforma: 'ifood', numero: '9', tipoEntrega: 'Entrega Propria',
      pagoPeloApp: 0, cobrarDoCliente: 51.70,
    }]);
    assert.equal(dia.dinheiro, 51.70);
    assert.equal(dia.ifood, 0);
    assert.equal(dia.total, 51.70);
  });
});

describe('a mesma comanda impressa DUAS vezes', () => {
  test('não dobra o faturamento do dia', () => {
    // A via da cozinha e a da sacola são capturadas as duas, com 1 segundo de
    // diferença. Somando, o dia dobra em silêncio e só apareceria no mês.
    const dia = lancamentoDoDia('2026-09-15', [BOLO_COM_DESCONTO, { ...BOLO_COM_DESCONTO }]);
    assert.equal(dia.pedidos, 1);
    assert.equal(dia.ifood, 22.89);
    assert.match(dia.avisos.join(' '), /repetida/);
  });

  test('mesmo número em canais diferentes NÃO é repetição', () => {
    const dia = lancamentoDoDia('2026-09-15', [
      { plataforma: 'ifood', numero: '100', tipoEntrega: 'Entrega Parceira', pagoPeloApp: 10, cobrarDoCliente: 0 },
      { plataforma: '99food', numero: '100', tipoEntrega: 'Entrega da plataforma', pagoPeloApp: 20, cobrarDoCliente: 0 },
    ]);
    assert.equal(dia.pedidos, 2);
    assert.equal(dia.ifood, 10);
    assert.equal(dia['99food'], 20);
  });

  test('pedido sem número entra e é SINALIZADO, não descartado', () => {
    // Descartar seria perder venda de verdade por causa de uma linha que o
    // leitor não entendeu.
    const dia = lancamentoDoDia('2026-09-15', [
      { plataforma: 'ifood', numero: null, tipoEntrega: 'Entrega Parceira', pagoPeloApp: 30, cobrarDoCliente: 0 },
    ]);
    assert.equal(dia.pedidos, 1);
    assert.equal(dia.ifood, 30);
    assert.match(dia.avisos.join(' '), /sem número/);
  });
});

describe('o dia inteiro, com os dois canais', () => {
  const dia = lancamentoDoDia('2026-09-15', [
    BOLO_COM_DESCONTO,
    { plataforma: 'ifood', numero: '8271', tipoEntrega: 'Entrega Parceira',
      taxaEntrega: 0, pagoPeloApp: 25.40, cobrarDoCliente: 0 },
    { plataforma: '99food', numero: '871001', tipoEntrega: 'Entrega da plataforma',
      taxaEntrega: 5, pagoPeloApp: 0, cobrarDoCliente: 51.70 },
  ]);

  test('cada canal na própria coluna', () => {
    assert.equal(dia.ifood, 48.29);      // 22,89 + 25,40
    assert.equal(dia.ifoodTaxa, 7.99);   // só o primeiro tem taxa
    assert.equal(dia.ifoodLiq, 40.30);
    assert.equal(dia['99food'], 0);      // foi pago na porta
    assert.equal(dia.nfoodTaxa, 5);
  });

  test('o total do dia é o que ENTROU: app + porta', () => {
    // As taxas não saem do total — elas têm coluna própria. Descontá-las aqui
    // esconderia o tamanho do canal.
    assert.equal(dia.dinheiro, 51.70);
    assert.equal(dia.total, 99.99);      // 48,29 + 0 + 51,70
  });

  test('os descontos do dia ficam à parte, fora de toda soma', () => {
    assert.equal(dia.descontos, 15);
    assert.equal(dia.total, round(dia.ifood + dia['99food'] + dia.dinheiro));
    function round(n) { return Math.round(n * 100) / 100; }
  });
});
