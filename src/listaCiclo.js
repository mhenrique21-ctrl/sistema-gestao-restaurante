// O dia operacional da Lista de Compras: das 12h de um dia às 12h do seguinte.
// ============================================================================
// Decisão do dono (25/10/2026): a lista começa a ser alimentada às 18h e a
// compra é feita de manhã. O item lançado em 24/10 às 18h30 é da "Compra de
// 25/10"; às 12h a lista aberta vai para o Arquivo e abre uma nova.
//
// Mora fora do App.tsx porque roda nos DOIS lados: o servidor vira a lista no
// corte (um relógio só, não um por aparelho) e a tela separa os órfãos pelo
// mesmo dia. Duas contas do "de que compra é este item" divergiriam no dia em
// que uma mudasse.
//
// ⚠️ FUSO FIXO, não o do aparelho nem o do servidor. America/Belem é UTC−3 o
// ano inteiro (sem horário de verão). A VPS roda em UTC e o celular pode estar
// em qualquer fuso: `getHours()` daria o corte às 9h num e às 12h no outro.
import { proximaListaId } from './listaId.js';

export const FUSO_MIN = -180;
export const HORA_CORTE = 12;
const DIA_MS = 24 * 3600 * 1000;

function emMs(x) {
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  if (typeof x === 'string' && x) return Date.parse(x);
  return NaN;
}

// O relógio de parede de Belém, lido pelos getters UTC.
function relogio(t) { return new Date(t + FUSO_MIN * 60000); }

// "2026-10-25" — a compra a que um item lançado neste instante pertence.
// ⚠️ 12h00 em ponto já é do dia SEGUINTE: é o instante do corte.
export function diaDaCompra(dataHora) {
  const t = emMs(dataHora);
  if (!Number.isFinite(t)) return '';
  const r = relogio(t);
  if (r.getUTCHours() >= HORA_CORTE) r.setUTCDate(r.getUTCDate() + 1);
  return r.toISOString().slice(0, 10);
}

export function nomeDaCompra(dia) {
  const [, m, d] = String(dia || '').split('-');
  return d && m ? `Compra de ${d}/${m}` : 'Compra';
}

// O corte mais recente que já passou (ou é agora), em ms.
export function ultimoCorte(agora = Date.now()) {
  const t = emMs(agora);
  const r = relogio(t);
  let corte = Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate(), HORA_CORTE) - FUSO_MIN * 60000;
  if (corte > t) corte -= DIA_MS;
  return corte;
}

// O próximo corte, estritamente depois de `agora`.
export function proximoCorte(agora = Date.now()) {
  return ultimoCorte(agora) + DIA_MS;
}

// Item sem `criadoEm` é de antes de existir carimbo: conta como anterior a
// qualquer corte. Deixá-lo de fora prenderia o item na lista para sempre.
function criadoAntes(item, corte) {
  const t = emMs(item?.criadoEm);
  return !Number.isFinite(t) || t < corte;
}

// Vira a lista aberta no corte. Devolve `null` quando não há o que fazer —
// e é isso que torna o relógio do servidor idempotente: depois de virar, a
// lista aberta não tem mais item anterior ao corte.
//
// ⚠️ SÓ SAEM OS ITENS LANÇADOS ANTES DO CORTE. O que entrou depois das 12h é
// da compra de amanhã e passa para a lista nova — arquivá-lo junto enterraria
// no histórico o que a pessoa acabou de pedir.
//
// ⚠️ O pedido tem a MESMA forma do `arquivarLista` da tela, com o mesmo id
// determinístico (`arq-<listaId>`), e a lista nova nasce de `proximaListaId`.
// Se um aparelho fechar a mesma lista no mesmo minuto, os dois chegam no mesmo
// registro e na mesma lista — a fusão por id colapsa, não duplica.
export function virarListaNoCorte(doc, agora = Date.now()) {
  if (!doc || typeof doc !== 'object') return null;
  const corte = ultimoCorte(agora);
  const atual = doc.listaAtualId;
  if (!atual) return null;
  const daAberta = (i) => !i?.listaId || i.listaId === atual;
  const lista = Array.isArray(doc.listaCompras) ? doc.listaCompras : [];
  const sair = lista.filter((i) => daAberta(i) && criadoAntes(i, corte));
  if (!sair.length) return null;

  const dia = diaDaCompra(corte - 1);
  const novaId = proximaListaId(atual);
  const quando = new Date(emMs(agora)).toISOString();
  const cad = (doc.listasCompra || []).find((l) => l?.id === atual);
  const idsSair = new Set(sair.map((i) => i.id));
  const pedido = {
    id: 'arq-' + atual,
    listaId: atual,
    nome: cad?.nome || nomeDaCompra(dia),
    criadaPor: cad?.criadaPor || '',
    criadaEm: cad?.criadaEm || '',
    data: dia,
    automatico: true,
    itens: sair.map((i) => ({
      nome: i.nome, quantidade: i.quantidade, quantidadeComprada: i.quantidadeComprada ?? null,
      unidade: i.unidade, categoria: i.categoria || 'outros', obs: i.obs || '', urgente: !!i.urgente,
      estoqueQtd: i.estoqueQtd || '', estoqueUn: i.estoqueUn || 'un', comprado: !!i.comprado, naoTem: !!i.naoTem,
    })),
    criadoEm: quando,
  };
  const ts = emMs(agora);
  let movidos = 0;
  const listaCompras = lista
    .filter((i) => !idsSair.has(i.id))
    .map((i) => {
      if (!daAberta(i)) return i;
      movidos++;
      // ⚠️ Carimba: sem `updatedAt` novo a fusão devolveria o `listaId` velho
      // no POST seguinte de qualquer aparelho, e o item ficaria órfão.
      return { ...i, listaId: novaId, updatedAt: ts };
    });
  const novoDoc = {
    ...doc,
    pedidosLista: [pedido, ...(doc.pedidosLista || []).filter((p) => p?.id !== pedido.id)],
    listaCompras,
    listasCompra: (doc.listasCompra || []).filter((l) => l?.id !== atual),
    listaDeletedIds: [...new Set([...(doc.listaDeletedIds || []), ...idsSair])],
    // O cadastro sai com tombstone, como no `arquivarLista` da tela: senão um
    // aparelho que ainda o tem devolve a lista arquivada para o trocador.
    deletedIds: [...new Set([...(doc.deletedIds || []), atual])],
    listaAtualId: novaId,
    listaAtualAbertaEm: quando,
  };
  return { doc: novoDoc, pedido, arquivados: sair.length, movidos, novaId };
}
