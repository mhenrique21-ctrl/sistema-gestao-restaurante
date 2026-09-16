// Ponte entre o CATÁLOGO DE PRODUÇÃO e o ITEM DE ESTOQUE (o produto vendido no
// Eclética). A cozinha pede "Coxinha de frango"; na prateleira o item é
// "SALG COXINHA FRANGO". Sem ligar os dois, produzir não alimenta saldo nenhum
// e o pedido nunca fecha — foi o que deixou 54 itens pendentes com "sem produto
// no estoque".
//
// ⚠️ Isto NÃO é a aba "Vínculos" que foi apagada. Aquela mapeava produto
// VENDIDO → ficha/produto da lista, e virou automática quando os produtos
// passaram a ter `codigoEcletica` (o XML da venda traz o mesmo código). Aqui o
// lado de origem é o NOME digitado no catálogo de produção, que não tem código
// nenhum e não casa sozinho. Ver CLAUDE.md, "Estoque → Saídas por venda".
//
// Mora fora do App.tsx porque sugerir vínculo errado erra em SILÊNCIO: a
// produção entraria no saldo do produto errado e só a contagem física
// denunciaria, semanas depois.

import { tipoDoInsumo } from './tipoInsumo.js';

// Normalização mais agressiva que o foldNome do app: além de acento e caixa,
// tira a pontuação e o ruído de catálogo ("salg.", "p/ café", "un"), que é o
// que separa "Coxinha de frango" de "SALG. COXINHA FRANGO".
const RUIDO = new Set([
  'salg', 'salgado', 'salgados', 'doce', 'doces', 'un', 'und', 'unid', 'kg', 'g', 'ml',
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'p', 'c', 'e', 'a', 'o', 'em',
]);

export const normalizarNome = (v) => String(v || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const tokens = (v) => normalizarNome(v).split(' ').filter((t) => t && !RUIDO.has(t));

// Dice sobre os conjuntos de palavras: 1 = mesmas palavras, 0 = nada em comum.
// Escolhido em vez de distância de edição porque o problema aqui é ORDEM e
// ruído ("trança de salame (burguesa)" x "TRANCA SALAME BURGUESA"), não erro
// de digitação.
export function pontuar(a, b) {
  const ta = tokens(a); const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta); const sb = new Set(tb);
  let comuns = 0;
  for (const t of sa) if (sb.has(t)) comuns++;
  return (2 * comuns) / (sa.size + sb.size);
}

// QUEM PODE RECEBER PRODUÇÃO.
//
// `materiasPrimas` é "item com saldo", não o cardápio: farinha, detergente e
// bandeja de isopor moram na mesma coleção que os 281 produtos do Eclética (ver
// CLAUDE.md, "Item com saldo: cinco tipos, uma coleção"). Oferecer a coleção
// inteira fazia a busca de "Torta Banoffee" responder "bandeja retangular de
// isopor", "banana nanica", "bandana preta" — e, pior, a SUGESTÃO automática
// podia casar um produto de produção com um insumo COMPRADO. Ligado ali, a
// fornada entraria no saldo do que se compra: o insumo pareceria nunca acabar,
// a compra seguinte viria menor e só a contagem física denunciaria.
//
// São dois grupos legítimos, e os dois precisam estar aqui:
//   1. produto do cardápio do Eclética — tem `codigoEcletica`, e o código vale
//      mesmo sem marcação de tipo (produto importado sem marcar é o normal);
//   2. item feito na cozinha (`produzido`) — inclui os RECHEIOS, que não têm
//      código nenhum porque não são vendidos.
// `produzido` nunca vem de palpite por categoria (só de marcação explícita em
// tipoPadraoPorCategoria), então isto não abre a porta pro insumo comprado.
export function ehAlvoDeProducao(mp, tipoInsumo = {}) {
  if (!mp || !mp.nome) return false;
  if (String(mp.codigoEcletica || '').trim()) return true;
  return tipoDoInsumo(tipoInsumo || {}, mp).tipo === 'produzido';
}

export function candidatosDeVinculo(materiasPrimas = [], tipoInsumo = {}) {
  return (materiasPrimas || []).filter((m) => ehAlvoDeProducao(m, tipoInsumo));
}

// Sugere o item de estoque para um nome de produção.
//
// ⚠️ `seguro` é o que o botão "aplicar as sugestões seguras" usa, e por isso é
// deliberadamente duro: só quando o par é muito parecido E o segundo colocado
// fica claramente atrás. "Trança de calabresa" e "Trança de camarão" pontuam
// alto contra "TRANCA CALABRESA" — sem a margem, o lote ligaria o camarão na
// calabresa e ninguém veria.
export function sugerirVinculo(nome, materiasPrimas, opcoes = {}) {
  const { minimo = 0.6, seguroMin = 0.85, margem = 0.15, excluirIds = [] } = opcoes;
  const fora = new Set(excluirIds);
  const candidatos = (materiasPrimas || [])
    .filter((m) => m && m.nome && !fora.has(m.id))
    .map((m) => ({ mp: m, score: pontuar(nome, m.nome) }))
    .filter((c) => c.score >= minimo)
    .sort((a, b) => b.score - a.score);
  if (!candidatos.length) return null;
  const [primeiro, segundo] = candidatos;
  const seguro = primeiro.score >= seguroMin && (!segundo || primeiro.score - segundo.score >= margem);
  return { mp: primeiro.mp, score: primeiro.score, seguro, alternativas: candidatos.slice(1, 5).map((c) => c.mp) };
}

// Resolve o item de estoque de um nome vindo do pedido/catálogo de produção.
// Ordem: vínculo explícito no catálogo → nome igual → nada. Nunca chuta pela
// semelhança: palpite entra na TELA como sugestão, jamais numa baixa de saldo.
export function itemDeEstoqueDaProducao(nome, { produtosProducao = [], materiasPrimas = [] } = {}) {
  const k = normalizarNome(nome);
  if (!k) return null;
  const doCatalogo = produtosProducao.find((p) => p && p.mpId && normalizarNome(p.nome) === k);
  if (doCatalogo) {
    const mp = materiasPrimas.find((m) => m.id === doCatalogo.mpId);
    if (mp) return { mp, origem: 'vinculo' };
  }
  const porNome = materiasPrimas.find((m) => m && m.nome && normalizarNome(m.nome) === k);
  return porNome ? { mp: porNome, origem: 'nome' } : null;
}

// RECHEIO: item feito na cozinha que não é vendido — entra como insumo da
// ficha de outro produto (o frango cremoso do croissant). Continua sendo do
// tipo `produzido` (é feito e tem saldo próprio); "recheio" é só o PAPEL que
// ele cumpre, não um sexto tipo de item — ver CLAUDE.md, "Item com saldo:
// cinco tipos, uma coleção".
//
// Reconhecido de duas formas, nessa ordem:
//   1. marcado no catálogo de produção (`recheio: true`) — é a declaração do
//      dono, e vale ANTES de existir ficha alguma usando o item;
//   2. derivado das fichas: alguma ficha lista este item como insumo.
//
// Só o 2 existia, e por isso um recheio recém-criado ficava sem identidade
// até alguém escrever a ficha que o consome.
export function fichasQueUsam(mp, fichasTecnicas = []) {
  if (!mp) return [];
  const k = normalizarNome(mp.nome);
  return (fichasTecnicas || []).filter((f) => (f?.insumos || []).some((i) => (
    (i.mpId && i.mpId === mp.id) || (!i.mpId && normalizarNome(i.nome) === k)
  )));
}

export function ehRecheio(nome, { produtosProducao = [], fichasTecnicas = [], mp = null } = {}) {
  const k = normalizarNome(nome);
  const doCatalogo = (produtosProducao || []).find((p) => p && normalizarNome(p.nome) === k);
  if (doCatalogo?.recheio) return true;
  return fichasQueUsam(mp, fichasTecnicas).length > 0;
}

// Nomes de produção que apontam para um item de estoque — os APELIDOS que o
// fechamento do pedido precisa conhecer. Produzir "SALG COXINHA" tem que fechar
// o pedido de "Coxinha de frango", senão o vínculo conserta a tela e deixa o
// pedido aberto para sempre.
export function apelidosDoItem(mpId, produtosProducao = []) {
  return (produtosProducao || [])
    .filter((p) => p && p.mpId === mpId && p.nome)
    .map((p) => p.nome);
}
