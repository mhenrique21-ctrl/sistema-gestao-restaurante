import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lerXlsx } from './planilha.js';
import {
  lerRelatorio, conferirRelatorio, resumoPorDia, lancamentosDoRelatorio,
  detectarPlataforma, acharColunas, pagoNaEntrega, conflitosDaPonte, foldCol,
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

  test('relatório de plataforma sem leitor avisa em vez de inventar', () => {
    const r = lerRelatorio([['ID DO PEDIDO 99FOOD', 'VALOR']]);
    assert.equal(r.plataforma, '99food');
    assert.equal(r.pedidos.length, 0);
    assert.match(r.avisos.join(' '), /ainda não sei ler/);
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
    assert.ok(c.divergentes[0].cancelado);
    assert.match(c.avisos.join(' '), /foi cancelado/);
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
    assert.equal(d.cancelados, 1);
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
