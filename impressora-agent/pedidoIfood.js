// Lê a comanda do iFood e devolve o pedido.
// ============================================================================
// Escrito em cima de uma comanda REAL (pedido de teste do próprio iFood,
// 15/09/2026, Gestor Web 9.342.0), não de um layout imaginado — mesma regra do
// `pedido99.js`. O que a comanda tem, nesta ordem:
//
//   iFood / Confraria Cafe / EXPEDICAO
//   ** PREPARO PRIORITARIO **
//   PEDIDO: #1234
//   | Entrega Propria |  | TURBO TURBO TURBO |     ← caixa desenhada
//   CODIGO DE COLETA PARCEIRA: 0000
//   Data: … / Entrega prevista: … / Localizador: 1991 8685
//   <nome do cliente> / telefone ID: … / Endereco: … / Comp: / Bairro: / Cidade:
//   ITENS DO PEDIDO (3)
//   1x  NOME DO ITEM -     R$ 6,99      ← nome continua nas linhas indentadas
//       1 Complemento      R$ 1,99      ← complemento: sem "x", indentado
//   Valor total do pedido / Taxa de servico / Taxa de entrega
//   Pagamento via iFood: -R$ 44,87 / Cobrar do cliente: R$ 0,00
//
// ⚠️ A CONTA DO iFOOD NÃO É A DO 99FOOD. No 99Food, repasse + cobrança do
// cliente somam o TOTAL. Aqui o total do pedido é só a mercadoria, e as taxas
// entram por fora:
//
//   valorTotal + taxaServico + taxaEntrega = pagoPeloApp + cobrarDoCliente
//         33,88 +       0,99 +       10,00 =      44,87 +            0,00
//
// Usar a fórmula do 99Food aqui acusaria divergência em todo pedido.
//
// ⚠️ "Pagamento via iFood" vem NEGATIVO na comanda (-R$ 44,87): é um abatimento
// do ponto de vista dela. Aqui ele é guardado POSITIVO, como no 99Food, porque
// o campo quer dizer a mesma coisa nos dois — "o que a plataforma repassa".
// Guardar o sinal cru obrigaria quem lê a saber de qual plataforma veio antes
// de somar, e é assim que um dia alguém subtrai faturamento sem perceber.
//
// ⚠️ NADA É ADIVINHADO. Linha que não casa com âncora nenhuma volta em
// `naoEntendido` em vez de virar palpite.

// Sem acento, sem caixa, espaço colapsado — a tabela de caracteres da
// impressora pode comer um acento sem avisar (numa captura real "verificação"
// voltou "verificaúo"). Por isso toda âncora é um trecho SEM ACENTO.
const fold = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// ⚠️ A ORDEM IMPORTA: "itens do pedido" tem que ser testado ANTES de "pedido:",
// senão o cabeçalho da lista de itens seria lido como o número do pedido.
const MARCAS = [
  ['itens',            'itens do pedido'],
  ['numero',           'pedido:'],
  ['codigoColeta',     'codigo de coleta'],
  ['data',             'data:'],
  ['previsao',         'entrega prevista'],
  ['localizador',      'localizador'],
  ['endereco',         'endereco:'],
  ['complementoEnd',   'comp:'],
  ['bairro',           'bairro:'],
  ['referencia',       'ref:'],
  ['cidade',           'cidade:'],
  ['formaPagamento',   'pagamento realizado'],
  ['total',            'valor total do'],
  ['taxaServico',      'taxa de servico'],
  ['taxaEntrega',      'taxa de entrega'],
  ['descontos',        'desconto'],
  ['pagoPeloApp',      'pagamento via ifood'],
  ['cobrarDoCliente',  'cobrar do cliente'],
  ['rodape',           'gestor web'],
];
const VALORES = ['total', 'taxaServico', 'taxaEntrega', 'descontos', 'pagoPeloApp', 'cobrarDoCliente'];

const marcaDaLinha = (l) => (MARCAS.find(([, m]) => fold(l).includes(m)) || [null])[0];
const ehRotuloConhecido = (l) => marcaDaLinha(l) != null;

// R$1.234,56 / -R$ 44,87 — vírgula decimal, ponto de milhar. Number() direto
// devolveria 1.234 para mil e duzentos, e o erro só apareceria no fechamento.
// ⚠️ O menos precisa estar COLADO no R$ (ou no número). Com `-?\s*` no meio,
// "1x PEDIDO DE TESTE -    R$ 6,99" — em que o hífen é a sobra do nome cortado
// pela térmica — virava MENOS seis e noventa e nove, e os itens somavam
// negativo. Na comanda o único menos de verdade é o do repasse, escrito
// "-R$ 44,87", sem espaço.
export function valorBR(txt) {
  const s = String(txt || '');
  const m = s.match(/(-?)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  const v = parseFloat(`${m[2].replace(/\./g, '')}.${m[3]}`);
  return m[1] === '-' ? -v : v;
}

// O valor do rótulo é o ÚLTIMO da linha, não um recorte por posição: a coluna
// onde ele cai muda com o tamanho do rótulo e com a largura do papel.
function ultimoValorBR(txt) {
  const achados = String(txt || '').match(/-?R\$\s*[\d.]*\d,\d{2}/g);
  return achados ? valorBR(achados[achados.length - 1]) : null;
}

// "1x  PEDIDO DE TESTE -   R$ 6,99"
const ITEM = /^(\d+)\s*[xX]\s+(.+?)(?:\s+-?R\$\s*[\d.]*\d,\d{2})?\s*$/;
// "    1 Chilli            R$ 1,99" — complemento não tem o "x", e é INDENTADO.
// Exigir a indentação é o que impede um item de virar complemento do anterior.
const COMPLEMENTO = /^(\s{2,})(\d+)\s+(.+?)(?:\s+-?R\$\s*[\d.]*\d,\d{2})?\s*$/;

// Texto depois do primeiro rótulo terminado em ":" ("Endereco: Rua X" → "Rua X").
// Cortar por posição fixa quebraria com o acento trocado, que muda o tamanho.
const depoisDoRotulo = (l) => {
  const m = String(l).match(/^[^:]*:\s*(.*)$/);
  return m ? m[1].trim() : String(l).trim();
};

// ⚠️ A térmica quebra em 32 colunas e o RÓTULO também quebra: "Valor total do"
// leva o valor e "pedido:" cai sozinho na linha de baixo. Sem engolir esse
// rabo, ele viraria pendência em `naoEntendido` em todo pedido — ruído que
// ensinaria a ignorar a lista justamente quando ela tivesse algo de verdade.
const ehRaboDeRotulo = (l) => {
  if (l == null) return false;
  const t = String(l).trim();
  return t.length > 0 && t.length <= 24 && ultimoValorBR(t) == null
    && /^[\wÀ-ÿ ]+:?$/.test(t) && !ehRotuloConhecido(t) && !ITEM.test(t);
};

export function lerPedidoIfood(texto) {
  // Indentação é INFORMAÇÃO aqui (separa item de complemento), então só a
  // direita é aparada. Separador e moldura da caixa saem; "| Entrega Propria |"
  // fica, porque tem conteúdo.
  const linhas = String(texto || '').split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^[-=*_.+|<>—–\s]+$/.test(l));

  const p = {
    plataforma: 'ifood',
    loja: null, numero: null, localizador: null, cliente: null,
    tipoEntrega: null, prioritario: false, codigoColeta: null,
    data: null, previsao: null,
    endereco: null, complementoEndereco: null, bairro: null,
    referencia: null, cidade: null,
    itens: [], formaPagamento: null,
    total: null, taxaServico: null, taxaEntrega: null, descontos: null,
    pagoPeloApp: null, cobrarDoCliente: null,
    naoEntendido: [],
  };

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  // A loja é o que vem entre "iFood" e a primeira âncora. "EXPEDICAO" e
  // "** PREPARO PRIORITARIO **" são carimbos da via, não nome de loja.
  const iLoja = linhas.findIndex((l) => fold(l) === 'ifood');
  if (iLoja >= 0 && linhas[iLoja + 1] && !ehRotuloConhecido(linhas[iLoja + 1])) {
    p.loja = linhas[iLoja + 1].trim();
  }
  p.prioritario = linhas.some((l) => fold(l).includes('prioritario'));
  const iEntrega = linhas.findIndex((l) => /entrega (propria|parceira)/.test(fold(l)));
  if (iEntrega >= 0) p.tipoEntrega = linhas[iEntrega].replace(/[|+\s]+/g, ' ').trim();

  // O nome do cliente não tem rótulo: é a linha imediatamente ANTES da do
  // telefone com "ID:". Achar por posição no cabeçalho quebraria com
  // "Primeiro pedido!", que só aparece em alguns pedidos.
  const iId = linhas.findIndex((l) => /\bid:\s*\d+/.test(fold(l)));
  const iCliente = iId > 0 ? iId - 1 : -1;
  if (iCliente >= 0 && !ehRotuloConhecido(linhas[iCliente])) p.cliente = linhas[iCliente].trim();

  // ── Corpo ────────────────────────────────────────────────────────────────
  // Um rótulo de texto vale até o PRÓXIMO rótulo conhecido: endereço e cidade
  // quebram em duas linhas (o CEP cai sozinho) e fixar a quantidade cortaria
  // o número da casa fora.
  const ateProximoRotulo = (k, primeira) => {
    const partes = primeira ? [primeira] : [];
    let j = k;
    while (j < linhas.length && !ehRotuloConhecido(linhas[j]) && !ITEM.test(linhas[j])) {
      partes.push(linhas[j].trim());
      j++;
    }
    return [partes.filter(Boolean), j];
  };

  let emItens = false;
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    const campo = marcaDaLinha(l);

    if (campo === 'itens') { emItens = true; i += 1; continue; }
    // ⚠️ O rodapé é a ÚLTIMA coisa da comanda, e a versão quebra em duas
    // linhas ("Gestor Web 9.342.0 - Desktop" / "8.10.0"). Pulando só a
    // primeira, o "8.10.0" virava pendência em todo pedido — ruído que ensina
    // a ignorar a lista justamente quando ela tiver algo de verdade.
    if (campo === 'rodape') break;

    // ⚠️ Dentro do bloco de itens, ITEM e COMPLEMENTO são testados ANTES de
    // qualquer rótulo — a mesma lição que o leitor do 99Food já tinha. Com o
    // rótulo ganhando, "1x Desconto especial R$ 5,00" viraria a linha de
    // Descontos do pedido: o item sumiria do ranking E o abatimento entraria
    // em dobro. Só a CONTINUAÇÃO de nome respeita rótulo, senão
    // "* Pagamento realizado *", que vem indentado, seria colado no último item.
    if (emItens) {
      const mComp = l.match(COMPLEMENTO);
      const ultimo = p.itens[p.itens.length - 1];
      if (mComp && ultimo) {
        // Dois níveis existem na comanda real: complemento do item e
        // complemento DO complemento (o ketchup dentro do sanduíche).
        const recuo = mComp[1].length;
        if (ultimo.recuoBase == null) ultimo.recuoBase = recuo;
        ultimo.complementos.push({
          qtd: parseInt(mComp[2], 10),
          nome: mComp[3].trim(),
          valor: ultimoValorBR(l),
          nivel: recuo > ultimo.recuoBase ? 2 : 1,
        });
        i += 1;
        continue;
      }
      const mItem = l.match(ITEM);
      if (mItem) {
        p.itens.push({
          qtd: parseInt(mItem[1], 10),
          nome: mItem[2].trim(),
          valor: ultimoValorBR(l),
          obs: null,
          complementos: [],
          recuoBase: null,
        });
        i += 1;
        continue;
      }
      if (ultimo && /^\s/.test(l) && !campo) {
        // Linha indentada sem número: continuação de NOME. Se já houve
        // complemento, ela continua o nome DELE ("The Ketchup 190g" embaixo de
        // "Catchup Kito"); senão continua o nome do item, que a térmica
        // quebrou em 32 colunas.
        const t = l.trim();
        if (/^obs\b/i.test(fold(t))) { ultimo.obs = depoisDoRotulo(t) || t; i += 1; continue; }
        const alvo = ultimo.complementos[ultimo.complementos.length - 1] || ultimo;
        alvo.nome = `${alvo.nome} ${t}`.replace(/\s+/g, ' ').trim();
        i += 1;
        continue;
      }
    }

    if (campo && VALORES.includes(campo)) {
      const propria = ultimoValorBR(l);
      if (propria != null) {
        // O sinal negativo do "Pagamento via iFood" é convenção da comanda, não
        // do dinheiro: guardamos o que a plataforma REPASSA, sempre positivo.
        p[campo] = (campo === 'pagoPeloApp' || campo === 'descontos') ? Math.abs(propria) : propria;
        i += 1;
        if (ehRaboDeRotulo(linhas[i])) i += 1;
      } else {
        const abaixo = linhas[i + 1] != null ? ultimoValorBR(linhas[i + 1]) : null;
        p[campo] = abaixo != null && (campo === 'pagoPeloApp' || campo === 'descontos') ? Math.abs(abaixo) : abaixo;
        i += abaixo != null ? 2 : 1;
      }
      continue;
    }

    if (campo === 'numero') {
      // ⚠️ "pedido:" aparece DUAS vezes na comanda: no cabeçalho ("PEDIDO:
      // #1234") e como rabo de "Valor total do pedido:", que a térmica quebra
      // em duas linhas. Atribuir direto fazia a segunda apagar o número lido na
      // primeira — o pedido chegava sem identidade, e a conferência acusava
      // "sem número" num pedido que tinha número impresso.
      const achado = (l.match(/#?\s*(\d+)\s*$/) || [])[1];
      if (achado) p.numero = achado;
      else if (!p.numero) p.naoEntendido.push(l.trim());
      i += 1;
      continue;
    }
    if (campo === 'codigoColeta') {
      // ⚠️ O rótulo INTEIRO quebra quando o papel aperta: num pedido real saiu
      // "CODIGO DE COLETA" numa linha e "PARCEIRA: 5977" na de baixo. Lendo só
      // a primeira, o código virava a string "CODIGO DE COLETA" e o número
      // caía em `naoEntendido` — o entregador chegaria e ninguém teria o
      // código pra conferir.
      const aqui = (l.match(/(\d{2,})\s*$/) || [])[1];
      if (aqui) { p.codigoColeta = aqui; i += 1; continue; }
      const abaixo = (String(linhas[i + 1] || '').match(/(\d{2,})\s*$/) || [])[1];
      if (abaixo) { p.codigoColeta = abaixo; i += 2; continue; }
      i += 1;
      continue;
    }
    if (campo === 'data') { p.data = depoisDoRotulo(l) || null; i += 1; continue; }
    if (campo === 'previsao') { p.previsao = depoisDoRotulo(l).replace(/[<>]+/g, '').trim() || null; i += 1; continue; }
    if (campo === 'localizador') { p.localizador = depoisDoRotulo(l) || null; i += 1; continue; }
    if (campo === 'complementoEnd') { p.complementoEndereco = depoisDoRotulo(l) || null; i += 1; continue; }
    if (campo === 'bairro') { p.bairro = depoisDoRotulo(l) || null; i += 1; continue; }
    if (campo === 'referencia') {
      // ⚠️ O ponto de referência é texto livre e quebra em QUANTAS linhas
      // precisar ("ao lado de um galpao de uma / oficina, e uma casa de altos
      // e / baixos"). Lendo só a primeira, o resto virava pendência.
      const [partes, j] = ateProximoRotulo(i + 1, depoisDoRotulo(l));
      p.referencia = partes.join(' ') || null;
      i = j;
      continue;
    }
    if (campo === 'endereco') {
      const [partes, j] = ateProximoRotulo(i + 1, depoisDoRotulo(l));
      p.endereco = partes.join(' ') || null;
      i = j;
      continue;
    }
    if (campo === 'cidade') {
      const [partes, j] = ateProximoRotulo(i + 1, depoisDoRotulo(l));
      // "CEP:" + "12345678" quebrado em duas linhas: colar com espaço
      // inventaria um CEP que nenhum mapa acha.
      p.cidade = partes.join(' ').replace(/:\s+(?=\d)/g, ': ').trim() || null;
      i = j;
      continue;
    }
    if (campo === 'formaPagamento') {
      const [partes, j] = ateProximoRotulo(i + 1);
      p.formaPagamento = partes.join(' - ').replace(/\s*-\s*/g, ' - ').trim() || null;
      i = j;
      continue;
    }

    // Linhas do cabeçalho que já foram usadas por outro caminho não voltam
    // como pendência: repetir "Entrega Propria" em `naoEntendido` ensinaria a
    // ignorar a lista justamente quando ela tivesse algo de verdade.
    const t = l.trim();
    const jaUsada = fold(t) === 'ifood' || t === p.loja || t === p.cliente
      || (p.tipoEntrega && fold(t).replace(/[|+\s]+/g, ' ').trim() === fold(p.tipoEntrega))
      // "Primeiro pedido!" e "6 pedidos na sua loja" são recado do app pro
      // lojista, não dado do pedido — pendência falsa em toda comanda.
      || /expedicao|prioritario|confirme a entrega|turbo/.test(fold(t))
      || /^(primeiro pedido|\d+ pedidos? na sua loja)/.test(fold(t))
      || /\bid:\s*\d+/.test(fold(t));
    if (!jaUsada) p.naoEntendido.push(t);
    i += 1;
  }

  p.itens.forEach((it) => { delete it.recuoBase; });
  return p;
}

// A impressora de captura é dedicada, mas nada impede alguém mandar outra coisa
// pra ela por engano. Sem esta conferência, um recibo qualquer viraria pedido.
export function ehComandaIfood(texto) {
  const t = fold(texto);
  return t.includes('ifood') && (t.includes('itens do pedido') || t.includes('cobrar do cliente'));
}

// Confere a comanda contra ela mesma. Divergência é sinal de item que não foi
// lido — e é melhor aparecer na tela do que virar valor errado no Gestão.
export function conferirPedidoIfood(p) {
  const avisos = [];
  const perto = (a, b) => a != null && b != null && Math.abs(a - b) < 0.01;
  const soma = (n) => Math.round(n * 100) / 100;

  const somaItens = soma(p.itens.reduce((s, it) => s
    + (it.valor || 0)
    + (it.complementos || []).reduce((c, x) => c + (x.valor || 0), 0), 0));

  if (!p.numero) avisos.push('sem número do pedido');
  if (!p.itens.length) avisos.push('nenhum item lido');
  if (p.itens.some((it) => it.valor == null)) avisos.push('item sem valor');
  if (p.total != null && p.itens.length && !perto(somaItens, p.total)) {
    avisos.push(`itens somam ${somaItens.toFixed(2)} e o total do pedido diz ${p.total.toFixed(2)}`);
  }
  // ⚠️ A conta do iFood: mercadoria + taxas − descontos = o que a plataforma
  // repassa + o que o entregador cobra. NÃO é a do 99Food (repasse + cobrança
  // = total). E o desconto NÃO é enfeite: num pedido real de R$ 29,90 com
  // R$ 15,00 de desconto, ignorá-lo acusaria divergência de exatamente esses
  // R$ 15,00 — em toda comanda com promoção, que no iFood são muitas.
  if (p.total != null && p.pagoPeloApp != null && p.cobrarDoCliente != null) {
    const devido = soma(p.total + (p.taxaServico || 0) + (p.taxaEntrega || 0) - (p.descontos || 0));
    const recebido = soma(p.pagoPeloApp + p.cobrarDoCliente);
    if (!perto(devido, recebido)) {
      avisos.push(`pedido + taxas dá ${devido.toFixed(2)} e repasse + cobrança dá ${recebido.toFixed(2)}`);
    }
  }
  if (p.naoEntendido.length) avisos.push(`${p.naoEntendido.length} linha(s) não reconhecida(s)`);
  return avisos;
}
