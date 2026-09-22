// O id do registro que a ponte de PDV grava por dia.
// ============================================================================
// Mora fora do `new_server.js` porque é a decisão que erra em SILÊNCIO: o POST
// responde 200, o log diz "criado", o agente na loja mostra ✅ — e a linha
// desaparece do app segundos depois, todo dia, para sempre.
//
// ⚠️ O BUG QUE ISTO CONSERTA: "as vendas do Eclética não sobem, mas o agente
// está funcionando normalmente".
//
// O id do registro do dia era DETERMINÍSTICO (`pdv-ecletica-confraria-<data>`),
// e é isso que torna reenviar idempotente. Só que o app tem uma lixeira em
// Vendas → Histórico que apaga QUALQUER linha, a do PDV inclusive, e apagar
// grava o id no tombstone (`deletedIds`/`_listaDeletados`) — que é permanente,
// é unido no servidor e volta no POST de todo aparelho, de todo poll.
//
// A partir daí:
//
//   1. o agente manda o dia; o endpoint não acha a linha (o app já a removeu)
//      e a RECRIA com o mesmo id determinístico — que é justamente o id morto;
//   2. o POST responde 200 e o agente marca o dia como enviado;
//   3. o primeiro POST de qualquer aparelho funde o documento, `mergeArrayById`
//      pula todo id que está em `deletedIds`, e a linha some de novo;
//   4. repete para sempre. Como o id é por DIA, quebra só os dias cuja linha
//      alguém apagou uma vez — daí o sintoma ser "ÀS VEZES não sobe".
//
// O `App.tsx` já escrevia a regra que faltava aqui (§ "AO ADICIONAR UM CAMPO
// NOVO EM db", item 5): *o tombstone não pode ressuscitar nem ENGOLIR O NOVO*.
// Ele engolia o novo.
//
// ⚠️ A saída NÃO é limpar o tombstone. Isso desfaria a exclusão que a pessoa
// fez — e como o mesmo id volta a ser gravado, os dois lados ficariam brigando
// pela mesma linha a cada ciclo. O que entra é um id NOVO: a linha antiga
// continua apagada, e o fato novo que o caixa acabou de mandar passa.
//
// ⚠️ E o id novo só é cunhado UMA vez. Cunhar a cada envio criaria uma linha
// por ciclo — o dia viraria dezenas de registros, e o faturamento com ele.

const comoSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));

// O id estável de um dia: é ele que faz reenviar o mesmo dia ATUALIZAR a linha
// em vez de somar outra.
export const idPadraoDoDia = (prefixo, empresa, data) =>
  `${String(prefixo || '')}-${String(empresa || '').toLowerCase()}-${data}`;

// Decide com que id gravar o registro do dia.
//
//   idExistente  o id que o arquivo já usa para este dia+origem, se houver
//   deletados    o tombstone do documento (`deletedIds`)
//   marca        sufixo do id novo — quem chama passa algo que muda
//                (Date.now().toString(36)); recebido de fora para o teste não
//                depender do relógio
export function idDoRegistroPdv({ prefixo, empresa, data, idExistente, deletados, marca }) {
  const mortos = comoSet(deletados);
  const base = idPadraoDoDia(prefixo, empresa, data);

  // Linha viva já gravada: continua com o id dela. Este é o caminho normal,
  // e é o que mantém o reenvio idempotente.
  if (idExistente && !mortos.has(idExistente)) return { id: idExistente, renasceu: false };

  // Dia novo (ou linha removida) cujo id padrão está limpo: o de sempre.
  if (!mortos.has(base)) return { id: base, renasceu: false };

  // O id que usaríamos está no tombstone: a linha foi apagada no app e este
  // envio seria engolido pela fusão. Entra um id novo.
  return { id: `${base}-r${marca}`, renasceu: true };
}
