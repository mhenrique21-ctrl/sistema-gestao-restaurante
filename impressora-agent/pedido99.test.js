import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { lerPedido99, conferirPedido99, ehComanda99, valorBR } from './pedido99.js';

// Comanda REAL, pedido #871001 de 14/09/2026. Transcrita do papel — é ela que
// define o formato, não um layout imaginado.
const COMANDA = `Confraria Café
#871001
Nome do teste
Entrega da plataforma
Código de verificação
#9877
Endereço    Central, Macapá - AP, 68900-
041, Brasil test
Observações do pedido
Cancelar apenas o que está em falta
1x  Suco Abacaxi c/ Hortelã        R$11,90
1x  Suco de graviola               R$11,90
1x  Croissant de queijo e salame   R$27,90
Subtotal                           R$51,70
Total do pedido                    R$51,70
Pagamento via 99Food               R$0,00
Cobrar do cliente
R$51,70
Pagamento em dinheiro
Horário do aceite do pedido 14 de set 11:25`;

test('a comanda real é lida inteira', () => {
  const p = lerPedido99(COMANDA);
  assert.equal(p.loja, 'Confraria Café');
  assert.equal(p.numero, '871001');
  assert.equal(p.cliente, 'Nome do teste');
  assert.equal(p.tipoEntrega, 'Entrega da plataforma');
  assert.equal(p.codigoVerificacao, '9877');
  assert.deepEqual(p.observacoes, ['Cancelar apenas o que está em falta']);
  assert.equal(p.formaPagamento, 'Pagamento em dinheiro');
  assert.equal(p.aceitoEm, '14 de set 11:25');
  assert.deepEqual(p.naoEntendido, []);
});

test('os três itens saem com quantidade, nome e valor', () => {
  const { itens } = lerPedido99(COMANDA);
  assert.equal(itens.length, 3);
  assert.deepEqual(itens[0], { qtd: 1, nome: 'Suco Abacaxi c/ Hortelã', valor: 11.90 });
  assert.deepEqual(itens[2], { qtd: 1, nome: 'Croissant de queijo e salame', valor: 27.90 });
});

test('repasse da plataforma e cobrança do cliente não se misturam', () => {
  // "Pagamento via 99Food" é o que a plataforma repassa; "Cobrar do cliente" é
  // o que o entregador recebe na porta. Somar os dois dobraria o faturamento;
  // trocar um pelo outro jogaria dinheiro de caixa na conta a receber do 99Food.
  const p = lerPedido99(COMANDA);
  assert.equal(p.subtotal, 51.70);
  assert.equal(p.total, 51.70);
  assert.equal(p.pagoPeloApp, 0);
  assert.equal(p.cobrarDoCliente, 51.70);
});

test('"Cobrar do cliente" pega o valor da linha de baixo', () => {
  // Na comanda esse valor sai em fonte grande, sozinho na linha seguinte.
  // Procurar só na mesma linha devolveria null e o pedido iria sem o valor.
  assert.equal(lerPedido99('Cobrar do cliente\nR$51,70').cobrarDoCliente, 51.70);
  assert.equal(lerPedido99('Cobrar do cliente  R$51,70').cobrarDoCliente, 51.70);
});

test('endereço quebrado no meio do CEP é remontado sem inventar espaço', () => {
  const p = lerPedido99(COMANDA);
  assert.equal(p.endereco, 'Central, Macapá - AP, 68900-041, Brasil test');
});

test('pedido pago no aplicativo inverte os dois valores', () => {
  const p = lerPedido99(`Confraria Café
#871002
Cliente Dois
Entrega da plataforma
1x  Cafe Expresso                  R$8,00
Subtotal                           R$8,00
Total do pedido                    R$8,00
Pagamento via 99Food               R$8,00
Cobrar do cliente
R$0,00
Pagamento pelo app`);
  assert.equal(p.pagoPeloApp, 8);
  assert.equal(p.cobrarDoCliente, 0);
  assert.equal(p.formaPagamento, 'Pagamento pelo app');
  assert.deepEqual(conferirPedido99(p), []);
});

test('nome comprido leva o valor pra linha de baixo e ainda casa', () => {
  // Térmica quebra em 32 colunas e não avisa.
  const p = lerPedido99('#871004\nFulano\nEntrega da plataforma\n2x Croissant de queijo e salame com molho\nR$55,80\nSubtotal R$55,80');
  assert.deepEqual(p.itens, [{ qtd: 2, nome: 'Croissant de queijo e salame com molho', valor: 55.80 }]);
  assert.deepEqual(conferirPedido99(p), []);
});

test('linha que não casa com nada vira pendência, não palpite', () => {
  // ⚠️ MUDOU em 17/09: linha solta LOGO DEPOIS de um item agora é lida como
  // continuação do NOME dele, porque é o que ela é em quase toda comanda real
  // ("1x Coxinha de Frango com" / "Catupiry"). A pendência continua valendo
  // para o que aparece FORA do bloco de itens — que é onde uma linha nova de
  // verdade apareceria.
  const p = lerPedido99(`#871003
Fulano
Entrega da plataforma
1x Cafe R$8,00
Total do pedido R$8,00
Alguma coisa nova que o 99Food passou a imprimir`);
  assert.deepEqual(p.naoEntendido, ['Alguma coisa nova que o 99Food passou a imprimir']);
  assert.ok(conferirPedido99(p).some((a) => a.includes('não reconhecida')));
});

describe('o nome do item quebra — e leva o valor junto', () => {
  // Foi o que apareceu em QUASE TODA comanda real do 99Food depois que a
  // transcrição começou a funcionar: o item ficava com o nome pela metade e o
  // valor virava pendência, então "itens somam 19,90 e o subtotal diz 31,90"
  // saía em todo pedido e a conferência virava ruído.
  test('nome em duas linhas com o valor na primeira', () => {
    const p = lerPedido99(`#871001
Fulano
Entrega da plataforma
1x  Coxinha de Frango com   R$12,00
Catupiry
1x  Suco de Abacaxi          R$7,90
Subtotal                    R$19,90`);
    assert.deepEqual(p.itens.map((i) => i.nome),
      ['Coxinha de Frango com Catupiry', 'Suco de Abacaxi']);
    assert.deepEqual(p.itens.map((i) => i.valor), [12, 7.90]);
    assert.deepEqual(conferirPedido99(p), []);
  });

  test('nome em duas linhas com o valor na TERCEIRA', () => {
    // "1x Coxinha de Frango com / Catupiry / R$12,00" — a versão anterior
    // olhava uma linha à frente atrás do valor, e entre o item e o valor tinha
    // o resto do nome.
    const p = lerPedido99(`#871002
Fulano
Entrega da plataforma
1x  Coxinha de Frango com
Catupiry
R$12,00
Subtotal                    R$12,00`);
    assert.equal(p.itens.length, 1);
    assert.equal(p.itens[0].nome, 'Coxinha de Frango com Catupiry');
    assert.equal(p.itens[0].valor, 12);
    assert.deepEqual(conferirPedido99(p), []);
  });

  test('a continuação PARA no bloco de totais', () => {
    // Sem parar, o "Subtotal" viraria parte do nome do último item e o pedido
    // inteiro se desmontaria.
    const p = lerPedido99(`#871003
Fulano
Entrega da plataforma
1x  Torta de limao          R$27,90
Subtotal                    R$27,90
Total do pedido             R$27,90`);
    assert.equal(p.itens[0].nome, 'Torta de limao');
    assert.equal(p.subtotal, 27.90);
    assert.equal(p.total, 27.90);
  });

  test('a hora do aceite que caiu na linha de baixo não vira pendência', () => {
    // "Horário de aceite do pedido:15 de set" / "16:00" — é a última linha da
    // comanda, então o ruído fechava a lista de pendências.
    const p = lerPedido99(`#871004
Fulano
Entrega da plataforma
1x Cafe R$8,00
Total do pedido R$8,00
Horário de aceite do pedido:15 de set
16:00`);
    assert.equal(p.aceitoEm, '15 de set 16:00');
    assert.deepEqual(p.naoEntendido, []);
  });
});

test('conferência acusa item que não foi lido', () => {
  // O subtotal do papel é a testemunha: se a soma não bate, faltou item — e é
  // melhor aparecer na tela do que entrar no Gestão com valor a menos.
  const p = lerPedido99('#1\nX\nEntrega\n1x Cafe R$8,00\nSubtotal R$19,90');
  assert.ok(conferirPedido99(p).some((a) => a.includes('subtotal diz 19.90')));
});

test('a comanda real passa na conferência', () => {
  assert.deepEqual(conferirPedido99(lerPedido99(COMANDA)), []);
});

test('valorBR entende milhar com ponto', () => {
  // Number('1.234,56') daria NaN e Number('1.234') daria mil duzentos e trinta
  // e quatro centésimos — erro que só apareceria no fechamento do mês.
  assert.equal(valorBR('R$1.234,56'), 1234.56);
  assert.equal(valorBR('R$ 0,00'), 0);
  assert.equal(valorBR('R$11,90'), 11.90);
  assert.equal(valorBR('-R$5,00'), -5);
  assert.equal(valorBR('sem valor'), null);
});

test('recibo que não é do 99Food não vira pedido', () => {
  assert.ok(ehComanda99(COMANDA));
  assert.ok(!ehComanda99('CUPOM NAO FISCAL\nObrigado pela preferencia'));
  assert.ok(!ehComanda99(''));
});

test('acento comido pela impressora não faz o rótulo sumir', () => {
  // Aconteceu de verdade numa captura: "Código de verificação" chegou como
  // "Cudigo de verificaúo" e "Observações" como "Observaç§es" — tabela de
  // caracteres diferente da esperada. Comparando a frase toda, o rótulo deixava
  // de existir e o endereço engolia o resto da comanda, itens inclusive.
  const p = lerPedido99(`#871001
Nome do teste
Entrega da plataforma
Cudigo de verificaúo
#9877
Endereúo    Central, Macapá - AP, 68900-
041, Brasil test
Observaç§es do pedido
Cancelar apenas o que está em falta
1x  Cafe Expresso                  R$8,00
Subtotal                           R$8,00
Total do pedido                    R$8,00`);
  assert.equal(p.codigoVerificacao, '9877');
  assert.equal(p.endereco, 'Central, Macapá - AP, 68900-041, Brasil test');
  assert.deepEqual(p.observacoes, ['Cancelar apenas o que está em falta']);
  assert.equal(p.itens.length, 1);
  assert.deepEqual(p.naoEntendido, []);
});

test('item chamado "Desconto" continua sendo item', () => {
  // Se o rótulo ganhasse do item, o pedido viraria um abatimento de R$5 e o
  // total deixaria de fechar.
  const p = lerPedido99('#1\nFulano\nEntrega\n1x Desconto especial R$5,00\nSubtotal R$5,00');
  assert.deepEqual(p.itens, [{ qtd: 1, nome: 'Desconto especial', valor: 5 }]);
  assert.equal(p.desconto, null);
});

test('taxa de entrega e desconto entram quando existem', () => {
  const p = lerPedido99(`#2
Fulano
Entrega da plataforma
1x Cafe R$8,00
Subtotal R$8,00
Taxa de entrega R$4,50
Desconto -R$1,00
Total do pedido R$11,50`);
  assert.equal(p.taxaEntrega, 4.50);
  // ⚠️ MUDOU em 17/09: o desconto era guardado CRU (-1) e passou a ser guardado
  // POSITIVO, como o `descontos` do iFood e a "Entrega promocional". O campo
  // quer dizer "quanto foi abatido"; o sinal fica na fórmula. Com o valor cru,
  // a conferência nova (subtotal + taxas − abatimentos = total) SOMARIA o
  // abatimento em vez de subtrair, e o erro apareceria como um total que não
  // fecha por duas vezes o desconto.
  assert.equal(p.desconto, 1);
  assert.equal(p.total, 11.50);
  // 8,00 + 4,50 − 1,00 = 11,50. (A comanda de mentira deste teste não tem
  // número nem cabeçalho, então a conferência acusa outras coisas — o que
  // importa aqui é que a conta do TOTAL fecha.)
  assert.ok(!conferirPedido99(p).some((a) => a.includes('o total diz')));
});

// Comanda REAL da Confraria no 99Food, pedido #871010 de 15/09/2026, lida da
// imagem capturada pela ponte (a do 99Food chega desenhada, não como texto —
// ver o README). Dados do cliente trocados; o que o teste trava é a FORMA e a
// CONTA, e esta comanda trouxe duas linhas que a #871001 não tinha.
const COMANDA_871010 = `99 Food
Confraria Café
#871010
Cliente Exemplo
Entrega da plataforma
Código de verificação
#2377
Endereço   Avenida Exemplo, 707
Central, Macapá - AP ao lado
do mercado
Observações do pedido
Cancelar apenas o que está em falta
1x  Coxinha de Frango com
Catupiry                 R$12,00
1x  Torta Banoffe        R$27,90
Subtotal                 R$39,90
Taxa de entrega           R$3,99
Entrega promocional para cliente  -R$3,99
Taxa de serviço           R$2,40
Total do pedido          R$42,30
Pagamento via 99Food     R$42,30
Cobrar do cliente         R$0,00
Horário de aceite do pedido:15 de set 18:45`;

describe('comanda real #871010 — frete grátis e taxa de serviço', () => {
  const p = lerPedido99(COMANDA_871010);

  test('cabeçalho e código de verificação', () => {
    assert.equal(p.numero, '871010');
    assert.equal(p.cliente, 'Cliente Exemplo');
    assert.equal(p.tipoEntrega, 'Entrega da plataforma');
    assert.equal(p.codigoVerificacao, '2377');
  });

  test('"Entrega promocional" é guardada POSITIVA, como abatimento', () => {
    // A comanda escreve "-R$3,99" porque para ela é desconto. Guardando cru, a
    // conferência somaria em vez de subtrair, e o total não fecharia por duas
    // vezes o valor.
    assert.equal(p.entregaPromocional, 3.99);
    assert.equal(p.taxaEntrega, 3.99);
    assert.equal(p.taxaServico, 2.40);
  });

  test('a conta do 99Food fecha dos DOIS lados', () => {
    // repasse + cobrança = total …
    assert.equal(p.total, 42.30);
    assert.equal(p.pagoPeloApp, 42.30);
    assert.equal(p.cobrarDoCliente, 0);
    // … e subtotal + taxas − abatimentos = total
    assert.equal(p.subtotal, 39.90);
    assert.deepEqual(conferirPedido99(p), []);
  });

  test('sem as duas linhas novas, o total deixaria de fechar', () => {
    // É o que prova que a segunda conta serve pra alguma coisa: uma taxa nova
    // que o leitor não conheça passa a aparecer, em vez de entrar calada.
    const semTaxaServico = { ...p, taxaServico: null };
    assert.match(conferirPedido99(semTaxaServico).join(' '), /39\.90 e o total diz 42\.30/);
  });

  test('itens com nome quebrado em duas linhas', () => {
    assert.equal(p.itens.length, 2);
    assert.equal(p.itens[0].valor, 12);
    assert.equal(p.itens[1].nome, 'Torta Banoffe');
    assert.equal(p.itens[1].valor, 27.90);
  });

  test('nenhuma pendência sobra', () => {
    assert.deepEqual(p.naoEntendido, []);
  });
});
