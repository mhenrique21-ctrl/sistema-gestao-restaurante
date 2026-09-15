// A decisão do auto-save genérico: salvar, reagendar ou ignorar.
// ============================================================================
// Mora fora do App.tsx porque foi aqui que a mudança sumia — e sumia CALADA.
//
// O QUE ACONTECIA (relatado como "os operadores inserem produtos na lista e
// não atualiza pros outros", recorrente):
//
//   1. o operador faz algo com setDbAndSave — que liga `directSaveRef` por até
//      5 segundos enquanto busca o servidor, funde e posta
//   2. dentro dessa janela ele faz outra coisa, dessas que usam setDb puro
//      (reordenar, excluir, marcar comprado, renomear categoria, retomar lista)
//   3. o efeito de auto-save via `directSaveRef` ligado e fazia:
//          if (directSaveRef.current) { prevState.current = state; return; }
//
// O `return` sozinho seria só um atraso. O problema é o `prevState = state`:
// ele marca a mudança como JÁ PROCESSADA. No ciclo seguinte a comparação
// `state !== prevState` não vê diferença nenhuma, `changed` vem vazio, e o
// POST nunca acontece. Não é "pula e salva depois" — é "pula e ESQUECE".
//
// O resultado é cada aparelho acumulando a própria pilha de mudança fantasma:
// visível na tela de quem fez, ausente em todo o resto. E quanto mais rápido o
// operador trabalha, maior a chance — daí ser recorrente justo na Lista de
// Compras, onde se adiciona um item e logo em seguida se reordena outro.
//
// ⚠️ A REGRA: enquanto o save direto estiver em andamento, NÃO se toca em
// `prevState`. A diferença precisa continuar visível pra ser salva depois.

export const ATRASO_REAGENDAR = 400;

// `motivo` existe pra tela e pro teste dizerem a mesma coisa sobre o porquê.
export function decidirAutoSave({ primeiroRender, veioDoPoll, saveDiretoEmAndamento, mudou }) {
  // Primeiro render e eco do poll: sincronizam o prevState sem salvar. Não há
  // mudança do usuário pra perder — o dado veio de fora.
  if (primeiroRender) return { acao: 'ignorar', atualizarPrev: true, motivo: 'primeiro render' };
  if (veioDoPoll) return { acao: 'ignorar', atualizarPrev: true, motivo: 'eco do poll' };

  // O caso do bug. `atualizarPrev: false` é a correção inteira.
  if (saveDiretoEmAndamento) {
    return { acao: 'reagendar', atualizarPrev: false, atrasoMs: ATRASO_REAGENDAR,
      motivo: 'save direto em andamento — a mudança fica pendente, não é descartada' };
  }

  if (!mudou) return { acao: 'ignorar', atualizarPrev: true, motivo: 'nada mudou' };
  return { acao: 'salvar', atualizarPrev: true, motivo: 'mudança do usuário' };
}

// Quais empresas mudaram desde o último ciclo salvo.
export function empresasComMudanca(state, prev, empresas = ['CONFRARIA', 'SEAMA']) {
  return empresas.filter((e) => state?.[e] !== prev?.[e]);
}
