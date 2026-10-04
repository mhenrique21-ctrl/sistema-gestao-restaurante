// A identidade da lista que SUCEDE uma lista arquivada.
// ============================================================================
// Mora fora do App.tsx porque o erro aqui é INVISÍVEL: o item sobe para o
// servidor, funde certo, chega em todo aparelho — e some da TELA, filtrado por
// `i.listaId===listaAtualId`. Quem inseriu jura que inseriu; os outros juram
// que não chegou nada; e os dois estão certos.
//
// O QUE ACONTECIA (relatado como "insiro na lista e não atualiza para os
// outros, quando a lista anterior ainda não foi fechada"):
//
//   1. marcado o último pendente, TODO aparelho com a lista aberta começa a
//      contagem de 10 s do fechamento automático
//   2. eles disparam praticamente juntos, e cada um fazia
//      `listaAtualId: uid()` — um id DIFERENTE por aparelho, cada um com o
//      próprio `abertaEm`
//   3. a fusão fica com o `abertaEm` estritamente MAIOR, ou seja, com o id do
//      ÚLTIMO aparelho a arquivar
//   4. todo item inserido nesse meio, nos aparelhos que perderam, nasceu com o
//      `listaId` do id perdedor — e passa a ser ÓRFÃO: está no banco, está em
//      todos os aparelhos, e não aparece em nenhum
//
// ⚠️ E o órfão não avisa nada: `recuperarOrfaos` é manual e só do admin.
//
// O id do PEDIDO do arquivo já era determinístico (`arq-<listaAtualId>`) por
// esse exato motivo — "com uid() cada um criaria um registro próprio e o
// Arquivo mostraria a mesma compra três vezes". A lição não tinha sido
// aplicada ao id da lista NOVA, onde ela custa mais caro.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv32(texto, semente) {
  let h = semente >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

// Id de fallback de quem ainda não tem lista nenhuma.
//
// ⚠️ CONSTANTE, não `uid()`. O carimbo desse fallback é a época ZERO de
// propósito (para nunca vencer um fechamento de verdade), e com empate a fusão
// fica com o lado do SERVIDOR — então o aparelho que inventou um id próprio
// perde, e os itens que ele carimbou com esse id nascem órfãos. Sendo a mesma
// constante em todo lugar, não há o que perder.
export const ID_LISTA_INICIAL = 'lista-inicial';

// ⚠️ DETERMINÍSTICO E DE TAMANHO FIXO. Derivar por concatenação ("pos-"+id)
// também seria determinístico, mas cresce a cada fechamento — uma lista por dia
// vira um id de milhares de caracteres em poucos anos, dentro de todo item.
export function proximaListaId(atual) {
  const base = String(atual ?? '').trim();
  if (!base) return ID_LISTA_INICIAL;
  const a = fnv32(base, FNV_OFFSET).toString(36).padStart(7, '0');
  const b = fnv32(`${base}|2`, FNV_OFFSET).toString(36).padStart(7, '0');
  return `l${a}${b}`;
}
