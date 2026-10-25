// A compra do dia: para qual dia de compra vai o item inserido AGORA.
// ============================================================================
// Regra do dono (25/10/2026):
//
//   • O corte é ao MEIO-DIA. O que entra na lista depois das 12h já é da
//     compra do dia seguinte: a lista que começa segunda 12h vai até terça 12h
//     e se chama "compra de terça".
//   • DOMINGO A LOJA NÃO ABRE e não existe corte no domingo. A lista que começa
//     sábado 12h vai até SEGUNDA 12h e se chama "compra de segunda" — item de
//     sábado à tarde e de domingo (a qualquer hora) é da compra de segunda.
//   • FERIADO é tratado como domingo. A lista vem do `.env` do servidor
//     (`LISTA_FERIADOS=AAAA-MM-DD,AAAA-MM-DD,...`); o navegador recebe pela
//     rota `/api/feriados`.
//
// Mora fora do App.tsx porque o erro aqui é SILENCIOSO: o item sobe, funde e
// chega em todo aparelho — só que na lista errada, e ninguém o encontra na hora
// de comprar.
//
// ⚠️ TUDO EM HORA LOCAL (getHours/getDate), como `nomeAutomatico`: o Amapá é
// UTC−3 e às 21h o UTC já é o dia seguinte. `toISOString()` empurraria todo
// item da noite para a compra errada.

export const HORA_CORTE = 12;

const DIA_MS = 24 * 3600 * 1000;
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const p2 = (n) => String(n).padStart(2, '0');

// `AAAA-MM-DD` da data LOCAL de um Date.
export function isoLocal(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// Um Date ao meio-dia LOCAL de um `AAAA-MM-DD`. Meio-dia, não meia-noite:
// somar 24 h a partir da meia-noite atravessa mudança de horário de verão e
// cai no dia errado; a partir do meio-dia nunca.
function meioDia(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d, 12, 0, 0, 0);
}

function somaDias(iso, n) {
  const d = meioDia(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

// ── Os feriados do .env ─────────────────────────────────────────────────────
// `LISTA_FERIADOS=2026-11-02,2026-11-15, 2026-12-25`. Separador vírgula, ponto
// e vírgula ou espaço; o que não for uma data real é IGNORADO (não derruba o
// servidor nem a lista inteira por causa de um dígito errado — mas quem chama
// pode listar os rejeitados para avisar no log).
export function feriadosDoEnv(texto) {
  const aceitos = new Set();
  const rejeitados = [];
  for (const bruto of String(texto ?? '').split(/[,;\s]+/)) {
    const t = bruto.trim();
    if (!t) continue;
    if (dataValida(t)) aceitos.add(t);
    else rejeitados.push(t);
  }
  return { feriados: aceitos, rejeitados };
}

function dataValida(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const [a, m, d] = t.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(a, m - 1, d, 12);
  return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// A configuração pode vir de três jeitos e vira sempre `{ feriados, diasFechados }`:
//   • Set / array / string crua do .env → só feriados; fechado = domingo;
//   • o objeto de `GET /api/feriados` ({ feriados:[...], diasFechados:[0] }),
//     que é a MESMA config do timer do servidor (src/listaCiclo.js).
// `diasFechados` sem nada válido volta para domingo: nunca "nenhum dia
// fechado" por acidente de formato.
export const DIAS_FECHADOS_PADRAO = [0];
function normalizar(cfg) {
  if (cfg && typeof cfg === 'object' && !(cfg instanceof Set) && !Array.isArray(cfg) && ('feriados' in cfg || 'diasFechados' in cfg)) {
    const dias = [...new Set((Array.isArray(cfg.diasFechados) || cfg.diasFechados instanceof Set ? [...cfg.diasFechados] : [])
      .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
    return { feriados: comoSet(cfg.feriados), diasFechados: new Set(dias.length && dias.length < 7 ? dias : DIAS_FECHADOS_PADRAO) };
  }
  return { feriados: comoSet(cfg), diasFechados: new Set(DIAS_FECHADOS_PADRAO) };
}

function comoSet(feriados) {
  if (feriados instanceof Set) return feriados;
  if (Array.isArray(feriados)) return new Set(feriados);
  if (typeof feriados === 'string') return feriadosDoEnv(feriados).feriados;
  return new Set();
}

// Dia em que NÃO há compra: dia fechado da semana (padrão domingo) ou feriado.
export function diaFechado(iso, cfg = new Set()) {
  const c = normalizar(cfg);
  return c.diasFechados.has(meioDia(iso).getDay()) || c.feriados.has(iso);
}

// ── A regra ─────────────────────────────────────────────────────────────────
// Para qual dia de compra vai o que é inserido em `quando`:
//   antes das 12h → a compra de HOJE; a partir das 12h → a de AMANHÃ;
//   e se esse dia for fechado (domingo/feriado), o próximo dia aberto.
export function diaDaCompra(quando = new Date(), feriados = new Set()) {
  const d = quando instanceof Date ? quando : new Date(quando);
  let dia = isoLocal(d);
  if (d.getHours() >= HORA_CORTE) dia = somaDias(dia, 1);
  const cfg = normalizar(feriados);
  // Limite de segurança: um .env que marcasse o ano inteiro como feriado não
  // pode travar a tela num laço infinito.
  for (let i = 0; i < 60 && diaFechado(dia, cfg); i++) dia = somaDias(dia, 1);
  return dia;
}

// Quando a lista desse dia ABRE (o corte anterior): 12h do último dia aberto
// antes dele. Sábado 12h para a compra de segunda; sexta 12h para a de sábado.
export function inicioDaCompra(dia, feriados = new Set()) {
  const cfg = normalizar(feriados);
  let ant = somaDias(dia, -1);
  for (let i = 0; i < 60 && diaFechado(ant, cfg); i++) ant = somaDias(ant, -1);
  return `${ant}T${p2(HORA_CORTE)}:00`;
}

// ── Identidade e nome da lista do dia ───────────────────────────────────────
// ⚠️ ID DETERMINÍSTICO, derivado do dia. É a lição de `src/listaId.js`: no
// instante da virada todo aparelho decide sozinho; com `uid()` cada um abriria
// a própria "compra de segunda" e o item de um sumiria da tela dos outros.
export const PREFIXO_ID = 'compra-';

// ⚠️ O MESMO DIA PODE PRECISAR DE UMA SEGUNDA LISTA. Sábado 10h o último item
// é marcado, a lista se arquiva (pedido `arq-compra-2026-10-24`) e a lista nova
// ainda é a compra de sábado (o corte é só às 12h). Se ela nascesse com o
// MESMO id: (1) o cadastro cairia no tombstone da fusão e sumiria do trocador;
// (2) o segundo arquivamento gravaria `arq-compra-2026-10-24` de novo, POR
// CIMA do primeiro — a compra da manhã desapareceria do Arquivo. Por isso o
// sufixo: `compra-2026-10-24-2`, `-3`... — o primeiro que ainda não tem pedido
// no Arquivo. Continua determinístico: sai do db, que é o mesmo em todo aparelho.
export function idDaCompra(dia, db = null) {
  const base = `${PREFIXO_ID}${dia}`;
  const arquivados = new Set((db?.pedidosLista || []).map((p) => String(p?.id ?? '')));
  const apagados = new Set(db?.listaDeletedIds || []);
  const usado = (id) => arquivados.has(`arq-${id}`) || apagados.has(id);
  if (!usado(base)) return base;
  for (let n = 2; n < 1000; n++) if (!usado(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

const RE_ID = /^compra-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/;

export function diaDoId(id) {
  const m = RE_ID.exec(String(id ?? ''));
  return m && dataValida(m[1]) ? m[1] : null;
}

// "Compra de segunda · 27/10". O dia da semana é o que a loja fala; a data
// desempata duas segundas no Arquivo.
export function nomeDaCompra(dia) {
  const d = meioDia(dia);
  return `Compra de ${NOMES_DIA[d.getDay()]} · ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
}

// ── A lista aberta segue a regra? ───────────────────────────────────────────
// A regra só mexe na lista DO DIA. Uma lista criada à mão ("Feira de sábado",
// "Bebidas") tem cadastro em `listasCompra` e não é do dia: quem a abriu quer
// os itens nela, e ela fica onde está. A lista de antes desta mudança (id
// `uid()`/hash, sem cadastro) é a do dia por definição — era a única.
export function ehListaDoDia(id, listasCompra = []) {
  if (!id) return true;
  if (diaDoId(id)) return true;
  return !(listasCompra || []).some((l) => l && l.id === id);
}

// ── Aplicar a regra ao db ───────────────────────────────────────────────────
// Devolve `{ db, listaId, virou }`: o db com a lista do dia garantida (cadastro
// + aberta) e o id em que o item deve ser inserido.
//
//   • lista aberta é feita à mão → não mexe; insere nela (`virou:false`).
//   • lista aberta já é a do dia → não mexe (`virou:false`).
//   • senão → cria o cadastro da compra do dia (se faltar) e a torna aberta
//     para TODO MUNDO (`listaAtualAbertaEm` = agora vence a fusão, §3).
//
// ⚠️ A lista anterior NÃO É APAGADA NEM ARQUIVADA aqui: ela continua no
// trocador com os pendentes dela. Fecha-se pelo caminho de sempre (marcar o
// último item, Arquivar, ou as 48 h).
export function aplicarCompraDoDia(db, agora = new Date(), feriados = new Set()) {
  const d = db || {};
  const atual = d.listaAtualId || '';
  const listasCompra = d.listasCompra || [];
  if (atual && !ehListaDoDia(atual, listasCompra)) return { db: d, listaId: atual, virou: false };
  const dia = diaDaCompra(agora, feriados);
  // Qualquer lista DESTE dia serve (`compra-<dia>` ou `compra-<dia>-2`): a
  // aberta já é a compra certa, não há o que virar.
  if (diaDoId(atual) === dia) return { db: d, listaId: atual, virou: false };
  const id = idDaCompra(dia, d);
  const agoraDate = agora instanceof Date ? agora : new Date(agora);
  const temCadastro = listasCompra.some((l) => l && l.id === id);
  const cadastro = { id, nome: nomeDaCompra(dia), criadaPor: '', criadaEm: agoraDate.toISOString(), updatedAt: agoraDate.getTime() };
  return {
    db: {
      ...d,
      listasCompra: temCadastro ? listasCompra : [...listasCompra, cadastro],
      listaAtualId: id,
      listaAtualAbertaEm: agoraDate.toISOString(),
    },
    listaId: id,
    virou: true,
  };
}

// Só a pergunta, sem mexer: a lista aberta precisa virar? (para o efeito que
// roda a cada minuto não gravar à toa).
export function precisaVirar(db, agora = new Date(), feriados = new Set()) {
  return aplicarCompraDoDia(db, agora, feriados).virou;
}

// Quantos ms até o próximo corte (12h de hoje ou de amanhã) — para a tela
// virar na hora certa em vez de esperar o próximo tique do relógio.
export function msAteProximoCorte(agora = new Date()) {
  const d = agora instanceof Date ? agora : new Date(agora);
  const corte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), HORA_CORTE, 0, 0, 0);
  if (corte.getTime() <= d.getTime()) corte.setDate(corte.getDate() + 1);
  return Math.min(corte.getTime() - d.getTime(), DIA_MS);
}
