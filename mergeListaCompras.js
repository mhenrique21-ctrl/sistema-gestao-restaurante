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

  // Arquivamentos (pedidosLista) são só acrescentados, nunca editados —
  // união por id é suficiente e nunca perde um fechamento de lista.
  const pedidosMap = new Map((existing.pedidosLista || []).map((p) => [p.id, p]));
  (incoming.pedidosLista || []).forEach((p) => pedidosMap.set(p.id, p));
  merged.pedidosLista = [...pedidosMap.values()];

  return merged;
}
