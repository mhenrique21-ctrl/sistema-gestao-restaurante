import { mergeListaCompras } from './mergeListaCompras.js';

// Campos do documento que são arrays de objetos com `id` — union por id,
// com desempate por timestamp (updatedAt/atualizadoEm) quando presente dos
// dois lados. listaCompras e pedidosLista NÃO entram aqui: já são resolvidos
// por mergeListaCompras, que tem a semântica extra de listaAtualId/
// listaAtualAbertaEm (qual lista está "aberta" agora).
export const MERGEABLE_FIELDS = [
  'contas', 'vendas', 'compras', 'fornecedores', 'fichasTecnicas',
  'materiasPrimas', 'funcionarios', 'faltas', 'adiantamentos',
  'consumacoes', 'encargos', 'normalizacoes', 'movEstoque', 'usuarios',
  'produtosProducao', 'pedidosProducao', 'encomendas', 'anotacoes',
  'clientesEncomenda', 'produtosLista', 'itensProducaoPendentes',
];

const TS_FIELDS = ['updatedAt', 'atualizadoEm'];

function itemTimestamp(item) {
  for (const f of TS_FIELDS) {
    const v = item?.[f];
    if (v) {
      const t = typeof v === 'number' ? v : Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

// União por id: item só de um lado é mantido; item dos dois lados usa o
// timestamp mais recente pra decidir quem vence (updatedAt ou atualizadoEm,
// o que existir); sem timestamp em nenhum dos dois, o incoming vence (é o
// que o usuário acabou de mexer nesta requisição especificamente).
export function mergeArrayById(existingArr, incomingArr, deletedIds) {
  const existingMap = new Map((existingArr || []).map((i) => [i.id, i]));
  const incomingMap = new Map((incomingArr || []).map((i) => [i.id, i]));
  const allIds = new Set([...existingMap.keys(), ...incomingMap.keys()]);
  const merged = [];
  allIds.forEach((id) => {
    if (deletedIds.has(id)) return;
    const existing = existingMap.get(id);
    const incoming = incomingMap.get(id);
    if (incoming && !existing) { merged.push(incoming); return; }
    if (existing && !incoming) { merged.push(existing); return; }
    const et = itemTimestamp(existing);
    const it = itemTimestamp(incoming);
    if (et != null && it != null) { merged.push(it >= et ? incoming : existing); return; }
    // Só um lado carimbou timestamp: esse lado vence — um write carimbado é
    // sempre mais confiável que um sem carimbo nenhum (que pode ser, por
    // exemplo, um documento inteiro reenviado de um POST de outra tela que
    // nem tocou nesse registro).
    if (et != null) { merged.push(existing); return; }
    if (it != null) { merged.push(incoming); return; }
    // Nenhum dos dois tem timestamp confiável — mantém o comportamento
    // anterior (incoming vence), sem regressão pros campos que ainda não
    // carimbam updatedAt/atualizadoEm em todo write.
    merged.push(incoming);
  });
  return merged;
}

// Fusão do documento inteiro — chamada em POST /api/dados/:empresa antes de
// persistir. Sem isso, dois dispositivos escrevendo perto um do outro faziam
// o último POST sobrescrever o arquivo inteiro, apagando silenciosamente
// qualquer mudança (marcar conta como paga, editar um funcionário etc.) que
// o outro lado já tinha salvo um instante antes.
export function mergeDocument(existing, incoming) {
  if (!existing) return incoming;

  // Lista de Compras primeiro (mantém a semântica própria já testada).
  const afterLista = mergeListaCompras(existing, incoming);

  // deletedIds genérico: união de tudo que qualquer dispositivo já excluiu,
  // de qualquer entidade (o cliente manda o snapshot completo do seu
  // _listaDeletados local em todo POST — ver withDeletedIds em App.tsx).
  const deletedIds = new Set([...(existing.deletedIds || []), ...(incoming.deletedIds || [])]);

  const merged = { ...afterLista, deletedIds: [...deletedIds].slice(-5000) };
  for (const field of MERGEABLE_FIELDS) {
    merged[field] = mergeArrayById(existing[field], afterLista[field], deletedIds);
  }
  return merged;
}
