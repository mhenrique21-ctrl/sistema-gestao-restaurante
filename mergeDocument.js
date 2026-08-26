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
  'clientesEncomenda', 'produtosLista', 'itensProducaoPendentes', 'recibosVenda',
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
// Para vendas (lançamentos): também verifica por data — dois itens com a mesma
// data E a mesma origem devem ser tratados como a mesma entidade, mesmo que
// tenham IDs diferentes (isso acontece quando dois dispositivos criam entrada
// pra o mesmo dia antes de sincronizar). A origem entra na chave porque uma
// venda digitada à mão e uma venda sincronizada do PDV (origem:"pdv") para o
// MESMO dia são dois registros que devem coexistir, não duplicatas — chavear
// só por data colapsava os dois em um só (normalmente o do PDV, que
// resincroniza a cada minuto e quase sempre tem o carimbo mais recente),
// apagando silenciosamente o lançamento manual do usuário a cada "Salvar
// Vendas" sempre que havia uma venda de PDV no mesmo dia.
export function mergeArrayById(existingArr, incomingArr, deletedIds, isVendas = false) {
  const existingMap = new Map((existingArr || []).map((i) => [i.id, i]));
  const incomingMap = new Map((incomingArr || []).map((i) => [i.id, i]));
  const allIds = new Set([...existingMap.keys(), ...incomingMap.keys()]);

  // Para vendas, também rastreia por data+origem pra deduplicar entradas do
  // mesmo dia E mesma origem, sem misturar manual com pdv.
  //
  // Bug real (relatado como "os valores da Confraria ficam oscilando se eu
  // mexer em qualquer coisa"): o existingArr.forEach abaixo fazia
  // vendasByDate.set(chave, ...) incondicionalmente pra CADA item — se o
  // próprio existingArr (ou o próprio incomingArr) já tivesse mais de um
  // registro de duplicata pra mesma chave (lixo deixado por versões
  // anteriores do bug de "salvar duplica"), só o ÚLTIMO da ordem de
  // iteração sobrevivia, sem comparar timestamp nenhum — e a comparação
  // cruzada (existing vs incoming) só rodava depois, sobre esse sobrevivente
  // arbitrário. Como esse merge roda de novo a cada POST/poll (inclusive os
  // disparados por telas que nem mexem em vendas), e a ORDEM dos itens no
  // array podia variar entre chamadas, o vencedor — e portanto o total
  // somado depois — podia mudar a cada sincronização: oscilando na tela sem
  // o usuário ter tocado em Vendas. Corrigido comparando timestamp em TODA
  // inserção (dentro do mesmo lado também, não só entre lados), então o
  // resultado só depende de quem tem o carimbo mais recente — nunca da
  // ordem de iteração.
  const vendasByDate = new Map();
  if (isVendas) {
    const chave = (v) => `${v.data}::${v.origem || 'manual'}`;
    const considerar = (v, source) => {
      if (!v || !v.id || deletedIds.has(v.id) || !v.data) return;
      const k = chave(v);
      const atual = vendasByDate.get(k);
      if (!atual) { vendasByDate.set(k, { item: v, source }); return; }
      const et = itemTimestamp(atual.item);
      const it = itemTimestamp(v);
      // Sem carimbo em nenhum dos dois: mantém quem já estava (não troca só
      // por causa da ordem de iteração).
      const vence = (et != null && it != null) ? (it >= et) : (it != null);
      if (vence) vendasByDate.set(k, { item: v, source });
    };
    (existingArr || []).forEach((v) => considerar(v, 'existing'));
    (incomingArr || []).forEach((v) => considerar(v, 'incoming'));
  }

  const merged = [];

  // Se é vendas, usa a deduplicação por data
  if (isVendas && vendasByDate.size > 0) {
    vendasByDate.forEach((entry) => {
      if (!deletedIds.has(entry.item.id)) {
        merged.push(entry.item);
      }
    });
    return merged;
  }

  // Lógica padrão por ID para outros tipos
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
    merged[field] = mergeArrayById(existing[field], afterLista[field], deletedIds, field === 'vendas');
  }
  return merged;
}
