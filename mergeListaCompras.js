// Fusão da Lista de Compras no servidor — usada em POST /api/dados/:empresa
// (new_server.js). Só mexe nos campos da lista; todo o resto do documento
// (vendas, contas, funcionários...) continua vindo direto do cliente.
//
// Existe porque o POST fazia fs.writeFileSync bruto (sobrescreve o arquivo
// inteiro), o que perdia mudanças silenciosamente quando dois dispositivos
// escreviam perto um do outro. Ver commit "fix: fusão da Lista de Compras
// no servidor" pro contexto completo.
export function mergeListaCompras(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...incoming };

  // A lista aberta mais recentemente vence a identidade atual — evita que
  // um dispositivo atrasado "ressuscite" uma lista já fechada por outro.
  const existingAbertaEm = existing.listaAtualAbertaEm ? Date.parse(existing.listaAtualAbertaEm) : 0;
  const incomingAbertaEm = incoming.listaAtualAbertaEm ? Date.parse(incoming.listaAtualAbertaEm) : 0;
  if (existingAbertaEm > incomingAbertaEm) {
    merged.listaAtualId = existing.listaAtualId;
    merged.listaAtualAbertaEm = existing.listaAtualAbertaEm;
  }

  // União dos ids excluídos/arquivados — uma exclusão já registrada por
  // qualquer lado nunca "volta" por causa do outro lado não saber dela ainda.
  const deletedIds = new Set([...(existing.listaDeletedIds || []), ...(incoming.listaDeletedIds || [])]);
  merged.listaDeletedIds = [...deletedIds].slice(-5000);

  // Por item: quem tem updatedAt mais recente vence (mesma regra do
  // mergeFromServer no cliente, só que aplicada contra o arquivo real).
  const localMap = new Map((incoming.listaCompras || []).map((i) => [i.id, i]));
  const serverMap = new Map((existing.listaCompras || []).map((i) => [i.id, i]));
  const allIds = new Set([...localMap.keys(), ...serverMap.keys()]);
  const mergedLista = [];
  allIds.forEach((id) => {
    if (deletedIds.has(id)) return;
    const local = localMap.get(id);
    const server = serverMap.get(id);
    if (local && !server) { mergedLista.push(local); return; }
    if (server && !local) { mergedLista.push(server); return; }
    const lt = local.updatedAt || 0;
    const st = server.updatedAt || 0;
    mergedLista.push(st > lt ? server : local);
  });
  merged.listaCompras = mergedLista;

  // Arquivamentos (pedidosLista): união por id, mas com os ITENS fundidos
  // dentro do pedido.
  //
  // ⚠️ Antes bastava `map.set(p.id, p)` porque o pedido só nascia inteiro, no
  // fechamento da lista. Agora que marcar como comprado APAGA o item e o move
  // pro pedido da lista aberta, o mesmo pedido é escrito muitas vezes, por
  // aparelhos diferentes: substituir em bloco faria o operador que marcou o
  // leite perder o café que o outro marcou meio segundo antes — sem erro, sem
  // log, e só apareceria no arquivo do dia seguinte.
  const pedidosMap = new Map((existing.pedidosLista || []).map((p) => [p.id, p]));
  (incoming.pedidosLista || []).forEach((p) => {
    const anterior = pedidosMap.get(p.id);
    pedidosMap.set(p.id, anterior ? fundirPedido(anterior, p) : p);
  });
  merged.pedidosLista = [...pedidosMap.values()];

  return merged;
}

// Funde dois pedidos de MESMO id. Os campos escalares vêm do incoming (é a
// gravação mais nova), menos `fechadoEm`: fechamento já registrado por um lado
// nunca é desfeito pelo outro. Os itens são unidos por id — é pra isso que o
// item arquivado preserva o id que tinha na lista.
function fundirPedido(a, b) {
  const itens = new Map((a.itens || []).map((i) => [i.id ?? i.nome, i]));
  (b.itens || []).forEach((i) => itens.set(i.id ?? i.nome, i));
  return { ...a, ...b, itens: [...itens.values()], fechadoEm: b.fechadoEm || a.fechadoEm };
}
