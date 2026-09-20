// Várias MARCAS e vários TAMANHOS de embalagem viram UM produto.
// ============================================================================
// "Creme de leite 200 g" é Piracanjuba, Italac e Frimesa. "Nescau em pó" é a
// lata de 395 g, o pacote de 700 g e o de 2,1 kg. São o mesmo problema: o que a
// ficha técnica precisa é do PRODUTO, e o que a nota fiscal traz é a MARCA.
//
// O agrupamento em si já existia — `produtosLista[].mpVinculados` liga o
// produto do cadastro às matérias-primas que nascem das entradas. O que faltava
// era o grupo ter uma UNIDADE PRÓPRIA em que contar, para somar saldo e custo
// de coisas compradas em embalagens diferentes.
//
// ⚠️ NENHUM SALDO É CONVERTIDO NO BANCO. Cada marca continua contando na
// unidade dela — 3 pacotes é 3 pacotes, e é isso que a pessoa conta na
// prateleira. A conversão acontece na LEITURA. Reescrever `estoqueAtual` em
// gramas seria migração de dado, e migração de saldo não tem desfazer.

import { converterQtd } from './consumoTeorico.js';

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Quanto 1 unidade de ESTOQUE da marca rende na unidade do grupo.
//
// ⚠️ TRÊS CAMINHOS, e a ordem importa:
//   1. `porUnidadeBase` — a declaração explícita, e ela VENCE. É o único jeito
//      de dizer que a lata contada em "un" tem 395 g dentro: nenhuma tabela
//      converte "un" para "g", porque isso não é conversão, é cadastro.
//   2. conversão de família (kg↔g, l↔ml) — o pacote de 2,1 kg não precisa
//      declarar nada.
//   3. **null**, nunca um palpite. Marca que não sabe quanto rende fica FORA da
//      soma e aparece como pendência: entrar com fator 1 somaria 3 latas a
//      6.300 gramas e o grupo passaria a mentir em silêncio.
export function rendimentoDaMarca(mp, unidadeBase) {
  const declarado = num(mp?.porUnidadeBase);
  if (declarado > 0) return declarado;
  const conv = converterQtd(1, mp?.unidade || 'un', unidadeBase || mp?.unidade || 'un');
  return conv && conv > 0 ? conv : null;
}

// A última ENTRADA de estoque da marca — a data da nota, não a data em que
// alguém mexeu no cadastro.
//
// ⚠️ O sistema já tinha um "mais recente" que ordena por `atualizadoEm`, e esse
// campo é carimbado sempre que `ultimoValor` muda — inclusive numa edição à
// mão. "Repreçada por último" não é "comprada por último", e a diferença
// aparece justamente quando alguém corrige um preço antigo.
export function ultimaCompra(movEstoque, mpId) {
  let melhor = null;
  for (const m of movEstoque || []) {
    if (m?.mpId !== mpId || m?.tipo !== 'entrada') continue;
    const d = String(m.data || '');
    if (!d) continue;
    if (!melhor || d > melhor.data) melhor = { data: d, custo: num(m.custo), quantidade: num(m.quantidade) };
  }
  return melhor;
}

// O retrato de uma marca dentro do grupo, já na língua do grupo.
export function marcaNoGrupo(mp, unidadeBase, movEstoque) {
  const rend = rendimentoDaMarca(mp, unidadeBase);
  const saldo = num(mp?.estoqueAtual);
  const valorUn = num(mp?.ultimoValor);
  const compra = ultimaCompra(movEstoque, mp?.id);
  return {
    id: mp?.id,
    nome: mp?.nome || '',
    unidade: mp?.unidade || 'un',
    rendimento: rend,
    // Sem rendimento não se inventa número nenhum: os campos ficam null e a
    // tela mostra o motivo.
    saldoBase: rend == null ? null : r2(saldo * rend),
    custoBase: rend == null || !valorUn ? null : valorUn / rend,
    saldo,
    valorUn,
    // Quanto DINHEIRO está parado nesta marca. É o numerador da ponderação.
    valorEmCasa: r2(saldo * valorUn),
    ultimaCompra: compra,
    pendente: rend == null,
  };
}

// ⚠️ MÉDIA PONDERADA PELO SALDO (decisão do dono, 20/09/2026), não o último
// preço: o custo da ficha passa a ser o do que está REALMENTE na despensa, e
// uma promoção isolada não derruba a margem de todas as receitas até a compra
// seguinte.
//
//   custo por unidade base = (Σ saldo × preço) ÷ (Σ saldo na unidade base)
//
// ⚠️ ESTOQUE ZERADO NÃO CUSTA ZERO. Com tudo em zero a ponderação seria 0÷0, e
// devolver zero diria "este insumo é de graça" — a mesma mentira do produzido
// que entrava no estoque valendo nada. Sem saldo, vale a ÚLTIMA COMPRA, e o
// resultado diz de onde veio (`origem`) para a tela poder avisar.
export function custoDoGrupo(marcas, unidadeBase, movEstoque) {
  const linhas = (marcas || []).map((m) => marcaNoGrupo(m, unidadeBase, movEstoque));
  const uteis = linhas.filter((l) => !l.pendente);
  const saldoBase = r2(uteis.reduce((s, l) => s + (l.saldoBase || 0), 0));
  const dinheiro = r2(uteis.reduce((s, l) => s + l.valorEmCasa, 0));

  if (saldoBase > 0) {
    return { custo: dinheiro / saldoBase, origem: 'ponderado', saldoBase, dinheiro, linhas };
  }
  // Sem saldo: a entrada mais recente entre as marcas.
  let recente = null;
  for (const l of uteis) {
    if (!l.ultimaCompra || !l.custoBase) continue;
    if (!recente || l.ultimaCompra.data > recente.ultimaCompra.data) recente = l;
  }
  if (recente) return { custo: recente.custoBase, origem: 'ultimaCompra', saldoBase: 0, dinheiro: 0, linhas };
  // Nem saldo nem compra registrada: o preço de catálogo de quem tiver um.
  const comPreco = uteis.find((l) => l.custoBase != null);
  if (comPreco) return { custo: comPreco.custoBase, origem: 'catalogo', saldoBase: 0, dinheiro: 0, linhas };
  return { custo: null, origem: null, saldoBase: 0, dinheiro: 0, linhas };
}

export function saldoDoGrupo(marcas, unidadeBase, movEstoque) {
  const { saldoBase, linhas } = custoDoGrupo(marcas, unidadeBase, movEstoque);
  return { saldoBase, pendentes: linhas.filter((l) => l.pendente), linhas };
}

// ── A busca que alimenta a ferramenta ───────────────────────────────────────
// `fold` entra por parâmetro: é o `foldNome` do App.tsx, e criar uma segunda
// normalização aqui faria a busca achar o que o resto do sistema não acha (§5).
export function buscarMarcas(db, termo, fold) {
  const t = fold(String(termo || ''));
  if (!t) return [];
  const prods = db?.produtosLista || [];
  const grupoDe = new Map();
  for (const p of prods) for (const id of p.mpVinculados || []) grupoDe.set(id, p);

  return (db?.materiasPrimas || [])
    .filter((m) => m?.nome && fold(m.nome).includes(t))
    // ⚠️ Produto do cardápio do Eclética mora na MESMA coleção que o insumo
    // comprado (§6, "cinco tipos, uma coleção"). Ele tem `codigoEcletica` e não
    // é marca de nada: agrupar um deles ligaria a fornada ao saldo do que se
    // compra, e só a contagem física denunciaria.
    .filter((m) => !String(m.codigoEcletica || '').trim())
    .map((m) => ({ mp: m, grupo: grupoDe.get(m.id) || null }))
    .sort((a, b) => String(a.mp.nome).localeCompare(String(b.mp.nome)));
}

// ── Agrupar e desagrupar ────────────────────────────────────────────────────
// As duas devolvem SÓ as fatias do db que mudam. Quem grava é a tela, com
// `setDbAndSave` — a regra do §3.

export function agruparMarcas(db, { prodId, nomeNovo, cat, unidadeBase, mpIds, rendimentos }) {
  const ids = [...new Set((mpIds || []).filter(Boolean))];
  if (!ids.length) return null;
  const agora = new Date().toISOString();
  let prods = [...(db?.produtosLista || [])];

  // ⚠️ Uma marca só pode estar em UM grupo. Entrando no novo sem sair do
  // antigo, ela seria somada duas vezes — em dois produtos diferentes, o que é
  // pior que não estar em nenhum: os dois ficariam plausíveis.
  prods = prods.map((p) => {
    const atuais = p.mpVinculados || [];
    const limpos = atuais.filter((id) => !ids.includes(id) || p.id === prodId);
    return limpos.length === atuais.length ? p : { ...p, mpVinculados: limpos, atualizadoEm: agora };
  });

  const i = prodId ? prods.findIndex((p) => p.id === prodId) : -1;
  if (i >= 0) {
    prods[i] = {
      ...prods[i],
      mpVinculados: [...new Set([...(prods[i].mpVinculados || []), ...ids])],
      unidadeBase: unidadeBase || prods[i].unidadeBase || prods[i].unidade || 'un',
      atualizadoEm: agora,
    };
  } else {
    prods.unshift({
      id: `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      nome: String(nomeNovo || '').trim(),
      cat: cat || '',
      unidade: unidadeBase || 'un',
      unidadeBase: unidadeBase || 'un',
      mpVinculados: ids,
      criadoEm: agora,
      // ⚠️ `produtosLista` é compartilhado entre as duas empresas e a fusão
      // desempata por carimbo: sem ele o primeiro save já nasce perdendo (§3).
      atualizadoEm: agora,
    });
  }

  // O rendimento declarado de cada marca, quando a tela pediu.
  const mps = (db?.materiasPrimas || []).map((m) => {
    const r = rendimentos?.[m.id];
    if (r == null || !(num(r) > 0)) return m;
    return { ...m, porUnidadeBase: num(r), atualizadoEm: agora };
  });

  return { produtosLista: prods, materiasPrimas: mps };
}

export function desagruparMarca(db, prodId, mpId) {
  const agora = new Date().toISOString();
  return {
    produtosLista: (db?.produtosLista || []).map((p) => (p.id !== prodId ? p : {
      ...p,
      mpVinculados: (p.mpVinculados || []).filter((id) => id !== mpId),
      atualizadoEm: agora,
    })),
  };
}

// As marcas de um grupo, resolvidas.
export function marcasDoGrupo(db, prod) {
  const porId = new Map((db?.materiasPrimas || []).map((m) => [m.id, m]));
  return (prod?.mpVinculados || []).map((id) => porId.get(id)).filter(Boolean);
}

export const unidadeBaseDo = (prod) => prod?.unidadeBase || prod?.unidade || 'un';

// ── O custo que a ficha lê ──────────────────────────────────────────────────
// ⚠️ A ficha guarda a quantidade na unidade DELA ("40 g", "0,2 kg") e o grupo
// conta na unidade do grupo. O custo por unidade base precisa ser convertido
// para a unidade da ficha, e a conta é a que parece errada à primeira vista:
//
//   custo por kg = custo por g × (quantos g cabem em 1 kg)
//
// Dividir em vez de multiplicar dá um custo mil vezes menor — e continua
// parecendo um número.
export function custoParaUnidade(marcas, unidadeBase, unidadeAlvo, movEstoque) {
  const c = custoDoGrupo(marcas, unidadeBase, movEstoque);
  if (c.custo == null) return { valor: null, origem: null, motivo: 'grupo sem preço' };
  const fator = converterQtd(1, unidadeAlvo || unidadeBase, unidadeBase);
  // ⚠️ Sem conversão NÃO se chuta. Ficha em "un" com grupo contando em "g" é
  // cadastro incompleto, não erro de conta: devolver o custo por grama como se
  // fosse por unidade multiplicaria o CMV por mil, calado.
  if (fator == null || !(fator > 0)) {
    return { valor: null, origem: c.origem, motivo: `a ficha está em "${unidadeAlvo}" e o grupo conta em "${unidadeBase}"` };
  }
  return { valor: c.custo * fator, origem: c.origem, saldoBase: c.saldoBase };
}

// ── O rateio da saída entre as marcas ───────────────────────────────────────
// ⚠️ Tira primeiro de quem tem MAIS saldo e cascateia (decisão do dono).
// Baixando tudo de uma marca só, ela fica muito negativa enquanto a outra segue
// cheia — e nenhuma das duas reflete a prateleira.
//
// ⚠️ NÃO é o `distribuirEntreMarcas` da revenda, e a diferença importa: aquele
// converte por `converterQtd`/`unidadesPorEmbalagem` e não conhece
// `porUnidadeBase`. A lata de Nescau contada em "un" ficaria de fora lá.
export function ratearEntreMarcas(marcas, qtdBase, unidadeBase) {
  const uteis = (marcas || [])
    .map((m) => ({ mp: m, rend: rendimentoDaMarca(m, unidadeBase) }))
    .filter((x) => x.rend != null && x.rend > 0);
  if (!uteis.length || !(qtdBase > 0)) return [];

  const disp = (x) => Math.max(0, num(x.mp.estoqueAtual) * x.rend);
  const ord = [...uteis].sort((a, b) => disp(b) - disp(a));
  const out = [];
  let resta = qtdBase;

  for (const x of ord) {
    if (resta <= 0.000001) break;
    const d = disp(x);
    if (d <= 0) continue;
    const leva = Math.min(resta, d);
    out.push({ mpId: x.mp.id, mp: x.mp, qtdBase: r3(leva), qtd: r3(leva / x.rend), unidade: x.mp.unidade || 'un' });
    resta -= leva;
  }

  // ⚠️ Ninguém tem saldo (ou faltou): o resto vai INTEIRO na primeira, deixando
  // negativo. "Usou sem ter registrado a compra" é a informação honesta —
  // espalhar o negativo entre todas faria parecer que todas estão erradas.
  if (resta > 0.000001) {
    const alvo = ord[0];
    const ja = out.find((o) => o.mpId === alvo.mp.id);
    if (ja) { ja.qtdBase = r3(ja.qtdBase + resta); ja.qtd = r3(ja.qtdBase / alvo.rend); }
    else out.push({ mpId: alvo.mp.id, mp: alvo.mp, qtdBase: r3(resta), qtd: r3(resta / alvo.rend), unidade: alvo.mp.unidade || 'un' });
  }
  return out;
}

// O grupo de uma matéria-prima, se ela estiver em algum.
export function grupoDaMarca(db, mpId) {
  if (!mpId) return null;
  return (db?.produtosLista || []).find((p) => (p.mpVinculados || []).includes(mpId)) || null;
}

// O grupo de uma linha de ficha: pelo `prodListaId` que ela guarda, e senão
// pelo grupo em que a marca gravada estiver.
export function grupoDoInsumo(db, insumo) {
  const porId = insumo?.prodListaId
    ? (db?.produtosLista || []).find((p) => p.id === insumo.prodListaId)
    : null;
  const prod = porId || grupoDaMarca(db, insumo?.mpId);
  if (!prod) return null;
  const marcas = marcasDoGrupo(db, prod);
  return marcas.length ? { prod, marcas, unidadeBase: unidadeBaseDo(prod) } : null;
}

function r3(n) { return Math.round((n || 0) * 1000) / 1000; }

// ── Trocar a unidade em que o grupo conta ───────────────────────────────────
// ⚠️ `porUnidadeBase` é declarado NA UNIDADE DO GRUPO. Trocar a unidade sem
// mexer nas declarações faria "1 un = 900" passar a significar 900 kg em vez de
// 900 g — o saldo do grupo ficaria mil vezes maior, e continuaria parecendo um
// número. Por isso a troca CONVERTE cada declaração.
export function trocarUnidadeBase(db, prodId, novaBase) {
  const prod = (db?.produtosLista || []).find((p) => p.id === prodId);
  if (!prod || !novaBase) return null;
  const antiga = unidadeBaseDo(prod);
  const agora = new Date().toISOString();
  if (antiga === novaBase) return { produtosLista: db.produtosLista, materiasPrimas: db.materiasPrimas, avisos: [] };

  const fator = converterQtd(1, antiga, novaBase);
  const ids = new Set(prod.mpVinculados || []);
  const avisos = [];

  const materiasPrimas = (db?.materiasPrimas || []).map((m) => {
    if (!ids.has(m.id) || !(num(m.porUnidadeBase) > 0)) return m;
    if (fator == null) {
      // ⚠️ Sem conversão entre as duas unidades, a declaração antiga não quer
      // dizer nada na nova. Ela é APAGADA e a marca volta a ser pendência —
      // manter um número sem significado é pior que pedir de novo, porque o
      // grupo continuaria somando com ele.
      avisos.push(m.nome);
      const { porUnidadeBase, ...resto } = m;
      return { ...resto, atualizadoEm: agora };
    }
    return { ...m, porUnidadeBase: r3(num(m.porUnidadeBase) * fator), atualizadoEm: agora };
  });

  const produtosLista = (db?.produtosLista || []).map((p) => (p.id !== prodId ? p
    : { ...p, unidadeBase: novaBase, unidade: p.unidade || novaBase, atualizadoEm: agora }));

  return { produtosLista, materiasPrimas, avisos, fator };
}

// ── A pasta dos insumos comprados que ainda não têm grupo ───────────────────
// A ferramenta acima resolve o "creme de leite" que a pessoa LEMBRA de
// procurar. O que ela não resolve é o resto: o insumo que entrou por uma NF-e
// há três semanas e nunca foi ligado a produto nenhum não aparece em busca
// nenhuma, porque ninguém digita o nome de um item de que não se lembra.
//
// ⚠️ ESTA PASTA NÃO É O BANNER ÂMBAR DE "CONCILIAR INSUMOS". Aquele conta
// `materiasPrimas` sem `mpVinculados` e mais nada — e `materiasPrimas` é "item
// com saldo", não "insumo comprado" (§6, "cinco tipos, uma coleção"): os
// produtos do cardápio do Eclética e os itens feitos na cozinha moram lá
// dentro. Nenhum dos dois pode ser ligado a um produto da lista de compras, e
// contá-los faz a fila NUNCA chegar a zero — que é o estado em que uma fila
// deixa de ser lida.
const VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por', 'em', 'no', 'na',
  'tipo', 'und', 'unid', 'pct', 'pc', 'cx', 'emb', 'kg', 'ml', 'lt', 'gr',
]);

// As palavras que valem para procurar um insumo pelo nome.
//
// ⚠️ Fora o ruído óbvio, cai tudo que COMEÇA com dígito: "375g", "200ml" e
// "12x1l" são embalagem, e é justamente a embalagem que difere entre duas
// marcas do mesmo produto — agrupar por ela separaria o que devia juntar.
export function tokensDoNome(nome, fold) {
  return fold(String(nome || ''))
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d/.test(t) && !VAZIAS.has(t));
}

// O que jogar na busca da ferramenta quando a pessoa clica em "conciliar".
//
// ⚠️ É UMA palavra só, de propósito. O nome inteiro ("CR AVELA NUTELLA 375G")
// acha aquele item e mais nenhum — e o ponto de conciliar é ver as OUTRAS
// marcas do mesmo produto na mesma tela, que é quando se percebe que Piracanjuba
// e Italac são a mesma coisa. `buscarMarcas` casa por inclusão, então duas
// palavras separadas no nome de uma marca e coladas noutra não casariam.
export function termoDeBusca(nome, fold) {
  const t = tokensDoNome(nome, fold);
  return t[0] || fold(String(nome || ''));
}

export function insumosSemGrupo(db, fold, tipoDe) {
  const agrupados = new Set();
  for (const p of db?.produtosLista || []) for (const id of p.mpVinculados || []) agrupados.add(id);
  const mov = db?.movEstoque || [];
  const fora = { cardapio: 0, produzido: 0 };
  const itens = [];

  for (const m of db?.materiasPrimas || []) {
    if (!m?.id || agrupados.has(m.id)) continue;
    // Produto do cardápio: tem código do Eclética, não vem de compra.
    if (String(m.codigoEcletica || '').trim()) { fora.cardapio++; continue; }
    // Feito na cozinha: o bolo não tem produto na lista de compras.
    if (tipoDe && tipoDe(m) === 'produzido') { fora.produzido++; continue; }
    const saldo = num(m.estoqueAtual);
    const valorUn = num(m.ultimoValor);
    itens.push({
      id: m.id,
      mp: m,
      nome: m.nome || '',
      unidade: m.unidade || 'un',
      categoria: m.categoria || '',
      saldo,
      valorUn,
      // Quanto dinheiro está parado num item que nenhuma ficha enxerga.
      dinheiro: r2(saldo * valorUn),
      ultimaCompra: ultimaCompra(mov, m.id),
      tokens: tokensDoNome(m.nome, fold),
    });
  }
  return { itens, fora, dinheiro: r2(itens.reduce((s, i) => s + i.dinheiro, 0)) };
}

const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');

// Os três modos devolvem o MESMO formato — uma lista de blocos — para a tela
// não ter três desenhos diferentes. Nos dois modos simples há um bloco só.
export function agruparPendentes(itens, modo) {
  const lista = [...(itens || [])];

  if (modo === 'nome') return [{ chave: '', rotulo: '', itens: lista.sort(porNome) }];

  if (modo === 'semelhanca') {
    const mapa = new Map();
    for (const i of lista) {
      const k = i.tokens[0] || '';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(i);
    }
    const blocos = [...mapa.entries()].map(([chave, its]) => ({ chave, rotulo: chave, itens: its.sort(porNome) }));
    // ⚠️ Quem não tem semelhante NENHUM vira um bloco só no fim, não 50 blocos
    // de um item cada: uma lista de títulos com uma linha embaixo de cada é
    // mais difícil de ler que a lista simples que ela deveria organizar.
    const juntos = blocos.filter((b) => b.itens.length > 1)
      .sort((a, b) => b.itens.length - a.itens.length || a.chave.localeCompare(b.chave));
    const sozinhos = blocos.filter((b) => b.itens.length === 1).flatMap((b) => b.itens).sort(porNome);
    return sozinhos.length ? [...juntos, { chave: '', rotulo: 'sem semelhante na fila', itens: sozinhos }] : juntos;
  }

  // Padrão: a compra mais recente primeiro. É o que se está comprando agora e
  // é o que vai cair na próxima ficha; por ordem alfabética, o insumo comprado
  // ontem ficaria na letra M esperando alguém rolar até lá.
  return [{
    chave: '',
    rotulo: '',
    itens: lista.sort((a, b) => {
      const da = a.ultimaCompra?.data || '';
      const dbd = b.ultimaCompra?.data || '';
      // Sem entrada registrada vai para o fim: '' perde de qualquer data.
      if (da !== dbd) return dbd.localeCompare(da);
      return porNome(a, b);
    }),
  }];
}

// O palpite de destino de UMA linha.
//
// ⚠️ Palpite é atalho de tela, nunca lote. O `autoMatchInsumo` do painel antigo
// casa por inclusão nos dois sentidos com 4 caracteres, e aplicado em lote um
// produto chamado "Leite" engoliria "Leite condensado" e "Creme de leite
// Piracanjuba" de uma vez — o custo sairia do produto errado e só apareceria no
// CMV, meses depois. Aqui o nome do produto precisa aparecer INTEIRO e em
// fronteira de palavra dentro do nome da marca, o MAIS LONGO vence (senão
// "Leite" ganharia de "Leite condensado"), e empate não escolhe — a mesma
// recusa do `acharColunas` diante de dois rótulos que servem para o mesmo campo.
export function sugerirGrupo(db, nome, fold) {
  const alvo = fold(String(nome || ''));
  if (!alvo) return null;
  let melhor = null;
  let melhorLen = 0;
  let empate = false;
  for (const p of db?.produtosLista || []) {
    const n = fold(p?.nome || '');
    if (n.length < 4 || !contemPalavra(alvo, n)) continue;
    if (n.length > melhorLen) { melhor = p; melhorLen = n.length; empate = false; }
    else if (n.length === melhorLen) empate = true;
  }
  return empate ? null : melhor;
}

function contemPalavra(texto, termo) {
  for (let i = texto.indexOf(termo); i >= 0; i = texto.indexOf(termo, i + 1)) {
    const antes = i === 0 || !/[a-z0-9]/.test(texto[i - 1]);
    const fim = i + termo.length;
    const depois = fim === texto.length || !/[a-z0-9]/.test(texto[fim]);
    if (antes && depois) return true;
  }
  return false;
}
