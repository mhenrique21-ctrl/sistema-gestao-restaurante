// Do pedido da plataforma para a linha de Vendas do dia.
// ============================================================================
// Aqui mora a única parte disto que erra em SILÊNCIO. O leitor errado aparece
// na tela — nome estranho, aviso de divergência. A conta errada não: ela vira
// um número plausível no faturamento do mês e só aparece quando o contador
// pergunta por que o iFood do extrato não bate com o do sistema.
//
// DECISÕES DO DONO (15/09/2026), sobre um pedido real de R$ 29,90 com R$ 15,00
// de promoção, entrega da parceira:
//
//   1. o faturamento do dia é o que o cliente PAGOU pelo app (R$ 22,89),
//      não a mercadoria de tabela (R$ 29,90)
//   2. a taxa de entrega da PARCEIRA é despesa do canal
//   3. o desconto é bancado pela loja
//
// ⚠️ A 3 é a que mais engana: como o faturamento é o que o cliente pagou, o
// desconto JÁ ESTÁ dentro dele — o cliente pagou 22,89 em vez de 37,89. Lançar
// o desconto TAMBÉM como despesa contaria os mesmos R$ 15,00 duas vezes. É a
// regra do `folhaRh.js`: cada real aparece UMA vez. Por isso `descontos` é
// guardado como INFORMAÇÃO ("quanto dei de desconto no mês") e fica fora de
// toda soma de dinheiro.
//
// ⚠️ A 2 é CONDICIONAL, porque a comanda distingue: em "Entrega Propria" os
// R$ 7,00 ficam com a loja (ela é quem entrega) e são receita, não despesa.
// Aplicar "despesa do canal" nos dois casos tiraria do faturamento um dinheiro
// que entrou na gaveta.
//
// ⚠️ A taxa de SERVIÇO também é despesa do canal: o cliente paga, a plataforma
// fica. Está dentro do que ele pagou e a loja nunca vê.
//
// ⚠️ `liquido` é ANTES DA COMISSÃO da plataforma. A comissão não está na
// comanda — ela só aparece no extrato. Chamar isto de "o que vou receber"
// seria mentira; é "o que vendi, já fora taxa de serviço e entrega".

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// A entrega é da plataforma? Só então a taxa dela é despesa do canal.
// Sem `tipoEntrega` lido (comanda cortada, layout novo), NÃO se chuta: a taxa
// fica fora da despesa e um aviso pede conferência. Chutar "parceira" tiraria
// do faturamento um dinheiro que pode ter entrado na gaveta.
export function entregaDaPlataforma(tipoEntrega) {
  const t = String(tipoEntrega || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!t) return null;
  if (t.includes('propria')) return false;
  if (t.includes('parceira') || t.includes('plataforma')) return true;
  return null;
}

// ⚠️ REIMPRESSÃO NÃO É VENDA NOVA. A comanda sai de novo quando trava o papel,
// quando alguém testa, quando a cozinha perde a via — e o agente captura tudo
// igual. Sem olhar a data do PEDIDO, a reimpressão de um pedido de 15/09 vira
// faturamento do dia em que foi reimpressa: no primeiro lote real, a comanda
// de teste reimpressa criou R$ 51,70 de "dinheiro na porta" em dois dias
// diferentes, de uma venda que aconteceu uma vez só.
//
// A comanda carrega a própria data, nos dois formatos:
//   iFood    `data`     "15/09/2026 16:29:39"
//   99Food   `aceitoEm` "15 de set 16:00"   ← sem ano
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function dataDoPedido(pedido, dataReferencia) {
  const p = pedido || {};
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(dataReferencia || '')) ? String(dataReferencia) : null;

  // iFood: dd/mm/aaaa, com ano.
  const br = String(p.data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  // 99Food: "15 de set" — o ANO não vem. Sai do dia da captura; se a data
  // montada cair no futuro, é do ano passado (pedido de dezembro relido em
  // janeiro). Chutar o ano corrente sempre jogaria esse pedido 12 meses à
  // frente, num dia que ainda não existe.
  const pt = String(p.aceitoEm || '').match(/(\d{1,2})\s*de\s*([a-zç]{3})/i);
  if (pt && ref) {
    const mes = MESES.indexOf(pt[2].toLowerCase().slice(0, 3));
    if (mes >= 0) {
      const dia = String(parseInt(pt[1], 10)).padStart(2, '0');
      let ano = parseInt(ref.slice(0, 4), 10);
      let iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${dia}`;
      if (iso > ref) iso = `${ano - 1}-${String(mes + 1).padStart(2, '0')}-${dia}`;
      return iso;
    }
  }
  // Sem data legível, o pedido é do dia em que foi capturado — é o que se sabe.
  return ref;
}

export function lancamentoDoPedido(pedido) {
  const p = pedido || {};
  const avisos = [];
  const naPorta = round2(p.cobrarDoCliente);
  const bruto = round2(p.pagoPeloApp);

  const daPlataforma = entregaDaPlataforma(p.tipoEntrega);
  if (daPlataforma == null && p.taxaEntrega) {
    avisos.push('não sei quem entregou: a taxa de entrega ficou FORA da despesa do canal');
  }
  // ⚠️ FRETE GRÁTIS ANULA A TAXA DE ENTREGA. Na comanda real #871010 o 99Food
  // cobrou R$ 3,99 de entrega e devolveu os mesmos R$ 3,99 como "Entrega
  // promocional para cliente" — o cliente não pagou frete nenhum. Contar os
  // 3,99 como despesa do canal inventaria uma despesa que não existiu, e o
  // líquido do canal sairia menor que a venda real.
  const entregaLiquida = Math.max(0, (p.taxaEntrega || 0) - (p.entregaPromocional || 0));
  const taxa = round2((p.taxaServico || 0) + (daPlataforma ? entregaLiquida : 0));

  // ⚠️ Sem NENHUM dos dois valores, não há o que somar. Entrar como zero seria
  // pior que ficar de fora: inflaria a contagem de pedidos do dia com uma
  // venda que ninguém sabe quanto foi, e o total continuaria errado do mesmo
  // jeito. Fica de fora E aparece no aviso — some da conta, não da vista.
  const semValor = p.pagoPeloApp == null && p.cobrarDoCliente == null;
  if (semValor) avisos.push('nenhum valor de pagamento lido — ficou FORA do dia');

  return {
    numero: p.numero || null,
    semValor,
    canal: p.plataforma === 'ifood' ? 'ifood' : '99food',
    bruto,
    taxa,
    // Pode ficar negativo se a taxa passar do que o cliente pagou. Não é
    // aparado em zero de propósito: seria esconder um pedido lido errado.
    liquido: round2(bruto - taxa),
    naPorta,
    // Fora da soma de dinheiro — ver o ⚠️ da decisão 3 lá em cima.
    desconto: round2(p.descontos),
    avisos,
  };
}

// ⚠️ A MESMA comanda é impressa DUAS vezes (a via da cozinha e a da sacola), e
// as duas são capturadas — vimos as duas chegarem com 1 segundo de diferença.
// Somando as duas, o faturamento do dia DOBRA, em silêncio, e só apareceria no
// fechamento do mês. A chave é o número do pedido dentro do canal.
//
// ⚠️ Pedido SEM número não é descartado — seria perder venda de verdade por
// causa de uma linha que o leitor não entendeu. Ele entra, e um aviso diz que
// aquele não pôde ser conferido contra repetição.
export function lancamentoDoDia(data, pedidos) {
  const vistos = new Set();
  const avisos = [];
  let semNumero = 0;
  let duplicados = 0;

  const linhas = [];
  let reimpressoes = 0;
  for (const ped of pedidos || []) {
    // ⚠️ A comanda diz de que dia ela é. Se não for deste, é reimpressão: fica
    // de fora, com aviso. Ela já foi contada no dia certo (ou nunca foi, se é
    // de antes da ponte existir) — somar aqui criaria uma venda que não houve.
    const dataPropria = dataDoPedido(ped, data);
    if (dataPropria && data && dataPropria !== data) {
      reimpressoes++;
      avisos.push(`pedido ${ped.numero || 's/nº'} é de ${dataPropria} — reimpressão, fora do dia`);
      continue;
    }
    const l = lancamentoDoPedido(ped);
    if (l.numero) {
      const chave = `${l.canal}#${l.numero}`;
      if (vistos.has(chave)) { duplicados++; continue; }
      vistos.add(chave);
    } else {
      semNumero++;
    }
    for (const a of l.avisos) avisos.push(`pedido ${l.numero || 's/nº'}: ${a}`);
    // O aviso já saiu; o que não tem valor nenhum não entra na soma nem na
    // contagem. Dizer "não entra no dia" e entrar assim mesmo era a pior das
    // duas opções: o aviso na tela contradizia o número que subia.
    if (l.semValor) continue;
    linhas.push(l);
  }

  const soma = (canal, campo) => round2(linhas
    .filter((l) => l.canal === canal)
    .reduce((s, l) => s + l[campo], 0));

  const dia = {
    data,
    ifood: soma('ifood', 'bruto'),
    ifoodTaxa: soma('ifood', 'taxa'),
    ifoodLiq: soma('ifood', 'liquido'),
    '99food': soma('99food', 'bruto'),
    nfoodTaxa: soma('99food', 'taxa'),
    nfoodLiq: soma('99food', 'liquido'),
    // O que o entregador recebeu na porta é dinheiro que chega na loja, dos
    // dois canais juntos: em Vendas ele não tem coluna por plataforma.
    dinheiro: round2(linhas.reduce((s, l) => s + l.naPorta, 0)),
    // Informação, nunca dinheiro: já está abatido do que o cliente pagou.
    descontos: round2(linhas.reduce((s, l) => s + l.desconto, 0)),
    pedidos: linhas.length,
  };
  // O total do dia é o que ENTROU: o que o cliente pagou pelo app mais o que
  // foi cobrado na porta. As taxas não saem daqui — elas aparecem na coluna de
  // taxa do canal, e descontá-las do total esconderia o tamanho do canal.
  dia.total = round2(dia.ifood + dia['99food'] + dia.dinheiro);

  if (duplicados) avisos.push(`${duplicados} comanda(s) repetida(s) ignorada(s) — a mesma via impressa duas vezes`);
  if (semNumero) avisos.push(`${semNumero} pedido(s) sem número: não deu pra conferir contra repetição`);
  dia.avisos = avisos;
  return dia;
}
