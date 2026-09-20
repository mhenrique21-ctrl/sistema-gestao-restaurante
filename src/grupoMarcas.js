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
