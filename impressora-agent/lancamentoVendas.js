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
// DECISÃO DO DONO (18/09/2026) — A COMISSÃO ENTRA NA CONTA.
// ----------------------------------------------------------------------------
// Até aqui `liquido` parava antes da comissão, porque ela não está na comanda
// (só no extrato). Só que Vendas mostrava o BRUTO no total do dia, e o total do
// mês saía inflado exatamente pelo que a plataforma fica. A comissão não está
// na comanda mas está no CONTRATO: 27% no iFood, 10% no 99Food.
//
//   venda líquida = pago pelo app − taxa de serviço − entrega da plataforma
//   líquido       = venda líquida × (1 − comissão%)
//
// ⚠️ A ORDEM IMPORTA, e é ela que o dono especificou: a comissão incide sobre
// a venda LÍQUIDA, depois de tirar entrega, cupom e desconto — não sobre o
// bruto. No pedido real de R$ 22,89 com R$ 7,00 de entrega da parceira e
// R$ 0,99 de serviço, a venda líquida é R$ 14,90; 27% dela são R$ 4,02 e
// sobram R$ 10,88. Aplicando os 27% no bruto sairiam R$ 6,18 de comissão —
// R$ 2,16 a mais de despesa inventada, em todo pedido.
//
// ⚠️ A comissão é a taxa CONTRATADA, não uma medida: é `TAXA_PADRAO`, editável
// no `config.bat`. Plano novo, promoção de taxa, mudança de categoria — tudo
// isso muda o número, e quem muda é quem negociou. Por isso ele não é
// adivinhado do extrato: seria estimar em cima de estimativa.
//
// ⚠️ `liquido` continua NÃO sendo "o que vou receber" no centavo: a plataforma
// ainda retém tarifa de transação, antecipação e o que mais o extrato trouxer.
// É "o que vendi, já fora entrega, serviço e comissão do plano" — a
// conferência contra o extrato continua sendo do fechamento do mês.

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// A comissão contratada de cada canal, em PORCENTAGEM da venda líquida.
export const TAXA_PADRAO = { ifood: 27, '99food': 10 };

// Aceita `{ifood: 27, '99food': 10}` vindo do config.bat. Valor ausente ou não
// numérico cai no padrão — meia configuração não pode virar comissão zero, que
// é o erro que devolveria o faturamento inflado sem ninguém notar.
export function taxaDoCanal(canal, taxas) {
  const v = Number(taxas?.[canal]);
  if (Number.isFinite(v) && v >= 0 && v < 100) return v;
  return TAXA_PADRAO[canal] ?? 0;
}

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

export function lancamentoDoPedido(pedido, taxas) {
  const p = pedido || {};
  const avisos = [];
  const naPorta = round2(p.cobrarDoCliente);
  const bruto = round2(p.pagoPeloApp);
  const canal = p.plataforma === 'ifood' ? 'ifood' : '99food';

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

  // A venda líquida: o que sobrou do que o cliente pagou depois de tirar o que
  // é da plataforma por fora. Pode ficar negativa se a comanda vier lida
  // errado; não é aparada em zero de propósito — seria esconder o erro.
  const vendaLiquida = round2(bruto - taxa);
  const comissaoPct = taxaDoCanal(canal, taxas);
  const comissao = round2(vendaLiquida * comissaoPct / 100);

  // ⚠️ Sem NENHUM dos dois valores, não há o que somar. Entrar como zero seria
  // pior que ficar de fora: inflaria a contagem de pedidos do dia com uma
  // venda que ninguém sabe quanto foi, e o total continuaria errado do mesmo
  // jeito. Fica de fora E aparece no aviso — some da conta, não da vista.
  const semValor = p.pagoPeloApp == null && p.cobrarDoCliente == null;
  if (semValor) avisos.push('nenhum valor de pagamento lido — ficou FORA do dia');

  return {
    numero: p.numero || null,
    semValor,
    canal,
    bruto,
    // Despesa do canal que está NA comanda: serviço + entrega da plataforma.
    taxa,
    vendaLiquida,
    comissaoPct,
    // Despesa do canal que NÃO está na comanda: vem do contrato.
    comissao,
    liquido: round2(vendaLiquida - comissao),
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
export function lancamentoDoDia(data, pedidos, taxas) {
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
    const l = lancamentoDoPedido(ped, taxas);
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

  // ⚠️ `ifoodTaxa`/`nfoodTaxa` no Gestão são PORCENTAGEM, não reais. A tela de
  // Vendas → Lançamentos mostra "bruto · taxa% · líquido" e calcula o líquido
  // na linha. Mandando reais, o histórico exibia "797,69 – 151.59%" — número
  // absurdo na cara de todo mundo, e a única razão de isto ter sido visto.
  //
  // A porcentagem é EFETIVA: junta entrega, serviço e comissão num só número,
  // porque é ela que explica a distância entre as duas colunas que a tela
  // mostra. Mandar só os 27% do contrato deixaria bruto e líquido sem bater.
  const pctEfetivo = (canal) => {
    const b = soma(canal, 'bruto');
    if (!b) return 0;
    return round2((1 - soma(canal, 'liquido') / b) * 100);
  };

  const dia = {
    data,
    ifood: soma('ifood', 'bruto'),
    ifoodTaxa: pctEfetivo('ifood'),
    ifoodLiq: soma('ifood', 'liquido'),
    '99food': soma('99food', 'bruto'),
    nfoodTaxa: pctEfetivo('99food'),
    nfoodLiq: soma('99food', 'liquido'),
    // O que o entregador recebeu na porta é dinheiro que chega na loja, dos
    // dois canais juntos: em Vendas ele não tem coluna por plataforma.
    dinheiro: round2(linhas.reduce((s, l) => s + l.naPorta, 0)),
    // Informação, nunca dinheiro: já está abatido do que o cliente pagou.
    descontos: round2(linhas.reduce((s, l) => s + l.desconto, 0)),
    pedidos: linhas.length,
  };
  // Em reais, pra tela do agente: o que a plataforma fica, separado do que
  // está na comanda e do que vem do contrato. O endpoint ignora estes campos.
  dia.ifoodComissao = soma('ifood', 'comissao');
  dia.nfoodComissao = soma('99food', 'comissao');
  dia.taxasEmReais = round2(
    soma('ifood', 'taxa') + soma('99food', 'taxa') + dia.ifoodComissao + dia.nfoodComissao,
  );

  // ⚠️ O TOTAL DO DIA É O LÍQUIDO, não o bruto. O bruto é o que o cliente
  // pagou, e dele a plataforma fica com entrega, serviço e comissão — dinheiro
  // que nunca chega na loja. Somar bruto inflava o faturamento do mês em ~30%
  // no iFood, calado. O bruto continua na coluna do canal, que é onde ele
  // responde "de que tamanho é este canal".
  dia.total = round2(dia.ifoodLiq + dia.nfoodLiq + dia.dinheiro);

  // ⚠️ O dinheiro da porta entra INTEIRO. A comissão sobre ele não está na
  // comanda e o dono ainda não disse como o extrato a cobra — aplicar a mesma
  // regra seria chutar. Entra cheio e aparece no aviso, uma vez por dia (não
  // por pedido: aviso que grita sempre é aviso que ninguém lê).
  if (dia.dinheiro > 0) {
    avisos.push(`R$ ${dia.dinheiro.toFixed(2)} cobrados na porta entraram INTEIROS no total`
      + ' — a comissão da plataforma sobre esse dinheiro não está na comanda');
  }

  if (duplicados) avisos.push(`${duplicados} comanda(s) repetida(s) ignorada(s) — a mesma via impressa duas vezes`);
  if (semNumero) avisos.push(`${semNumero} pedido(s) sem número: não deu pra conferir contra repetição`);
  dia.avisos = avisos;
  return dia;
}
