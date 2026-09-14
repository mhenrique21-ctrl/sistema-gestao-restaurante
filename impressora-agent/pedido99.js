// Lê a comanda do 99Food e devolve o pedido.
// ============================================================================
// Escrito em cima de uma comanda REAL (pedido #871001, 14/09/2026), não de um
// layout imaginado. O que a comanda tem, nesta ordem:
//
//   Confraria Café                      ← nome da loja
//   #871001                             ← número do pedido
//   Nome do teste                       ← cliente
//   Entrega da plataforma               ← quem entrega
//   Código de verificação / #9877       ← código que o entregador confere
//   Endereço  Central, Macapá - AP…
//   Observações do pedido / Cancelar apenas o que está em falta
//   1x  Suco Abacaxi c/ Hortelã   R$11,90
//   Subtotal / Total do pedido / Pagamento via 99Food / Cobrar do cliente
//   Pagamento em dinheiro
//   Horário do aceite do pedido 14 de set 11:25
//
// ⚠️ O QUE NÃO PODE SER CONFUNDIDO: "Pagamento via 99Food" é o que a plataforma
// repassa; "Cobrar do cliente" é o que o entregador recebe na porta. Nesta
// comanda o primeiro é R$0,00 e o segundo R$51,70 — pedido pago EM DINHEIRO na
// entrega. Somar os dois dobraria o faturamento do dia; trocar um pelo outro
// jogaria dinheiro de caixa na conta a receber do 99Food.
//
// ⚠️ NADA É ADIVINHADO. Linha que não casa com nenhuma âncora volta em
// `naoEntendido` em vez de virar palpite — é o que mostra o que falta ajustar
// quando o layout mudar, em vez de gerar um pedido errado em silêncio.

// Âncoras do layout. Comparadas sem acento e sem caixa porque a tabela de
// caracteres da impressora pode comer um acento sem avisar.
const fold = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// Os rótulos são reconhecidos por um TRECHO SEM ACENTO, não pela frase inteira.
// Motivo concreto: numa captura de teste a impressora entregou "Código de
// verificação" como "Cudigo de verificaúo" — tabela de caracteres diferente da
// esperada. Comparando a frase toda, o rótulo deixava de existir e o endereço
// engolia o resto da comanda, itens inclusive. O trecho ASCII sobrevive à troca
// de tabela porque é justamente a parte sem acento.
const MARCAS = [
  ['codigoVerificacao', 'verifica'],       // "Código de verificação"
  ['endereco',          'endere'],         // "Endereço"
  ['observacoes',       'observa'],        // "Observações do pedido"
  ['taxaEntrega',       'taxa de entrega'],
  ['desconto',          'desconto'],
  ['subtotal',          'subtotal'],
  ['total',             'total do pedido'],
  ['pagoPeloApp',       'pagamento via'],  // "Pagamento via 99Food"
  ['cobrarDoCliente',   'cobrar do cliente'],
  ['aceitoEm',          'aceite do pedido'],
];
const VALORES = ['taxaEntrega', 'desconto', 'subtotal', 'total', 'pagoPeloApp', 'cobrarDoCliente'];

const marcaDaLinha = (l) => (MARCAS.find(([, m]) => fold(l).includes(m)) || [null])[0];
const ehRotuloConhecido = (l) => marcaDaLinha(l) != null;

// R$1.234,56 e R$ 0,00 — vírgula decimal, ponto de milhar. Number() direto
// devolveria 1.234 pra mil e duzentos, e o erro só apareceria no fechamento.
export function valorBR(txt) {
  const m = String(txt || '').match(/-?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  const v = parseFloat(`${m[1].replace(/\./g, '')}.${m[2]}`);
  return /^-|^\s*-/.test(String(txt).trim()) ? -v : v;
}

// O valor do rótulo é o ÚLTIMO da linha, não um recorte por posição: a coluna
// onde ele cai muda com o tamanho do nome do rótulo e do papel.
function ultimoValorBR(txt) {
  const achados = String(txt || '').match(/-?\s*R?\$\s*[\d.]*\d,\d{2}/g);
  return achados ? valorBR(achados[achados.length - 1]) : null;
}

// "1x Suco de graviola  R$11,90". O valor pode cair na linha de baixo quando o
// nome é comprido — a térmica quebra em 32 colunas e não avisa.
const ITEM = /^(\d+)\s*[xX]\s+(.+?)(?:\s+R\$\s*([\d.]*\d,\d{2}))?\s*$/;

// Texto depois da primeira palavra ("Endereço   Central, …" → "Central, …").
// Cortar por posição fixa quebraria com o acento trocado, que muda o tamanho.
const depoisDaPrimeiraPalavra = (l) => {
  const m = String(l).match(/^\S+\s+(.*)$/);
  return m ? m[1].trim() : '';
};

export function lerPedido99(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^[-=*_.\u2014\u2013\s]+$/.test(l));

  const p = {
    loja: null, numero: null, cliente: null, tipoEntrega: null,
    codigoVerificacao: null, endereco: null, observacoes: [],
    itens: [], subtotal: null, taxaEntrega: null, desconto: null, total: null,
    pagoPeloApp: null, cobrarDoCliente: null, formaPagamento: null,
    aceitoEm: null, naoEntendido: [],
  };

  // ── Cabeçalho: loja, número, cliente, quem entrega ───────────────────────
  let i = 0;
  const iNumero = linhas.findIndex((l) => /^#\s*\d{3,}$/.test(l.trim()));
  if (iNumero >= 0) {
    p.loja = iNumero > 0 ? linhas.slice(0, iNumero).join(' ').trim() : null;
    p.numero = linhas[iNumero].replace(/[^\d]/g, '');
    i = iNumero + 1;
    if (linhas[i] && !ehRotuloConhecido(linhas[i]) && !ITEM.test(linhas[i])) p.cliente = linhas[i++].trim();
    if (linhas[i] && !ehRotuloConhecido(linhas[i]) && !ITEM.test(linhas[i])) {
      p.tipoEntrega = linhas[i++].trim();
    }
  }

  // Um rótulo vale até o PRÓXIMO rótulo conhecido: o endereço quebra em duas ou
  // três linhas e fixar a quantidade cortaria o número da casa fora. Também
  // para num valor solto — é o começo do bloco de totais.
  const ateProximoRotulo = (k, primeira) => {
    const partes = primeira ? [primeira] : [];
    let j = k;
    while (j < linhas.length && !ehRotuloConhecido(linhas[j])
           && !ITEM.test(linhas[j]) && ultimoValorBR(linhas[j]) == null) {
      partes.push(linhas[j].trim());
      j++;
    }
    return [partes.filter(Boolean), j];
  };

  while (i < linhas.length) {
    const l = linhas[i];

    // Item primeiro: "1x Desconto especial R$5,00" é item, não o rótulo
    // "Desconto". Deixar o rótulo ganhar faria o item virar abatimento.
    const mItem = l.match(ITEM);
    if (mItem) {
      const item = { qtd: parseInt(mItem[1], 10), nome: mItem[2].trim(), valor: valorBR(mItem[3]) };
      if (item.valor == null && linhas[i + 1] != null && valorBR(linhas[i + 1]) != null
          && !ehRotuloConhecido(linhas[i + 1]) && !ITEM.test(linhas[i + 1])) {
        item.valor = valorBR(linhas[i + 1]);
        i += 1;
      }
      p.itens.push(item);
      i += 1;
      continue;
    }

    const campo = marcaDaLinha(l);

    if (campo && VALORES.includes(campo)) {
      // Na mesma linha ("Subtotal  R$51,70") ou na de baixo ("Cobrar do
      // cliente" / "R$51,70" — a comanda destaca esse em fonte grande).
      const propria = ultimoValorBR(l);
      if (propria != null) { p[campo] = propria; i += 1; }
      else {
        const abaixo = linhas[i + 1] != null ? ultimoValorBR(linhas[i + 1]) : null;
        p[campo] = abaixo; i += abaixo != null ? 2 : 1;
      }
      continue;
    }
    if (campo === 'codigoVerificacao') {
      const aqui = l.match(/#?\s*(\d{3,})\s*$/);
      if (aqui) { p.codigoVerificacao = aqui[1]; i += 1; continue; }
      const alvo = (linhas[i + 1] || '').trim();
      if (/^#?\s*\d+$/.test(alvo)) { p.codigoVerificacao = alvo.replace(/[^\d]/g, ''); i += 2; }
      else i += 1;
      continue;
    }
    if (campo === 'endereco') {
      const [partes, j] = ateProximoRotulo(i + 1, depoisDaPrimeiraPalavra(l));
      // "68900-" + "041" é uma quebra no meio do CEP: colar com espaço
      // inventaria um endereço que o mapa não acha.
      p.endereco = partes.join(' ').replace(/-\s+(?=\d)/g, '-') || null;
      i = j;
      continue;
    }
    if (campo === 'observacoes') {
      const [partes, j] = ateProximoRotulo(i + 1);
      p.observacoes = partes;
      i = j;
      continue;
    }
    if (campo === 'aceitoEm') {
      p.aceitoEm = l.replace(/^.*?pedido\s*:?\s*/i, '').trim() || null;
      i += 1;
      continue;
    }
    if (/^pagamento\b/.test(fold(l)) && ultimoValorBR(l) == null) {
      p.formaPagamento = l.trim();
      i += 1;
      continue;
    }

    p.naoEntendido.push(l.trim());
    i += 1;
  }

  return p;
}

// A impressora de captura é dedicada, mas nada impede alguém mandar outra coisa
// pra ela por engano. Sem esta conferência, um recibo qualquer viraria pedido.
export function ehComanda99(texto) {
  const t = fold(texto);
  return /#\s*\d{3,}/.test(String(texto)) && (t.includes('99food') || t.includes('cobrar do cliente'));
}

// Confere a comanda contra ela mesma. A soma dos itens tem que dar o subtotal,
// e o que a plataforma repassa mais o que o entregador cobra tem que dar o
// total. Divergência é sinal de item que não foi lido — e é melhor aparecer na
// tela do que virar um pedido com valor errado no Gestão.
export function conferirPedido99(p) {
  const avisos = [];
  const perto = (a, b) => a != null && b != null && Math.abs(a - b) < 0.01;
  const somaItens = p.itens.reduce((s, it) => s + (it.valor || 0) * 1, 0);

  if (!p.numero) avisos.push('sem número do pedido');
  if (!p.itens.length) avisos.push('nenhum item lido');
  if (p.itens.some((it) => it.valor == null)) avisos.push('item sem valor');
  if (p.subtotal != null && p.itens.length && !perto(somaItens, p.subtotal)) {
    avisos.push(`itens somam ${somaItens.toFixed(2)} e o subtotal diz ${p.subtotal.toFixed(2)}`);
  }
  if (p.total != null && p.pagoPeloApp != null && p.cobrarDoCliente != null
      && !perto(p.pagoPeloApp + p.cobrarDoCliente, p.total)) {
    avisos.push('repasse da plataforma + cobrança do cliente não fecham com o total');
  }
  if (p.naoEntendido.length) avisos.push(`${p.naoEntendido.length} linha(s) não reconhecida(s)`);
  return avisos;
}
