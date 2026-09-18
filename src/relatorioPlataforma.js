// O relatório de pedidos da plataforma vira lançamento de Vendas.
// ============================================================================
// POR QUE ISTO SUBSTITUIU A PONTE DE IMPRESSÃO (18/09/2026)
//
// A ponte lia a comanda que sai na cozinha. Ela funciona, captura e lê — mas
// NÃO consegue dar o líquido do canal, e a conferência contra o relatório real
// do dia 16/09/2026 mostrou por quê. Três informações decidem o dinheiro e
// nenhuma delas está impressa no papel:
//
//  1. ⚠️ O DESCONTO DA COMANDA SOMA DOIS BOLSOS DIFERENTES. A comanda imprime
//     "Descontos: -R$ 15,00" numa linha só. No relatório são duas colunas:
//     INCENTIVO DO IFOOD (que o iFood REPÕE — a loja fatura o item cheio) e
//     INCENTIVO DA LOJA (que a loja banca). No dia 16 foram R$ 98,76 de um e
//     R$ 67,37 do outro. Só o segundo reduz a base da comissão.
//  2. ⚠️ O CANCELAMENTO ACONTECE DEPOIS DO PAPEL SAIR. O pedido #2027 foi
//     impresso inteiro (R$ 36,79) e o iFood pagou R$ 13,24. A comanda não tem
//     como saber — ela já estava na cozinha.
//  3. ⚠️ A TAXA DO PLANO NÃO ESTÁ NA COMANDA. Medida no relatório, ela é
//     26,2%, não os 27% do senso comum.
//
// Nenhuma conta possível a partir da comanda acertava o dia 16 (líquido real
// R$ 584,44): a melhor errava para menos R$ 63,92, a segunda para mais
// R$ 64,38. O relatório traz VALOR LIQUIDO por pedido, já com tudo dentro.
//
// ⚠️ ESTE ARQUIVO NÃO RECALCULA O LÍQUIDO. Ele LÊ o que a plataforma pagou e
// usa a aritmética só para CONFERIR. É a mesma divisão de papéis do Cupom IA
// (§8 do CLAUDE.md): quem transcreve não decide. Recalculando, o pedido
// cancelado voltaria a entrar pelo valor cheio — que é exatamente o erro que
// esta ferramenta existe para não cometer.

import { numeroBr, dataDaCelula } from './planilha.js';

const r2 = (n) => Math.round((n || 0) * 100) / 100;

// A MESMA normalização do resto do sistema (§5): sem acento, espaço colapsado,
// minúsculo. ⚠️ Não criar outra — "TAXAS E COMISSOES" e "Taxas e Comissões"
// são a mesma coluna e a planilha escreve das duas formas conforme o idioma da
// conta.
export const foldCol = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// ⚠️ OS RÓTULOS SE PARECEM DEMAIS, e é aí que mora o erro silencioso:
// "INCENTIVO PROMOCIONAL DO IFOOD" e "INCENTIVO PROMOCIONAL DA LOJA" só
// diferem na última palavra. Casando por "incentivo promocional", a primeira
// coluna venceria as duas — e o sistema passaria a tratar como desconto da
// loja um dinheiro que o iFood repõe. Por isso cada campo casa por um trecho
// que SÓ ele tem, e `acharColunas` recusa rótulo que sirva para dois campos.
const COLUNAS = {
  ifood: {
    idLongo:      ['id completo do pedido'],
    numero:       ['id curto do pedido'],
    loja:         ['nome da loja'],
    dataHora:     ['data e hora do pedido'],
    status:       ['status final do pedido'],
    itens:        ['valor dos itens'],
    pagoCliente:  ['total pago pelo cliente'],
    entregaCliente: ['taxa de entrega paga pelo cliente'],
    incentivoPlataforma: ['incentivo promocional do ifood'],
    incentivoLoja:       ['incentivo promocional da loja'],
    incentivoRede:       ['incentivo promocional da rede'],
    taxaServico:  ['taxa de servico'],
    taxasComissoes: ['taxas e comissoes'],
    liquido:      ['valor liquido'],
    formaPagamento: ['forma de pagamento'],
    tipoEntrega:  ['produto logistico'],
    canal:        ['canal de venda'],
  },
};

// Campos sem os quais NÃO dá para lançar nada. O resto é enriquecimento: falta
// de "produto logistico" tira uma informação da tela, falta de "valor liquido"
// tira o sentido da ferramenta inteira.
const OBRIGATORIOS = ['numero', 'dataHora', 'itens', 'liquido'];

export function acharColunas(cabecalho, mapa) {
  const cols = {};
  const ambiguos = [];
  (cabecalho || []).forEach((celula, i) => {
    const f = foldCol(celula);
    if (!f) return;
    const casam = Object.entries(mapa).filter(([, pistas]) => pistas.some((p) => f.includes(p)));
    if (casam.length > 1) {
      // Rótulo que serve para dois campos é bug de mapeamento, não do arquivo:
      // deixar passar escolheria um dos dois em silêncio.
      ambiguos.push(`"${celula}" casa com ${casam.map(([k]) => k).join(' e ')}`);
      return;
    }
    if (casam.length === 1 && cols[casam[0][0]] === undefined) cols[casam[0][0]] = i;
  });
  return { cols, ambiguos };
}

// ⚠️ QUEM MANDA É O CONTEÚDO, NÃO O NOME DO ARQUIVO. Mesma lição do
// `plataforma.js` do agente: o nome do arquivo baixado é a suspeita, o
// cabeçalho é a prova. Relatório salvo com o nome trocado lançaria o dia
// inteiro no canal errado — taxa diferente, faturamento errado, nada
// denunciando.
//
// ⚠️ Olha o CABEÇALHO **e** as primeiras linhas de dados. Só o cabeçalho não
// basta: ele identifica o iFood pela coluna "INCENTIVO PROMOCIONAL DO IFOOD",
// que uma loja sem promoção nenhuma pode não ter. A coluna CANAL DE VENDA traz
// o nome em toda linha, e é ela que responde nesse caso.
//
// ⚠️ A separação funciona porque "99food" NÃO contém "ifood" — a mesma
// propriedade em que o `plataforma.js` do agente se apoia. Aparecendo os dois,
// não se escolhe: melhor pedir do que lançar o dia no canal errado.
export function detectarPlataforma(linhas) {
  const L = linhas || [];
  const iCab = L.findIndex((l) => (l || []).some((c) => foldCol(c).includes('pedido')));
  const olhar = (iCab >= 0 ? L.slice(iCab, iCab + 6) : L.slice(0, 6));
  const texto = olhar.map((l) => (l || []).map(foldCol).join(' | ')).join(' | ');
  if (!texto.trim()) return null;
  const conta = (p) => texto.split(p).length - 1;
  const n99 = conta('99food') + conta('99 food');
  const nIf = conta('ifood');
  if (n99 && nIf) return null;
  if (nIf) return 'ifood';
  if (n99) return '99food';
  return null;
}

// Pagamento feito NA ENTREGA é dinheiro que entra na gaveta da loja, não
// repasse da plataforma. Trocar um pelo outro joga dinheiro de caixa na conta
// a receber do iFood — o mesmo erro que `pedido99.js` já evitava.
export const pagoNaEntrega = (forma) => {
  const f = foldCol(forma);
  return !!f && !f.includes('via app') && (f.includes('entrega') || f.includes('presencial'));
};

const ehCancelado = (s) => foldCol(s).includes('cancel');

export function lerRelatorio(linhas, plataformaSugerida) {
  const avisos = [];
  const plataforma = detectarPlataforma(linhas) || plataformaSugerida || null;
  if (!plataforma) {
    return { plataforma: null, pedidos: [], avisos: ['não reconheci de qual plataforma é este relatório'] };
  }
  const mapa = COLUNAS[plataforma];
  if (!mapa) {
    return {
      plataforma, pedidos: [],
      avisos: [`ainda não sei ler o relatório do ${plataforma} — preciso de um arquivo real dele`],
    };
  }

  const iCab = (linhas || []).findIndex((l) => (l || []).some((c) => foldCol(c).includes('pedido')));
  const { cols, ambiguos } = acharColunas(linhas[iCab], mapa);
  for (const a of ambiguos) avisos.push(`coluna ambígua: ${a}`);
  const faltando = OBRIGATORIOS.filter((c) => cols[c] === undefined);
  if (faltando.length) {
    return { plataforma, pedidos: [], avisos: [`o relatório não tem as colunas: ${faltando.join(', ')}`] };
  }

  const val = (l, campo) => (cols[campo] === undefined ? '' : l[cols[campo]]);
  const num = (l, campo) => numeroBr(val(l, campo));

  const pedidos = [];
  const vistos = new Set();
  let repetidos = 0;
  for (const l of linhas.slice(iCab + 1)) {
    if (!l || !String(val(l, 'numero') || '').trim()) continue;
    const data = dataDaCelula(val(l, 'dataHora'));
    if (!data) { avisos.push(`pedido ${val(l, 'numero')}: sem data legível — ficou de fora`); continue; }

    // ⚠️ O relatório é exportado por período e a pessoa pode importar o mesmo
    // arquivo duas vezes, ou dois arquivos com sobreposição de dias. A chave é
    // o ID do pedido; sem ela, o dia dobraria calado.
    const chave = String(val(l, 'idLongo') || '').trim() || `${data}#${val(l, 'numero')}`;
    if (vistos.has(chave)) { repetidos++; continue; }
    vistos.add(chave);

    const p = {
      numero: String(val(l, 'numero')).trim(),
      data,
      hora: String(val(l, 'dataHora') || '').match(/\d{1,2}:\d{2}/)?.[0] || '',
      status: String(val(l, 'status') || '').trim(),
      cancelado: ehCancelado(val(l, 'status')),
      itens: r2(num(l, 'itens')),
      pagoCliente: r2(num(l, 'pagoCliente')),
      entregaCliente: r2(num(l, 'entregaCliente')),
      incentivoPlataforma: r2(num(l, 'incentivoPlataforma')),
      incentivoLoja: r2(num(l, 'incentivoLoja')),
      incentivoRede: r2(num(l, 'incentivoRede')),
      taxaServico: r2(num(l, 'taxaServico')),
      // O relatório traz as taxas NEGATIVAS (é abatimento do repasse). Guardo
      // POSITIVO, como o `pedidoIfood.js` faz com o repasse: o campo diz
      // "quanto foi retido" e o sinal fica na fórmula, não no dado.
      taxasComissoes: r2(Math.abs(num(l, 'taxasComissoes'))),
      liquido: r2(num(l, 'liquido')),
      formaPagamento: String(val(l, 'formaPagamento') || '').trim(),
      tipoEntrega: String(val(l, 'tipoEntrega') || '').trim(),
      naPorta: pagoNaEntrega(val(l, 'formaPagamento')),
    };
    // A base da comissão: o que a loja vendeu menos o que ELA bancou de
    // promoção. O incentivo da plataforma NÃO entra — ele é reposto.
    p.baseComissao = r2(p.itens - p.incentivoLoja - p.incentivoRede);
    p.taxaPct = p.baseComissao ? r2(p.taxasComissoes / p.baseComissao * 100) : 0;
    pedidos.push(p);
  }

  if (repetidos) avisos.push(`${repetidos} pedido(s) repetido(s) no arquivo foram ignorados`);
  if (pedidos.some((p) => p.incentivoRede)) {
    avisos.push('há INCENTIVO DA REDE neste relatório — tratei como promoção bancada pela loja; confira no extrato');
  }
  const naPorta = pedidos.filter((p) => p.naPorta);
  if (naPorta.length) {
    avisos.push(`${naPorta.length} pedido(s) pagos NA ENTREGA: esse dinheiro entra na gaveta, não no repasse`
      + ` — lance à mão em Dinheiro (pedidos ${naPorta.map((p) => p.numero).join(', ')})`);
  }
  return { plataforma, pedidos, avisos };
}

// ── A conferência: a aritmética checa o que a planilha diz ───────────────────
// ⚠️ Ela NÃO corrige o número. O líquido que vale é o do relatório — é ele que
// vai para a conta. A conta serve para APONTAR a linha que foge do padrão, e
// no dia 16 foi exatamente assim que o cancelamento parcial apareceu.
export function conferirRelatorio(rel) {
  const pedidos = (rel?.pedidos || []).filter((p) => p.baseComissao > 0);
  if (!pedidos.length) return { taxaMedida: null, divergentes: [], avisos: [] };

  // A taxa do plano é a MEDIANA, não a média: uma linha fora do padrão (o
  // cancelamento parcial mediu 12,4%) puxaria a média e a conferência passaria
  // a acusar todas as outras.
  const pcts = pedidos.map((p) => p.taxaPct).sort((a, b) => a - b);
  const taxaMedida = r2(pcts[Math.floor(pcts.length / 2)]);

  const divergentes = [];
  for (const p of pedidos) {
    const esperado = r2(p.baseComissao * (1 - taxaMedida / 100));
    if (Math.abs(esperado - p.liquido) > 0.05) {
      divergentes.push({ ...p, esperado, diferenca: r2(p.liquido - esperado) });
    }
  }
  const avisos = [];
  for (const d of divergentes) {
    avisos.push(`pedido ${d.numero}: o relatório pagou R$ ${d.liquido.toFixed(2)}`
      + ` e a taxa de ${taxaMedida}% daria R$ ${d.esperado.toFixed(2)}`
      + (d.cancelado ? ' — foi cancelado, e o valor do relatório é que vale' : ' — confira no extrato'));
  }
  return { taxaMedida, divergentes, avisos };
}

// ── O dia, do jeito que Vendas guarda ───────────────────────────────────────
// ⚠️ `ifoodTaxa`/`nfoodTaxa` no Gestão são PORCENTAGEM, não reais — a tela
// mostra "bruto · taxa% · líquido" e calcula o líquido na linha. É a
// porcentagem EFETIVA do dia (taxas e comissões sobre o bruto), senão as duas
// colunas não fecham.
//
// ⚠️ O BRUTO é o VALOR DOS ITENS, não o que o cliente pagou. O que o cliente
// pagou inclui a entrega e a taxa de serviço, que o iFood cobra por fora e
// fica com elas: nunca foi dinheiro da loja. E não inclui o incentivo do
// iFood, que a loja FATURA. Somar o que o cliente pagou põe no faturamento um
// dinheiro que a loja nunca viu.
export function resumoPorDia(rel) {
  const por = new Map();
  for (const p of rel?.pedidos || []) {
    if (p.naPorta) continue;          // não é repasse; sai com aviso lá em cima
    const d = por.get(p.data) || {
      data: p.data, pedidos: 0, bruto: 0, liquido: 0, taxas: 0,
      incentivoLoja: 0, incentivoPlataforma: 0, entregaCliente: 0, taxaServico: 0,
      cancelados: 0,
    };
    d.pedidos += 1;
    d.bruto = r2(d.bruto + p.itens);
    d.liquido = r2(d.liquido + p.liquido);
    d.taxas = r2(d.taxas + p.taxasComissoes);
    d.incentivoLoja = r2(d.incentivoLoja + p.incentivoLoja);
    d.incentivoPlataforma = r2(d.incentivoPlataforma + p.incentivoPlataforma);
    d.entregaCliente = r2(d.entregaCliente + p.entregaCliente);
    d.taxaServico = r2(d.taxaServico + p.taxaServico);
    if (p.cancelado) d.cancelados += 1;
    por.set(p.data, d);
  }
  return [...por.values()]
    .map((d) => ({ ...d, taxaPct: d.bruto ? r2((1 - d.liquido / d.bruto) * 100) : 0 }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

export const ORIGEM = { ifood: 'relatorio_ifood', '99food': 'relatorio_99food' };
export const ROTULO = { ifood: 'iFood', '99food': '99Food' };

// Vira a linha de Vendas. A origem é PRÓPRIA (`relatorio_ifood`) e não `pdv_*`:
// as vendas são chaveadas por data+origem e as origens coexistem no mesmo dia
// de propósito (§6). Importar o mesmo dia de novo SUBSTITUI esta linha, que é
// o que faz reimportar ser seguro depois de uma correção da plataforma.
export function lancamentosDoRelatorio(rel) {
  const plat = rel?.plataforma;
  const origem = ORIGEM[plat];
  if (!origem) return [];
  return resumoPorDia(rel).map((d) => {
    const base = {
      data: d.data, origem, total: d.liquido,
      maquininha: 0, dinheiro: 0, delivery: 0,
      ifood: 0, ifoodTaxa: 0, ifoodLiq: 0, '99food': 0, nfoodTaxa: 0, nfoodLiq: 0,
    };
    if (plat === 'ifood') {
      return { ...base, ifood: d.bruto, ifoodTaxa: d.taxaPct, ifoodLiq: d.liquido };
    }
    return { ...base, '99food': d.bruto, nfoodTaxa: d.taxaPct, nfoodLiq: d.liquido };
  });
}

// ⚠️ A PONTE DE IMPRESSÃO JÁ LANÇOU ESTES DIAS. Enquanto ela enviou, cada dia
// ganhou uma linha de origem `pdv_comandas` com o valor BRUTO. As origens
// somam no Dashboard (é a regra de sempre), então importar o relatório por
// cima faria o dia contar duas vezes. Quem importa precisa ver isso na tela e
// decidir — apagar sozinho a linha de outra origem seria mexer em dado que a
// pessoa não pediu para mexer.
export const ORIGEM_PONTE = 'pdv_comandas';

export function conflitosDaPonte(vendas, lancamentos) {
  const dias = new Set((lancamentos || []).map((l) => l.data));
  return (vendas || [])
    .filter((v) => (v.origem || '') === ORIGEM_PONTE && dias.has(v.data))
    .map((v) => ({ id: v.id, data: v.data, total: r2(v.total), ifood: r2(v.ifood), nfood: r2(v['99food']) }));
}

// ── Limpar o que a ponte lançou ─────────────────────────────────────────────
// ⚠️ A ponte de impressão lançou iFood e 99Food por alguns dias, com o valor
// BRUTO e com a taxa em REAIS num campo que a tela lê como PORCENTAGEM (daí o
// "609,31 – 104.19%" que apareceu no Histórico). Esses dias precisam sair.
//
// ⚠️ São DOIS casos diferentes e tratá-los igual destrói dado:
//
//   • a linha de origem `pdv_comandas` é INTEIRA da ponte — inclusive o
//     "dinheiro na porta". Ela sai por completo.
//   • qualquer outra linha (o PDV do Eclética, o lançamento manual) pode ter
//     valor de plataforma junto com maquininha, dinheiro e delivery de
//     verdade. Dela saem SÓ os campos de plataforma; o resto fica.
//
// Apagar a linha do Eclética "porque tem iFood nela" levaria junto os R$ 2.626
// de maquininha do dia — e ninguém repararia até o fechamento do mês.
const CAMPOS_PLATAFORMA = ['ifood', 'ifoodTaxa', 'ifoodLiq', '99food', 'nfoodTaxa', 'nfoodLiq', 'descontos'];

export const temValorDePlataforma = (v) => CAMPOS_PLATAFORMA.some((c) => Math.abs(Number(v?.[c]) || 0) > 0);

// `dias` é a janela, contada a partir de `hoje` INCLUSIVE: 7 dias é hoje e os
// seis anteriores.
export function janelaDeDias(hoje, dias) {
  const fim = String(hoje || '').slice(0, 10);
  const d = new Date(`${fim}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Math.max(1, dias | 0) - 1));
  return { de: d.toISOString().slice(0, 10), ate: fim };
}

export function automaticosDePlataforma(vendas, hoje, dias = 7) {
  const { de, ate } = janelaDeDias(hoje, dias);
  const apagar = [];
  const limpar = [];
  for (const v of vendas || []) {
    const data = String(v?.data || '');
    if (data < de || data > ate) continue;
    const origem = v.origem || 'manual';
    if (origem === ORIGEM_PONTE) { apagar.push(v); continue; }
    // ⚠️ O lançamento MANUAL também entra. O pedido foi "apagar todas as
    // entradas de iFood e 99Food do período", e a pessoa vai relançar o que
    // for dela — deixar de fora o manual obrigaria a caçar linha por linha
    // justamente onde os dois números convivem.
    if (temValorDePlataforma(v)) limpar.push(v);
  }
  return { de, ate, apagar, limpar };
}

// Devolve as vendas já limpas. Quem chama precisa marcar o tombstone dos ids
// de `apagar` — sem ele a fusão ressuscita a linha no poll seguinte (§3).
export function limparAutomaticos(vendas, alvos, agora) {
  const fora = new Set((alvos?.apagar || []).map((v) => v.id));
  const zerar = new Set((alvos?.limpar || []).map((v) => v.id));
  const carimbo = agora || new Date().toISOString();
  return (vendas || [])
    .filter((v) => !fora.has(v.id))
    .map((v) => {
      if (!zerar.has(v.id)) return v;
      const novo = { ...v, atualizadoEm: carimbo };
      for (const c of CAMPOS_PLATAFORMA) novo[c] = 0;
      // ⚠️ O total é RECOMPOSTO, não deixado como estava: ele somava o canal
      // que acabou de sair. Mantendo o total antigo, o dia continuaria grande
      // e a linha não explicaria mais de onde vinha o número.
      novo.total = ['maquininha', 'dinheiro', 'delivery', 'entregasClientes']
        .reduce((s, c) => s + (Number(novo[c]) || 0), 0);
      return novo;
    });
}
