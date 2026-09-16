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

// Nomes de produção que apontam para um item de estoque — os APELIDOS que o
// fechamento do pedido precisa conhecer. Produzir "SALG COXINHA" tem que fechar
// o pedido de "Coxinha de frango", senão o vínculo conserta a tela e deixa o
// pedido aberto para sempre.
export function apelidosDoItem(mpId, produtosProducao = []) {
  return (produtosProducao || [])
    .filter((p) => p && p.mpId === mpId && p.nome)
    .map((p) => p.nome);
}
