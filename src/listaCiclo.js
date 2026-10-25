// O dia operacional da Lista de Compras: das 12h de um dia ABERTO às 12h do
// próximo dia ABERTO.
// ============================================================================
// Decisão do dono (25/10/2026): a lista começa a ser alimentada às 18h e a
// compra é feita de manhã. O item lançado em segunda às 18h30 é da "Compra de
// terça"; às 12h a lista aberta vai para o Arquivo e abre uma nova.
//
// E, ainda do dono, no mesmo dia: DOMINGO A LOJA NÃO ABRE e não existe corte
// no domingo. A lista que começa sábado 12h vai até SEGUNDA 12h e se chama
// "compra de segunda" — item de sábado à tarde e de domingo inteiro é dela.
// FERIADO (LISTA_FERIADOS no .env) segue a mesma lógica: não tem corte, e a
// compra passa para o próximo dia aberto.
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
export const DIAS_FECHADOS_PADRAO = [0];   // 0 = domingo
const DIA_MS = 24 * 3600 * 1000;
// Teto do "anda até achar um dia aberto": um .env que feche meses seguidos não
// pode travar o servidor na subida nem a tela num laço.
const MAX_PULOS = 400;
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const p2 = (n) => String(n).padStart(2, '0');

function emMs(x) {
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  if (typeof x === 'string' && x) return Date.parse(x);
  return NaN;
}

// O relógio de parede de Belém, lido pelos getters UTC.
function relogio(t) { return new Date(t + FUSO_MIN * 60000); }

// Dias civis em `AAAA-MM-DD`, aritmética pelo UTC (sem fuso, sem horário de verão).
function isoDe(y, m, d) { return `${y}-${p2(m)}-${p2(d)}`; }
function partes(iso) { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; }
function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const { y, m, d } = partes(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function somaDias(iso, n) {
  const { y, m, d } = partes(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return isoDe(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function diaDaSemana(iso) { const { y, m, d } = partes(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
// O instante (ms) de `hora`h em Belém no dia `iso`.
function instanteEmBelem(iso, hora) { const { y, m, d } = partes(iso); return Date.UTC(y, m - 1, d, hora) - FUSO_MIN * 60000; }

// ── A configuração do .env ──────────────────────────────────────────────────
// LISTA_DIAS_FECHADOS="0"            (0=domingo … 6=sábado; padrão: domingo)
// LISTA_FERIADOS="2026-12-25,2027-01-01"
//
// ⚠️ CONFIGURAÇÃO INVÁLIDA NÃO DERRUBA NADA — cai no padrão e AVISA. Fechar os
// sete dias não é uma loja sem compra: é um laço infinito. Falhar fechado aqui
// bricaria o servidor por causa de uma vírgula no `.env` (lição do
// `APP_SESSION_SECRET`, §10.1). Feriado fora do formato é descartado sozinho,
// sem levar os outros junto.
export function configDoCiclo(env = {}, avisar = console.warn) {
  const crus = String(env?.LISTA_DIAS_FECHADOS ?? '').trim();
  let fechados = crus === ''
    ? [...DIAS_FECHADOS_PADRAO]
    : [...new Set(crus.split(/[,;\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  if (crus !== '' && !fechados.length) {
    avisar(`[listaCiclo] LISTA_DIAS_FECHADOS="${crus}" não tem nenhum dia válido (0=domingo … 6=sábado). Usando o padrão: domingo.`);
    fechados = [...DIAS_FECHADOS_PADRAO];
  }
  if (fechados.length >= 7) {
    avisar(`[listaCiclo] LISTA_DIAS_FECHADOS="${crus}" fecha a semana INTEIRA — não haveria dia de compra nenhum. Usando o padrão: domingo.`);
    fechados = [...DIAS_FECHADOS_PADRAO];
  }
  const brutos = String(env?.LISTA_FERIADOS ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const feriados = new Set(brutos.filter(dataValida));
  const descartados = brutos.filter((x) => !dataValida(x));
  if (descartados.length) {
    avisar(`[listaCiclo] LISTA_FERIADOS ignorou ${descartados.length} valor(es) fora do formato AAAA-MM-DD: ${descartados.join(', ')}`);
  }
  return { diasFechados: new Set(fechados), feriados, horaCorte: HORA_CORTE };
}

// O padrão (só domingo fechado) é o que a TELA usa: o .env mora no servidor.
const PADRAO = configDoCiclo({}, () => {});

export function ehDiaFechado(iso, cfg = PADRAO) {
  const c = cfg || PADRAO;
  return c.diasFechados.has(diaDaSemana(iso)) || c.feriados.has(iso);
}

// Anda a partir de `iso` (inclusive) até um dia aberto, no sentido `passo`.
function diaAberto(iso, passo, cfg) {
  let dia = iso;
  for (let i = 0; ehDiaFechado(dia, cfg); i++) {
    if (i >= MAX_PULOS) break;
    dia = somaDias(dia, passo);
  }
  return dia;
}

// ── De que dia é a compra ───────────────────────────────────────────────────
// "2026-10-26" — a compra a que um item lançado neste instante pertence.
// ⚠️ 12h00 em ponto já é do dia SEGUINTE: é o instante do corte. E depois
// disso anda até achar um dia ABERTO — é o que faz sábado 12h virar a compra
// de segunda em vez de "compra de domingo".
export function diaDaCompra(dataHora, cfg = PADRAO) {
  const t = emMs(dataHora);
  if (!Number.isFinite(t)) return '';
  const r = relogio(t);
  let dia = isoDe(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate());
  if (r.getUTCHours() >= (cfg?.horaCorte ?? HORA_CORTE)) dia = somaDias(dia, 1);
  return diaAberto(dia, +1, cfg);
}

// "Compra de segunda · 26/10" — o dia da semana é como a loja fala; a data
// desempata duas segundas no Arquivo.
export function nomeDaCompra(dia) {
  if (!dataValida(dia)) return 'Compra';
  const { m, d } = partes(dia);
  return `Compra de ${NOMES_DIA[diaDaSemana(dia)]} · ${p2(d)}/${p2(m)}`;
}

// O corte mais recente que já passou (ou é agora), em ms: o último meio-dia de
// um dia ABERTO. Em domingo e feriado não há corte — por isso o laço anda para
// trás até um dia aberto, e é isso que estica o ciclo de sábado até segunda.
export function ultimoCorte(agora = Date.now(), cfg = PADRAO) {
  const t = emMs(agora);
  const r = relogio(t);
  let dia = isoDe(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate());
  if (r.getUTCHours() < (cfg?.horaCorte ?? HORA_CORTE)) dia = somaDias(dia, -1);
  dia = diaAberto(dia, -1, cfg);
  return instanteEmBelem(dia, cfg?.horaCorte ?? HORA_CORTE);
}

// O próximo corte, estritamente depois de `agora` — e ele é, por construção,
// o meio-dia do DIA DA COMPRA. As duas coisas saem da mesma conta de
// propósito: fossem duas, um dia a tela diria "compra de segunda" com o
// servidor cortando na terça.
export function proximoCorte(agora = Date.now(), cfg = PADRAO) {
  return instanteEmBelem(diaDaCompra(agora, cfg), cfg?.horaCorte ?? HORA_CORTE);
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
//
// ⚠️ A LISTA NOVA NASCE COM NOME ("Compra de segunda · 26/10"), no cadastro
// `listasCompra`: é o nome que fica no alto da tela de todo mundo. Sem ele a
// lista apareceria como "26/10 · 12:00", e "compra de segunda" é como o dono
// pediu que ela se chamasse. Uma lista batizada à mão não é tocada.
export function virarListaNoCorte(doc, agora = Date.now(), cfg = PADRAO) {
  if (!doc || typeof doc !== 'object') return null;
  const corte = ultimoCorte(agora, cfg);
  const atual = doc.listaAtualId;
  if (!atual) return null;
  const daAberta = (i) => !i?.listaId || i.listaId === atual;
  const lista = Array.isArray(doc.listaCompras) ? doc.listaCompras : [];
  const sair = lista.filter((i) => daAberta(i) && criadoAntes(i, corte));
  if (!sair.length) return null;

  // A compra que fechou: a dos itens de ANTES do corte (sábado 12h fecha a de
  // sábado; segunda 12h fecha a de segunda, que começou sábado 12h).
  const dia = diaDaCompra(corte - 1, cfg);
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
  // A compra que ABRE agora: a do próximo corte.
  const novoNome = nomeDaCompra(diaDaCompra(agora, cfg));
  const listasCompra = (doc.listasCompra || []).filter((l) => l?.id !== atual && l?.id !== novaId);
  listasCompra.push({ id: novaId, nome: novoNome, criadaPor: '', criadaEm: quando, updatedAt: ts });
  const novoDoc = {
    ...doc,
    pedidosLista: [pedido, ...(doc.pedidosLista || []).filter((p) => p?.id !== pedido.id)],
    listaCompras,
    listasCompra,
    listaDeletedIds: [...new Set([...(doc.listaDeletedIds || []), ...idsSair])],
    // O cadastro sai com tombstone, como no `arquivarLista` da tela: senão um
    // aparelho que ainda o tem devolve a lista arquivada para o trocador.
    deletedIds: [...new Set([...(doc.deletedIds || []), atual])],
    listaAtualId: novaId,
    listaAtualAbertaEm: quando,
  };
  return { doc: novoDoc, pedido, arquivados: sair.length, movidos, novaId, novoNome };
}
