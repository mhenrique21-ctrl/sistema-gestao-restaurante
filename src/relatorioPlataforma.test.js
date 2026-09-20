import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lerXlsx } from './planilha.js';
import {
  lerRelatorio, conferirRelatorio, resumoPorDia, lancamentosDoRelatorio,
  detectarPlataforma, acharColunas, pagoNaEntrega, conflitosDaPonte, foldCol,
  automaticosDePlataforma, limparAutomaticos, janelaDeDias,
} from './relatorioPlataforma.js';

// O relatório REAL da Confraria, 16/09/2026: 20 pedidos, R$ 879,18 de itens,
// R$ 584,44 de líquido. Tudo aqui é medido em cima dele — não de layout
// imaginado, a mesma regra dos leitores de comanda.
const AMOSTRA = path.join(import.meta.dirname, '..', 'amostras', 'relatorio-ifood-2026-09-16.xlsx');

// ⚠️ A AMOSTRA É O RELATÓRIO REAL e ela NÃO está no repositório: enquanto ele
// for público, o faturamento pedido a pedido não entra aqui. O arquivo fica em
// `amostras/` (no .gitignore) na máquina de quem desenvolve; sem ele, os
// testes que dependem do arquivo são PULADOS em vez de falharem — teste
// vermelho por falta de um arquivo opcional ensina a ignorar teste vermelho.
const TEM_AMOSTRA = fs.existsSync(AMOSTRA);
const seTemAmostra = { skip: TEM_AMOSTRA ? false : 'amostras/relatorio-ifood-2026-09-16.xlsx não está aqui' };

let LINHAS;
const linhas = async () => {
  if (!LINHAS) {
    const b = fs.readFileSync(AMOSTRA);
    LINHAS = await lerXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  return LINHAS;
};

describe('quem manda é o CONTEÚDO, não o nome do arquivo', () => {
  test('reconhece o iFood pelo cabeçalho', seTemAmostra, async () => {
    assert.equal(detectarPlataforma(await linhas()), 'ifood');
  });

  test('cabeçalho que não é de plataforma nenhuma não vira palpite', () => {
    assert.equal(detectarPlataforma([['pedido', 'valor']]), null);
    assert.equal(detectarPlataforma([]), null);
  });

  test('reconhece pela coluna CANAL DE VENDA, não só pelo cabeçalho', () => {
    // Loja sem promoção nenhuma pode não ter a coluna "INCENTIVO DO IFOOD".
    assert.equal(detectarPlataforma([
      ['ID CURTO DO PEDIDO', 'CANAL DE VENDA'], ['1', 'iFood'],
    ]), 'ifood');
    assert.equal(detectarPlataforma([
      ['ID CURTO DO PEDIDO', 'CANAL DE VENDA'], ['1', '99Food'],
    ]), '99food');
  });

  test('aparecendo os DOIS, não escolhe', () => {
    // Lançar o dia no canal errado dá taxa diferente e faturamento errado, sem
    // nada denunciando. Melhor pedir do que chutar.
    assert.equal(detectarPlataforma([
      ['ID CURTO DO PEDIDO', 'CANAL DE VENDA'], ['1', 'iFood'], ['2', '99Food'],
    ]), null);
  });

  test('plataforma conhecida de nome, mas sem leitor, avisa em vez de inventar', () => {
    // Quando chegar o relatório de uma terceira plataforma, a mensagem tem que
    // dizer O QUE FALTA — "ainda não sei ler o relatório do rappi" manda a
    // pessoa mandar o arquivo, e "não reconheci" a faria procurar o erro nela.
    const r = lerRelatorio([['pedido', 'valor']], 'rappi');
    assert.equal(r.plataforma, 'rappi');
    assert.equal(r.pedidos.length, 0);
    assert.match(r.avisos.join(' '), /ainda não sei ler o relatório do rappi/);
  });
});

describe('os dois INCENTIVOS, que só diferem na última palavra', () => {
  test('cada um cai na sua coluna', seTemAmostra, async () => {
    // ⚠️ Casando por "incentivo promocional", a primeira coluna venceria as
    // duas — e o sistema trataria como desconto da loja um dinheiro que o
    // iFood REPÕE. No dia 16 foram R$ 98,76 de um e R$ 67,37 do outro.
    const r = lerRelatorio(await linhas());
    const p = r.pedidos.find((x) => x.numero === '9857');
    assert.equal(p.incentivoPlataforma, 8.52);
    assert.equal(p.incentivoLoja, 0);
    const q = r.pedidos.find((x) => x.numero === '7807');
    assert.equal(q.incentivoPlataforma, 0);
    assert.equal(q.incentivoLoja, 7.4);
  });

  test('rótulo que serviria para DOIS campos é recusado, não escolhido', () => {
    const { cols, ambiguos } = acharColunas(
      ['INCENTIVO PROMOCIONAL DO IFOOD'],
      { a: ['incentivo promocional do ifood'], b: ['incentivo promocional'] },
    );
    assert.equal(cols.a, undefined, 'não pode escolher um dos dois em silêncio');
    assert.equal(cols.b, undefined);
    assert.match(ambiguos.join(' '), /casa com a e b/);
  });

  test('o acento do cabeçalho não decide nada', () => {
    assert.equal(foldCol('TAXAS E COMISSÕES (R$)'), 'taxas e comissoes (r$)');
    const { cols } = acharColunas(['Taxa de Serviço (R$)'], { taxaServico: ['taxa de servico'] });
    assert.equal(cols.taxaServico, 0);
  });
});

describe('a base da comissão: itens menos o que a LOJA bancou', () => {
  test('o pedido #6677, que tem os dois incentivos', seTemAmostra, async () => {
    const r = lerRelatorio(await linhas());
    const p = r.pedidos.find((x) => x.numero === '6677');
    assert.equal(p.itens, 42.47);
    assert.equal(p.incentivoPlataforma, 3.99);
    assert.equal(p.incentivoLoja, 10);
    assert.equal(p.baseComissao, 32.47, 'só o incentivo DA LOJA sai da base');
    assert.equal(p.taxasComissoes, 8.51, 'guardado POSITIVO, como o repasse');
    assert.equal(p.liquido, 23.96);
  });

  test('a taxa do plano medida no relatório é 26,2% — não 27%', seTemAmostra, async () => {
    const r = lerRelatorio(await linhas());
    const c = conferirRelatorio(r);
    assert.equal(c.taxaMedida, 26.2);
  });
});

describe('a conferência aponta, NUNCA corrige', () => {
  test('acha o cancelamento parcial e mantém o valor do relatório', seTemAmostra, async () => {
    // ⚠️ Recalcular o líquido faria o #2027 entrar por R$ 27,92 em vez dos
    // R$ 13,24 que o iFood pagou — R$ 14,68 de faturamento inventado, num
    // pedido que a comanda imprimiu inteiro porque o cancelamento veio depois.
    const r = lerRelatorio(await linhas());
    const c = conferirRelatorio(r);
    assert.equal(c.divergentes.length, 1);
    assert.equal(c.divergentes[0].numero, '2027');
    assert.equal(c.divergentes[0].liquido, 13.24, 'o que vale é o que a plataforma pagou');
    // ⚠️ PARCIAL, não cancelado: parte foi entregue e o iFood pagou por ela.
    // O pedido CANCELADO de vez fica fora do dia; o parcial CONTA.
    assert.ok(c.divergentes[0].parcial);
    assert.ok(!c.divergentes[0].cancelado);
    assert.match(c.avisos.join(' '), /cancelado em parte/);
  });

  test('a taxa do plano é a MEDIANA, não a média', seTemAmostra, async () => {
    // A linha do cancelamento mediu 12,4%. Na média ela puxaria a taxa para
    // baixo e a conferência passaria a acusar as outras 19.
    const r = lerRelatorio(await linhas());
    const media = r.pedidos.reduce((s, p) => s + p.taxaPct, 0) / r.pedidos.length;
    assert.ok(media < 26, 'a média é contaminada');
    assert.equal(conferirRelatorio(r).taxaMedida, 26.2);
  });
});

describe('o dia, do jeito que Vendas guarda', () => {
  test('bate com o relatório real de 16/09', seTemAmostra, async () => {
    const [d] = resumoPorDia(lerRelatorio(await linhas()));
    assert.equal(d.data, '2026-09-16');
    assert.equal(d.pedidos, 20);
    assert.equal(d.bruto, 879.18);
    assert.equal(d.liquido, 584.44);
    assert.equal(d.incentivoLoja, 67.37);
    assert.equal(d.incentivoPlataforma, 98.76);
    // Nenhum pedido CANCELADO de vez — o #2027 é cancelamento PARCIAL e
    // continua contando, com o valor que o iFood realmente pagou.
    assert.equal(d.cancelados, 0);
  });

  test('o BRUTO é o valor dos ITENS, não o que o cliente pagou', seTemAmostra, async () => {
    // ⚠️ O cliente pagou R$ 878,84 — incluindo R$ 143,80 de entrega e R$ 21,99
    // de taxa de serviço, que o iFood cobra por fora e FICA com elas. Esse
    // dinheiro nunca foi da loja. E o que o cliente pagou já vem descontado do
    // incentivo do iFood, que a loja FATURA.
    const [d] = resumoPorDia(lerRelatorio(await linhas()));
    assert.equal(d.bruto, 879.18);
    assert.notEqual(d.bruto, 878.84);
    assert.equal(d.entregaCliente, 143.80);
    assert.equal(d.taxaServico, 21.99);
  });

  test('a linha de Vendas: porcentagem na taxa, líquido no total', seTemAmostra, async () => {
    const [l] = lancamentosDoRelatorio(lerRelatorio(await linhas()));
    assert.equal(l.origem, 'relatorio_ifood');
    assert.equal(l.ifood, 879.18);
    assert.equal(l.ifoodLiq, 584.44);
    assert.equal(l.ifoodTaxa, 33.52);            // (879,18 − 584,44) / 879,18
    assert.ok(l.ifoodTaxa < 100, 'porcentagem, nunca reais');
    assert.equal(l.total, 584.44, 'o total do dia é o que a loja recebe');
    assert.equal(l['99food'], 0);
  });
});

describe('o mesmo arquivo importado duas vezes', () => {
  test('pedido repetido não dobra o dia', seTemAmostra, async () => {
    const L = await linhas();
    const dobrado = [L[0], ...L.slice(1), ...L.slice(1)];
    const r = lerRelatorio(dobrado);
    assert.equal(r.pedidos.length, 20);
    assert.match(r.avisos.join(' '), /20 pedido\(s\) repetido/);
    assert.equal(resumoPorDia(r)[0].liquido, 584.44);
  });
});

describe('a ponte de impressão já lançou estes dias', () => {
  test('a linha antiga do pdv_comandas aparece como conflito', seTemAmostra, async () => {
    // ⚠️ As origens SOMAM no Dashboard. Importar o relatório por cima da linha
    // que a ponte mandou faria o dia contar duas vezes — e a linha da ponte
    // tem o BRUTO, que é o número errado.
    const lancs = lancamentosDoRelatorio(lerRelatorio(await linhas()));
    const vendas = [
      { id: 'a', data: '2026-09-16', origem: 'pdv_comandas', total: 797.69, ifood: 797.69, '99food': 0 },
      { id: 'b', data: '2026-09-16', origem: 'pdv_ecletica', total: 400, ifood: 0, '99food': 0 },
      { id: 'c', data: '2026-09-15', origem: 'pdv_comandas', total: 350.65, ifood: 300, '99food': 50 },
    ];
    const c = conflitosDaPonte(vendas, lancs);
    assert.equal(c.length, 1, 'só o mesmo dia e só a origem da ponte');
    assert.equal(c[0].id, 'a');
    assert.equal(c[0].total, 797.69);
  });
});

describe('pagamento na entrega é dinheiro na gaveta', () => {
  test('reconhece as formas e não confunde com o pago no app', () => {
    assert.equal(pagoNaEntrega('Pgto via APP - PIX'), false);
    assert.equal(pagoNaEntrega('Pgto via APP  - Débito (Mastercard Maestro)'), false);
    assert.equal(pagoNaEntrega('Pgto na ENTREGA - Dinheiro'), true);
    assert.equal(pagoNaEntrega(''), false);
  });

  test('sai do repasse e vira aviso, nunca palpite', () => {
    // Somar no líquido jogaria dinheiro de caixa na conta a receber do iFood.
    const r = lerRelatorio([
      ['ID CURTO DO PEDIDO', 'DATA E HORA DO PEDIDO', 'VALOR DOS ITENS (R$)',
        'VALOR LIQUIDO (R$)', 'FORMA DE PAGAMENTO', 'CANAL DE VENDA'],
      ['1', '16/09/2026 12:00:00', '50,00', '36,88', 'Pgto via APP - PIX', 'iFood'],
      ['2', '16/09/2026 13:00:00', '30,00', '-7,86', 'Pgto na ENTREGA - Dinheiro', 'iFood'],
    ]);
    assert.equal(r.pedidos.length, 2);
    assert.match(r.avisos.join(' '), /pagos NA ENTREGA/);
    const [d] = resumoPorDia(r);
    assert.equal(d.pedidos, 1);
    assert.equal(d.liquido, 36.88);
  });
});

describe('o que falta no arquivo', () => {
  test('sem VALOR LIQUIDO a ferramenta não tem sentido — e diz isso', () => {
    const r = lerRelatorio([
      ['ID CURTO DO PEDIDO', 'DATA E HORA DO PEDIDO', 'VALOR DOS ITENS (R$)', 'CANAL DE VENDA'],
      ['1', '16/09/2026 12:00:00', '50,00', 'iFood'],
    ]);
    assert.equal(r.pedidos.length, 0);
    assert.match(r.avisos.join(' '), /não tem as colunas: liquido/);
  });

  test('pedido sem data legível fica de fora, com aviso', () => {
    const r = lerRelatorio([
      ['ID CURTO DO PEDIDO', 'DATA E HORA DO PEDIDO', 'VALOR DOS ITENS (R$)',
        'VALOR LIQUIDO (R$)', 'CANAL DE VENDA'],
      ['1', 'sem data', '50,00', '36,88', 'iFood'],
    ]);
    assert.equal(r.pedidos.length, 0);
    assert.match(r.avisos.join(' '), /sem data legível/);
  });
});

describe('limpar o que a ponte lançou', () => {
  // O que estava no Histórico da Confraria em 17/09/2026, do print do dono.
  const VENDAS = () => [
    { id: 'a', data: '2026-09-17', origem: 'pdv_comandas', dinheiro: 70.59,
      ifood: 609.31, ifoodTaxa: 104.19, ifoodLiq: 505.12,
      '99food': 228.77, nfoodTaxa: 16.96, nfoodLiq: 211.81, total: 908.67 },
    { id: 'b', data: '2026-09-17', origem: 'pdv_ecletica', dinheiro: 117, maquininha: 2626.08,
      ifood: 0, '99food': 0, total: 2825.32 },
    { id: 'c', data: '2026-09-17', origem: 'manual', delivery: 174.42, total: 174.42 },
    { id: 'd', data: '2026-09-10', origem: 'pdv_comandas', ifood: 100, total: 100 },
  ];

  test('a linha da ponte sai INTEIRA — o dinheiro dela também é dela', () => {
    const alvos = automaticosDePlataforma(VENDAS(), '2026-09-18', 7);
    assert.deepEqual(alvos.apagar.map((v) => v.id), ['a']);
    assert.equal(alvos.de, '2026-09-12');
    assert.equal(alvos.ate, '2026-09-18');
  });

  test('fora da janela não é tocado', () => {
    // A linha 'd' é de 10/09 — oito dias atrás. O pedido foi sete.
    const alvos = automaticosDePlataforma(VENDAS(), '2026-09-18', 7);
    assert.ok(!alvos.apagar.some((v) => v.id === 'd'));
    assert.equal(limparAutomaticos(VENDAS(), alvos).find((v) => v.id === 'd').ifood, 100);
  });

  test('a linha do Eclética NÃO é apagada — só os campos de plataforma saem', () => {
    // ⚠️ Apagar a linha "porque tem iFood nela" levaria junto os R$ 2.626,08 de
    // maquininha do dia, e ninguém repararia até o fechamento do mês.
    const alvos = automaticosDePlataforma(VENDAS(), '2026-09-18', 7);
    assert.ok(!alvos.apagar.some((v) => v.id === 'b'));
    assert.ok(!alvos.limpar.some((v) => v.id === 'b'), 'ela já está zerada, nem entra');
    const depois = limparAutomaticos(VENDAS(), alvos);
    const ecletica = depois.find((v) => v.id === 'b');
    assert.equal(ecletica.maquininha, 2626.08);
    assert.equal(ecletica.dinheiro, 117);
  });

  test('linha com os DOIS mundos perde só a plataforma, e o total é refeito', () => {
    const vendas = [{ id: 'x', data: '2026-09-17', origem: 'manual',
      dinheiro: 100, maquininha: 50, ifood: 200, ifoodTaxa: 27, ifoodLiq: 146, total: 350 }];
    const alvos = automaticosDePlataforma(vendas, '2026-09-18', 7);
    assert.deepEqual(alvos.limpar.map((v) => v.id), ['x']);
    const [v] = limparAutomaticos(vendas, alvos, 'AGORA');
    assert.equal(v.ifood, 0);
    assert.equal(v.ifoodLiq, 0);
    assert.equal(v.dinheiro, 100);
    // ⚠️ O total somava o canal que acabou de sair. Mantendo 350, o dia
    // continuaria grande e a linha não explicaria mais de onde vem o número.
    assert.equal(v.total, 150);
    assert.equal(v.atualizadoEm, 'AGORA', 'sem carimbo a fusão reverte no poll');
  });

  test('a janela conta HOJE inclusive', () => {
    assert.deepEqual(janelaDeDias('2026-09-18', 7), { de: '2026-09-12', ate: '2026-09-18' });
    assert.deepEqual(janelaDeDias('2026-09-18', 1), { de: '2026-09-18', ate: '2026-09-18' });
    // Vira o mês sem inventar dia 0.
    assert.deepEqual(janelaDeDias('2026-03-02', 7), { de: '2026-02-24', ate: '2026-03-02' });
  });

  test('nada para limpar devolve as vendas como estavam', () => {
    const vendas = [{ id: 'z', data: '2026-09-17', origem: 'manual', dinheiro: 10, total: 10 }];
    const alvos = automaticosDePlataforma(vendas, '2026-09-18', 7);
    assert.equal(alvos.apagar.length + alvos.limpar.length, 0);
    assert.deepEqual(limparAutomaticos(vendas, alvos), vendas);
  });
});

// ── 99Food ──────────────────────────────────────────────────────────────────
// Escrito em cima do relatório REAL de 14–19/09/2026 (55 pedidos, R$ 2.433,30
// de mercadoria, R$ 1.485,29 de receita real) — não de layout imaginado.
const AMOSTRA_99 = path.join(import.meta.dirname, '..', 'amostras', 'relatorio-99food-2026-09-14-a-19.xlsx');
const TEM_99 = fs.existsSync(AMOSTRA_99);
const seTem99 = { skip: TEM_99 ? false : 'amostras/relatorio-99food-2026-09-14-a-19.xlsx não está aqui' };
let LINHAS_99;
const linhas99 = async () => {
  if (!LINHAS_99) {
    const b = fs.readFileSync(AMOSTRA_99);
    LINHAS_99 = await lerXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  return LINHAS_99;
};

describe('99Food: o relatório NÃO diz "99food" em lugar nenhum', () => {
  test('reconhece pelas COLUNAS, que são a impressão digital dele', seTem99, async () => {
    // ⚠️ Era isto que quebrava: nem cabeçalho, nem coluna de canal, nem nome da
    // loja trazem a palavra "99food". Procurando o nome no conteúdo, um arquivo
    // perfeitamente legível respondia "não reconheci de qual plataforma é".
    const L = await linhas99();
    assert.equal(detectarPlataforma(L), '99food');
    assert.ok(!L.slice(0, 6).flat().some((c) => foldCol(c).includes('99food')),
      'o arquivo realmente não diz o nome da plataforma');
  });

  test('assinatura pela metade ainda resolve; empate NÃO escolhe', () => {
    assert.equal(detectarPlataforma([['ID do pedido', 'Receita real da loja', 'Despesas de comissão']]), '99food');
    assert.equal(detectarPlataforma([['ID curto do pedido', 'VALOR LIQUIDO (R$)', 'TAXAS E COMISSOES (R$)']]), 'ifood');
    // Duas colunas de cada: lançar no canal errado dá outra taxa e outro
    // faturamento, sem nada denunciando. Melhor pedir do que chutar.
    assert.equal(detectarPlataforma([['pedido', 'Receita real da loja',
      'Despesas de comissão', 'VALOR LIQUIDO (R$)', 'TAXAS E COMISSOES (R$)']]), null);
  });
});

describe('99Food: a identidade que o próprio relatório obedece', () => {
  test('receita de vendas − comissão − pagamento − logística = receita real', seTem99, async () => {
    // ⚠️ São QUATRO colunas lidas de forma independente, então a conta não é
    // circular. Ela fechou nas 55 linhas do arquivo real.
    const r = lerRelatorio(await linhas99());
    assert.equal(r.pedidos.length, 55);
    assert.equal(conferirRelatorio(r).divergentes.length, 0);
  });

  test('a taxa do 99Food NÃO é uma porcentagem limpa — e por isso não é ela que confere', seTem99, async () => {
    // O custo LOGÍSTICO é um valor por entrega, não um percentual: a taxa
    // efetiva vai de ~19% a ~39% conforme o tamanho do pedido. Cobrar uma
    // mediana de todos acusaria quase todo pedido, e o aviso que grita sempre
    // é o aviso que ninguém lê.
    const r = lerRelatorio(await linhas99());
    const pcts = r.pedidos.filter((p) => !p.cancelado && p.baseComissao > 0).map((p) => p.taxaPct);
    assert.ok(Math.max(...pcts) - Math.min(...pcts) > 10, 'a dispersão é grande de verdade');
  });

  test('as TRÊS colunas de taxa viram uma só', seTem99, async () => {
    // Comissão 4,28 + pagamento 1,54 + logística 5,50 = 11,32. Guardando só a
    // comissão, o líquido não fecharia — e por R$ 336,58 nos seis dias.
    const r = lerRelatorio(await linhas99());
    const p = r.pedidos.find((x) => x.numero.endsWith('501151'));
    assert.equal(p.itens, 48);
    assert.equal(p.incentivoLoja, 6, 'despesas de marketing é a promoção DA LOJA');
    assert.equal(p.receitaVendas, 42, 'preço original − marketing');
    assert.equal(p.taxasComissoes, 11.32);
    assert.equal(p.liquido, 30.68);
    assert.equal(p.incentivoPlataforma, 11.99, 'recompensa da plataforma NÃO sai do líquido');
  });
});

describe('99Food: cancelado não é venda', () => {
  test('os 5 cancelados ficam FORA do dia, e o aviso diz quanto', seTem99, async () => {
    // ⚠️ Eles têm mercadoria (R$ 235,20 somados) e repasse ZERO. Contando no
    // bruto e não no líquido, a taxa efetiva do canal sairia inflada por uma
    // venda que não houve.
    const r = lerRelatorio(await linhas99());
    assert.equal(r.pedidos.filter((p) => p.cancelado).length, 5);
    assert.match(r.avisos.join(' '), /5 pedido\(s\) CANCELADO\(S\) ficaram de fora/);
    assert.match(r.avisos.join(' '), /R\$ 235,?\.?20 de mercadoria/);
    const dias = resumoPorDia(r);
    assert.equal(dias.reduce((s, d) => s + d.pedidos, 0), 50, 'só os 50 que viraram venda');
    assert.equal(dias.reduce((s, d) => s + d.cancelados, 0), 5, 'contados à parte, não somem');
  });

  test('o líquido do período bate com a RECEITA REAL do relatório', seTem99, async () => {
    const dias = resumoPorDia(lerRelatorio(await linhas99()));
    assert.equal(r2(dias.reduce((s, d) => s + d.liquido, 0)), 1485.29);
    // 2.433,30 de mercadoria menos os 235,20 que foram cancelados.
    assert.equal(r2(dias.reduce((s, d) => s + d.bruto, 0)), 2198.10);
    function r2(n) { return Math.round(n * 100) / 100; }
  });

  test('reembolso vira aviso, não desconto — o relatório já o considerou', seTem99, async () => {
    const r = lerRelatorio(await linhas99());
    assert.match(r.avisos.join(' '), /1 pedido\(s\) com reembolso/);
    const p = r.pedidos.find((x) => x.reembolso > 0);
    assert.equal(p.reembolso, 35.80);
    assert.equal(p.liquido, 23.97, 'o líquido é o que o relatório diz, não o que eu calcularia');
  });

  test('seis dias, cada um na sua linha de Vendas', seTem99, async () => {
    const lancs = lancamentosDoRelatorio(lerRelatorio(await linhas99()));
    assert.equal(lancs.length, 6);
    assert.equal(lancs[0].origem, 'relatorio_99food');
    assert.equal(lancs[0].data, '2026-09-14');
    assert.equal(lancs[0]['99food'], 325.80);
    assert.equal(lancs[0].nfoodLiq, 204.42);
    assert.equal(lancs[0].total, 204.42);
    assert.equal(lancs[0].ifood, 0, 'não encosta no outro canal');
  });
});
