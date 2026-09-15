import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lerPedidoIfood, conferirPedidoIfood, ehComandaIfood, valorBR } from './pedidoIfood.js';

// Comanda REAL capturada no PC do caixa em 15/09/2026 — pedido de teste do
// próprio iFood, então não tem dado de cliente de verdade. Copiada como saiu
// do .txt do agente, com a indentação preservada: ela é que separa item de
// complemento.
const COMANDA = `iFood
         Confraria Cafe
            EXPEDICAO

--------------------------------

    ** PREPARO PRIORITARIO **

--------------------------------

          PEDIDO: #1234
+------------------------------+
|        Entrega Propria       |
|       TURBO TURBO TURBO      |
+------------------------------+

 CODIGO DE COLETA PARCEIRA: 0000
--------------------------------
 *POR FAVOR, CONFIRME A ENTREGA*

--------------------------------

Data: 15/09/2026 13:38:57
Entrega prevista: 14:38 <<<<<<<<
Localizador: 1991 8685
Primeiro pedido!

Nome Do Cliente

0800 007 0110 ID: 19918685
Endereco: Pedido de teste (NAO
ENTREGAR) - Rua Teste, 1234
Comp: Complemento 123
Bairro: Bairro
Cidade: Cidade - Estado - CEP:
12345678
--------------------------------
ITENS DO PEDIDO (3)
1x  PEDIDO DE TESTE -    R$ 6,99
    ITEM 1 - NAO
    ENTREGAR

1x  PEDIDO DE TESTE -    R$ 6,99
    ITEM 2 - NAO
    ENTREGAR
    Obs: Sem cebola, por favor.

1x  PEDIDO DE TESTE -    R$ 6,99
    COMBO
    1 Chilli             R$ 1,99
    1 Ketchup            R$ 1,99
    1 Complemento 1      R$ 1,99
    1 Sanduiche          R$ 1,99
      1 Catchup Kito     R$ 0,99
      The Ketchup 190g
      1 Complemento 2    R$ 0,99
      1 Complemento 7    R$ 0,99
      1 Complemento 6    R$ 0,99
      1 Complemento 1    R$ 0,99

--------------------------------
     * Pagamento realizado *
    Online - OUTROS - SODEXO
            REFEICAO
--------------------------------
Valor total do        R$ 33,88
pedido:
Taxa de servico:       R$ 0,99
Taxa de entrega:      R$ 10,00
Pagamento via iFood: -R$ 44,87
------------------------------
Cobrar do cliente:     R$ 0,00
--------------------------------
Gestor Web 9.342.0 - Desktop
8.10.0`;

describe('comanda real do iFood', () => {
  const p = lerPedidoIfood(COMANDA);

  test('reconhece que é do iFood', () => {
    assert.equal(ehComandaIfood(COMANDA), true);
    assert.equal(ehComandaIfood('CUPOM NAO FISCAL\nTOTAL 20,00'), false);
  });

  test('cabeçalho', () => {
    assert.equal(p.loja, 'Confraria Cafe');
    assert.equal(p.numero, '1234');
    assert.equal(p.localizador, '1991 8685');
    assert.equal(p.cliente, 'Nome Do Cliente');
    assert.equal(p.prioritario, true);
    assert.match(p.tipoEntrega, /Entrega Propria/);
    assert.equal(p.codigoColeta, '0000');
    assert.equal(p.data, '15/09/2026 13:38:57');
  });

  test('a seta de destaque não entra na previsão', () => {
    // A comanda escreve "Entrega prevista: 14:38 <<<<<<<<" — o "<<<" é ênfase
    // impressa, não conteúdo.
    assert.equal(p.previsao, '14:38');
  });

  test('endereço quebrado em duas linhas volta inteiro', () => {
    assert.equal(p.endereco, 'Pedido de teste (NAO ENTREGAR) - Rua Teste, 1234');
    assert.equal(p.complementoEndereco, 'Complemento 123');
    assert.equal(p.bairro, 'Bairro');
  });

  test('o CEP que caiu na linha de baixo não vira endereço inventado', () => {
    assert.equal(p.cidade, 'Cidade - Estado - CEP: 12345678');
  });

  test('três itens, com o nome remontado das linhas quebradas', () => {
    assert.equal(p.itens.length, 3);
    assert.deepEqual(
      p.itens.map((i) => i.nome),
      ['PEDIDO DE TESTE - ITEM 1 - NAO ENTREGAR',
       'PEDIDO DE TESTE - ITEM 2 - NAO ENTREGAR',
       'PEDIDO DE TESTE - COMBO'],
    );
    assert.deepEqual(p.itens.map((i) => i.valor), [6.99, 6.99, 6.99]);
    assert.deepEqual(p.itens.map((i) => i.qtd), [1, 1, 1]);
  });

  test('a observação do item não vira parte do nome', () => {
    assert.equal(p.itens[1].obs, 'Sem cebola, por favor.');
    assert.ok(!p.itens[1].nome.includes('cebola'));
  });

  test('complementos ficam no item, não viram itens soltos', () => {
    // Sem a indentação mandando, "1 Chilli R$ 1,99" viraria um quarto item e o
    // ranking de produtos passaria a ter "Chilli" como prato vendido.
    assert.equal(p.itens[0].complementos.length, 0);
    assert.equal(p.itens[2].complementos.length, 9);
    assert.equal(p.itens[2].complementos[0].nome, 'Chilli');
    assert.equal(p.itens[2].complementos[0].valor, 1.99);
  });

  test('complemento DENTRO de complemento é nível 2', () => {
    const c = p.itens[2].complementos;
    assert.equal(c.find((x) => x.nome.startsWith('Chilli')).nivel, 1);
    assert.equal(c.find((x) => x.nome.startsWith('Catchup Kito')).nivel, 2);
  });

  test('nome de complemento quebrado em duas linhas é remontado', () => {
    // "The Ketchup 190g" vem sozinho embaixo de "1 Catchup Kito R$ 0,99".
    const c = p.itens[2].complementos.find((x) => x.nome.startsWith('Catchup'));
    assert.equal(c.nome, 'Catchup Kito The Ketchup 190g');
    assert.equal(p.itens[2].complementos.filter((x) => x.nome === 'The Ketchup 190g').length, 0);
  });

  test('forma de pagamento', () => {
    assert.match(p.formaPagamento, /Online - OUTROS - SODEXO/);
  });

  test('os valores, com o rótulo que quebrou em duas linhas', () => {
    // "Valor total do" leva o valor e "pedido:" cai sozinho embaixo.
    assert.equal(p.total, 33.88);
    assert.equal(p.taxaServico, 0.99);
    assert.equal(p.taxaEntrega, 10.00);
    assert.equal(p.cobrarDoCliente, 0);
  });

  test('o repasse negativo da comanda é guardado POSITIVO', () => {
    // A comanda escreve "-R$ 44,87" porque para ela é abatimento. O campo quer
    // dizer "o que a plataforma repassa", igual ao do 99Food — guardar o sinal
    // cru obrigaria quem soma a saber de qual plataforma veio.
    assert.equal(p.pagoPeloApp, 44.87);
  });

  test('a comanda fecha consigo mesma', () => {
    // 33,88 + 0,99 + 10,00 = 44,87 = 44,87 + 0,00
    assert.deepEqual(conferirPedidoIfood(p), []);
  });

  test('nada de importante cai em "não entendi"', () => {
    assert.deepEqual(p.naoEntendido, []);
  });
});

describe('a conta do iFood não é a do 99Food', () => {
  test('taxas entram POR FORA do total do pedido', () => {
    // No 99Food repasse + cobrança = total. Aplicar essa fórmula aqui acusaria
    // divergência em todo pedido: aqui o total é só a mercadoria.
    const p = {
      numero: '1', itens: [{ valor: 33.88, complementos: [] }],
      total: 33.88, taxaServico: 0.99, taxaEntrega: 10,
      pagoPeloApp: 44.87, cobrarDoCliente: 0, naoEntendido: [],
    };
    assert.deepEqual(conferirPedidoIfood(p), []);
  });

  test('pedido pago na porta também fecha', () => {
    const p = {
      numero: '2', itens: [{ valor: 20, complementos: [] }],
      total: 20, taxaServico: 0, taxaEntrega: 5,
      pagoPeloApp: 0, cobrarDoCliente: 25, naoEntendido: [],
    };
    assert.deepEqual(conferirPedidoIfood(p), []);
  });

  test('divergência de centavo é acusada, não arredondada por baixo', () => {
    const p = {
      numero: '3', itens: [{ valor: 20, complementos: [] }],
      total: 20, taxaServico: 0, taxaEntrega: 5,
      pagoPeloApp: 0, cobrarDoCliente: 24, naoEntendido: [],
    };
    assert.match(conferirPedidoIfood(p).join(' '), /25\.00 e repasse \+ cobranca|25\.00 e repasse/);
  });

  test('item que não foi lido aparece na conferência', () => {
    const p = {
      numero: '4', itens: [{ valor: 10, complementos: [] }],
      total: 33.88, taxaServico: 0, taxaEntrega: 0,
      pagoPeloApp: 33.88, cobrarDoCliente: 0, naoEntendido: [],
    };
    assert.match(conferirPedidoIfood(p).join(' '), /itens somam 10\.00/);
  });
});

describe('valores em real', () => {
  test('milhar com ponto não vira mil vezes menos', () => {
    assert.equal(valorBR('R$ 1.234,56'), 1234.56);
  });
  test('o negativo do repasse é lido como negativo', () => {
    assert.equal(valorBR('-R$ 44,87'), -44.87);
  });
  test('linha sem valor devolve null, não zero', () => {
    // Zero diria "custou nada"; null diz "não achei" — e a conferência acusa.
    assert.equal(valorBR('Cobrar do cliente:'), null);
  });
});

// Segunda comanda REAL, capturada ao vivo em 15/09/2026 às 16:29 — entrega da
// PARCEIRA (a de antes era entrega própria). Dados do cliente trocados; o que
// importa aqui é a FORMA, e ela trouxe três coisas que a primeira não tinha.
const COMANDA_PARCEIRA = `iFood
        Confraria Cafe
           EXPEDICAO
         PEDIDO: #8271
       Entrega Parceira
        CODIGO DE COLETA
          PARCEIRA: 5977
Data: 15/09/2026 16:29:39
Entrega prevista: 17:09
6 pedidos na sua loja
Cliente Exemplo
0800 705 2030 ID: 41921749
Endereco: Av. Exemplo,
125
Comp: Predio
Bairro: Bairro
Ref: Ponto de referencia
Cidade: Macapa - AP - CEP:
68900260
ITENS DO PEDIDO (2)
1x  Combo Folhado de    R$ 19,90
    frango + Bebida
    1 Coca-Cola Lata     R$ 0,00
    350ml
1x  Agua Mineral Sem     R$ 5,50
    Gas Indaia 500ml
--------------------------------
Valor total do        R$ 25,40
pedido:
Taxa de entrega:       R$ 0,00
Pagamento via iFood: -R$ 25,40
Cobrar do cliente:     R$ 0,00
Gestor Web 9.342.0 - Desktop
8.10.0`;

describe('comanda real de entrega PARCEIRA', () => {
  const p = lerPedidoIfood(COMANDA_PARCEIRA);

  test('o rótulo do código de coleta quebra em duas linhas', () => {
    // Saiu "CODIGO DE COLETA" numa linha e "PARCEIRA: 5977" na de baixo. Lendo
    // só a primeira, o código virava a string "CODIGO DE COLETA" e o número
    // caía em `naoEntendido` — o entregador chegaria e ninguém teria o código.
    assert.equal(p.codigoColeta, '5977');
    assert.equal(p.numero, '8271');
    assert.match(p.tipoEntrega, /Entrega Parceira/);
  });

  test('ponto de referência tem campo próprio', () => {
    // "Ref:" não existia na comanda de teste do iFood.
    assert.equal(p.referencia, 'Ponto de referencia');
    assert.equal(p.bairro, 'Bairro');
  });

  test('complemento de graça é lido como ZERO, não como "sem valor"', () => {
    // "1 Coca-Cola Lata R$ 0,00" — a bebida que vem no combo. Tratar como não
    // lido faria a conferência acusar item sem valor em todo combo.
    const c = p.itens[0].complementos;
    assert.equal(c.length, 1);
    assert.equal(c[0].nome, 'Coca-Cola Lata 350ml');
    assert.equal(c[0].valor, 0);
  });

  test('nome de item quebrado em duas linhas volta inteiro', () => {
    assert.deepEqual(p.itens.map((i) => i.nome),
      ['Combo Folhado de frango + Bebida', 'Agua Mineral Sem Gas Indaia 500ml']);
    assert.deepEqual(p.itens.map((i) => i.valor), [19.90, 5.50]);
  });

  test('fecha consigo mesma e não deixa pendência', () => {
    // 19,90 + 0,00 + 5,50 = 25,40 = repasse 25,40 + cobrança 0,00
    assert.deepEqual(conferirPedidoIfood(p), []);
    assert.deepEqual(p.naoEntendido, []);
  });

  test('"N pedidos na sua loja" é recado do app, não pendência', () => {
    assert.ok(!p.naoEntendido.some((l) => /pedidos na sua loja/.test(l)));
  });
});
