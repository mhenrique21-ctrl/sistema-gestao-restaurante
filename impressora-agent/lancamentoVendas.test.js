import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  lancamentoDoPedido, lancamentoDoDia, entregaDaPlataforma, dataDoPedido,
  taxaDoCanal, TAXA_PADRAO,
} from './lancamentoVendas.js';

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
    assert.equal(l.vendaLiquida, 14.90, 'o que a loja vendeu, antes da comissão');
  });

  test('3. o desconto NÃO vira despesa — já está dentro do que o cliente pagou', () => {
    // Somar os R$ 15,00 como despesa contaria o mesmo dinheiro duas vezes: o
    // cliente já pagou 22,89 em vez de 37,89. Regra do folhaRh: cada real
    // aparece UMA vez.
    assert.equal(l.desconto, 15);
    assert.equal(l.bruto - l.taxa, l.vendaLiquida);
    assert.equal(l.vendaLiquida, 14.90, 'o desconto não pode aparecer de novo aqui');
  });
});

describe('a comissão da plataforma (decisão do dono, 18/09/2026)', () => {
  test('incide sobre a venda LÍQUIDA, não sobre o bruto', () => {
    // 22,89 − 0,99 de serviço − 7,00 de entrega = 14,90. 27% disso são 4,02 e
    // sobram 10,88. Aplicando os 27% no bruto sairiam 6,18 de comissão — 2,16
    // de despesa inventada, em TODO pedido do canal.
    const l = lancamentoDoPedido(BOLO_COM_DESCONTO);
    assert.equal(l.comissaoPct, 27);
    assert.equal(l.comissao, 4.02);
    assert.equal(l.liquido, 10.88);
    assert.notEqual(l.comissao, 6.18, 'a comissão não sai do bruto');
  });

  test('cada canal tem a sua: 27% no iFood, 10% no 99Food', () => {
    const n = lancamentoDoPedido({
      plataforma: '99food', numero: '1', tipoEntrega: 'Entrega da plataforma',
      taxaServico: 0, taxaEntrega: 0, pagoPeloApp: 100, cobrarDoCliente: 0,
    });
    assert.equal(n.comissaoPct, 10);
    assert.equal(n.liquido, 90);
  });

  test('a taxa vem do contrato e pode ser trocada no config.bat', () => {
    // Plano novo, promoção de taxa, mudança de categoria: quem muda é quem
    // negociou. Não é medida do extrato — seria estimativa sobre estimativa.
    const l = lancamentoDoPedido(BOLO_COM_DESCONTO, { ifood: 20 });
    assert.equal(l.comissaoPct, 20);
    assert.equal(l.liquido, 11.92);           // 14,90 × 0,80
  });

  test('configuração pela metade NÃO vira comissão zero', () => {
    // Zero devolveria o faturamento inflado exatamente como antes, e calado.
    assert.equal(taxaDoCanal('ifood', { '99food': 10 }), TAXA_PADRAO.ifood);
    assert.equal(taxaDoCanal('ifood', { ifood: 'abc' }), 27);
    assert.equal(taxaDoCanal('99food', undefined), 10);
    assert.equal(taxaDoCanal('ifood', { ifood: 0 }), 0, 'zero explícito vale');
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
    assert.equal(l.vendaLiquida, 43.88);
    assert.equal(l.liquido, 32.03);           // 43,88 × 0,73
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

  test('entra INTEIRO e o aviso diz por quê', () => {
    // A comissão sobre o dinheiro da porta não está na comanda. Entra cheio e
    // aparece no aviso — uma vez por dia, não por pedido.
    const dia = lancamentoDoDia('2026-09-15', [{
      plataforma: 'ifood', numero: '9', tipoEntrega: 'Entrega Propria',
      pagoPeloApp: 0, cobrarDoCliente: 51.70,
    }]);
    assert.match(dia.avisos.join(' '), /INTEIROS no total/);
    assert.equal(dia.avisos.filter((a) => /INTEIROS/.test(a)).length, 1);
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
    assert.equal(dia.ifood, 48.29);      // 22,89 + 25,40 — o que o cliente pagou
    assert.equal(dia.ifoodLiq, 29.42);   // 10,88 + 18,54
    assert.equal(dia['99food'], 0);      // foi pago na porta
  });

  test('a taxa do canal é PORCENTAGEM, porque é isso que a tela de Vendas lê', () => {
    // ⚠️ Mandando reais, o Histórico exibia "797,69 – 151.59%". A porcentagem
    // é EFETIVA: junta entrega, serviço e comissão, senão bruto e líquido não
    // fecham na linha que a tela calcula sozinha.
    assert.equal(dia.ifoodTaxa, 39.08);          // (48,29 − 29,42) / 48,29
    assert.ok(dia.ifoodTaxa < 100, 'porcentagem, nunca reais');
    const liqDaTela = Math.round(dia.ifood * (1 - dia.ifoodTaxa / 100) * 100) / 100;
    assert.ok(Math.abs(liqDaTela - dia.ifoodLiq) < 0.01, 'a conta da tela bate');
  });

  test('canal sem repasse nenhum não inventa porcentagem', () => {
    assert.equal(dia['99food'], 0);
    assert.equal(dia.nfoodTaxa, 0, 'dividir por zero viraria NaN na tela');
  });

  test('o total do dia é o LÍQUIDO mais o que entrou na porta', () => {
    // ⚠️ Era o BRUTO, e por isso o faturamento do mês saía inflado em ~30% no
    // iFood: entrega, serviço e comissão nunca chegam na loja. O bruto
    // continua na coluna do canal, que é onde ele responde "de que tamanho é
    // este canal".
    assert.equal(dia.dinheiro, 51.70);
    // ⚠️ O 99Food deste dia foi pago NA PORTA e a entrega foi da plataforma:
    // não houve repasse nenhum (bruto 0) e os R$ 5,00 da entrega continuam
    // sendo despesa do canal. O líquido dele fica NEGATIVO de propósito — é
    // dinheiro que a loja deve, e aparar em zero esconderia a despesa.
    assert.equal(dia.nfoodLiq, -4.50);
    assert.equal(dia.total, 76.62);              // 29,42 − 4,50 + 51,70
    assert.notEqual(dia.total, 99.99, 'o bruto não é o total do dia');
  });

  test('os descontos do dia ficam à parte, fora de toda soma', () => {
    assert.equal(dia.descontos, 15);
    assert.equal(dia.total, round(dia.ifoodLiq + dia.nfoodLiq + dia.dinheiro));
    function round(n) { return Math.round(n * 100) / 100; }
  });

  test('a despesa do canal em reais fica disponível pra tela do agente', () => {
    // iFood: 7,99 de taxa na comanda + 4,02 + 6,86 de comissão.
    assert.equal(dia.ifoodComissao, 10.88);
    // 99Food: 5,00 de entrega e −0,50 de comissão sobre um líquido negativo.
    assert.equal(dia.taxasEmReais, 23.37);
  });
});

describe('o que não é pedido não entra no dia', () => {
  test('comanda sem NENHUM valor de pagamento fica de fora, com aviso', () => {
    // Foi o que aconteceu na loja: cinco comandas de TESTE viraram cinco
    // "pedidos" de R$ 0,00 no dia. Entrar como zero inflaria a contagem de
    // pedidos com vendas que ninguém sabe quanto foram.
    const dia = lancamentoDoDia('2026-09-15', [
      { plataforma: '99food', numero: null, pagoPeloApp: null, cobrarDoCliente: null },
      { plataforma: '99food', numero: null, pagoPeloApp: null, cobrarDoCliente: null },
    ]);
    assert.equal(dia.pedidos, 0);
    assert.equal(dia.total, 0);
    assert.match(dia.avisos.join(' '), /ficou FORA do dia/);
  });

  test('o aviso não pode contradizer o número que sobe', () => {
    // A primeira versão dizia "não entra no dia" e entrava assim mesmo. Aviso
    // que contradiz o número é pior que nenhum aviso: ensina a não ler.
    const dia = lancamentoDoDia('2026-09-15', [
      { plataforma: 'ifood', numero: '1', tipoEntrega: 'Entrega Parceira', pagoPeloApp: 30, cobrarDoCliente: 0 },
      { plataforma: 'ifood', numero: '2', pagoPeloApp: null, cobrarDoCliente: null },
    ]);
    assert.equal(dia.pedidos, 1, 'só o que tem valor conta');
    assert.equal(dia.ifood, 30);
    assert.match(dia.avisos.join(' '), /pedido 2/);
  });

  test('cobrança na porta SEM repasse continua valendo', () => {
    // Zero no app não é "sem valor": é pedido pago na porta.
    const dia = lancamentoDoDia('2026-09-15', [
      { plataforma: '99food', numero: '3', tipoEntrega: 'Entrega da plataforma',
        pagoPeloApp: 0, cobrarDoCliente: 51.70 },
    ]);
    assert.equal(dia.pedidos, 1);
    assert.equal(dia.dinheiro, 51.70);
  });
});

describe('frete grátis do 99Food (comanda real #871010)', () => {
  const PEDIDO = {
    plataforma: '99food', numero: '871010', tipoEntrega: 'Entrega da plataforma',
    subtotal: 39.90, taxaEntrega: 3.99, entregaPromocional: 3.99, taxaServico: 2.40,
    total: 42.30, pagoPeloApp: 42.30, cobrarDoCliente: 0,
  };

  test('a entrega promocional ANULA a taxa de entrega na despesa do canal', () => {
    // O 99Food cobrou 3,99 e devolveu os mesmos 3,99: o cliente não pagou
    // frete. Contar os 3,99 como despesa inventaria uma despesa que não houve.
    const l = lancamentoDoPedido(PEDIDO);
    assert.equal(l.bruto, 42.30);
    assert.equal(l.taxa, 2.40, 'só a taxa de serviço');
    assert.equal(l.vendaLiquida, 39.90, 'bate com o subtotal — a mercadoria vendida');
    assert.equal(l.liquido, 35.91, 'e 10% de comissão sobre ela');
  });

  test('sem promoção, a entrega volta a ser despesa', () => {
    const l = lancamentoDoPedido({ ...PEDIDO, entregaPromocional: null });
    assert.equal(l.taxa, 6.39);
    assert.equal(l.vendaLiquida, 35.91);
    assert.equal(l.liquido, 32.32);
  });

  test('promoção maior que a taxa não vira despesa negativa', () => {
    // Taxa negativa somaria ao líquido — faturamento inventado.
    const l = lancamentoDoPedido({ ...PEDIDO, taxaEntrega: 3.99, entregaPromocional: 10 });
    assert.equal(l.taxa, 2.40);
  });
});

describe('reimpressão não é venda nova', () => {
  // No primeiro lote real, a comanda de teste reimpressa criou R$ 51,70 de
  // "dinheiro na porta" em DOIS dias diferentes, de uma venda que aconteceu
  // uma vez só. A comanda sai de novo quando trava o papel, quando alguém
  // testa, quando a cozinha perde a via.
  test('pedido de outro dia fica FORA e aparece no aviso', () => {
    const dia = lancamentoDoDia('2026-09-17', [
      { plataforma: '99food', numero: '871001', aceitoEm: '15 de set 18:45',
        tipoEntrega: 'Entrega da plataforma', pagoPeloApp: 0, cobrarDoCliente: 51.70 },
    ]);
    assert.equal(dia.pedidos, 0);
    assert.equal(dia.total, 0);
    assert.match(dia.avisos.join(' '), /871001 é de 2026-09-15 — reimpressão/);
  });

  test('pedido do próprio dia entra normalmente', () => {
    const dia = lancamentoDoDia('2026-09-15', [
      { plataforma: '99food', numero: '871001', aceitoEm: '15 de set 18:45',
        tipoEntrega: 'Entrega da plataforma', pagoPeloApp: 0, cobrarDoCliente: 51.70 },
    ]);
    assert.equal(dia.pedidos, 1);
    assert.equal(dia.dinheiro, 51.70);
  });

  test('sem data legível, vale o dia da captura', () => {
    // É o que se sabe. Descartar seria perder venda de verdade por causa de
    // uma linha que o leitor não entendeu.
    const dia = lancamentoDoDia('2026-09-17', [
      { plataforma: 'ifood', numero: '9', tipoEntrega: 'Entrega Parceira',
        pagoPeloApp: 30, cobrarDoCliente: 0 },
    ]);
    assert.equal(dia.pedidos, 1);
    assert.equal(dia.ifood, 30);
  });
});

describe('a data que a própria comanda carrega', () => {
  test('iFood traz dia, mês e ano', () => {
    assert.equal(dataDoPedido({ data: '15/09/2026 16:29:39' }, '2026-09-17'), '2026-09-15');
  });

  test('99Food traz "15 de set" — o ano sai do dia da captura', () => {
    assert.equal(dataDoPedido({ aceitoEm: '15 de set 18:45' }, '2026-09-17'), '2026-09-15');
    assert.equal(dataDoPedido({ aceitoEm: '1 de jan 08:00' }, '2026-01-02'), '2026-01-01');
  });

  test('data que cairia no FUTURO é do ano passado', () => {
    // Pedido de dezembro relido em janeiro. Chutar o ano corrente sempre
    // jogaria esse pedido 12 meses à frente, num dia que ainda não existe.
    assert.equal(dataDoPedido({ aceitoEm: '28 de dez 19:00' }, '2026-01-05'), '2025-12-28');
  });

  test('sem data nenhuma devolve o dia da captura', () => {
    assert.equal(dataDoPedido({}, '2026-09-17'), '2026-09-17');
    assert.equal(dataDoPedido({ aceitoEm: 'coisa nenhuma' }, '2026-09-17'), '2026-09-17');
  });
});
