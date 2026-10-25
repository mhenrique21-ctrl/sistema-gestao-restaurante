// O ciclo da lista de compras: quando corta e de que dia é a compra.
// ============================================================================
// Decisão do dono (25/10/2026): **domingo a loja não abre**, e dia fechado NÃO
// TEM CORTE. A lista que começa sábado ao meio-dia vai até segunda ao meio-dia
// e leva o nome da compra de SEGUNDA — não existe um corte no domingo partindo
// esse ciclo em dois.
//
// Mora fora do App.tsx e do new_server.js porque é a mesma conta em dois
// lugares: a tela mostra de que dia é a compra, e o timer do servidor dorme até
// o próximo corte. Duas implementações divergiriam no dia em que uma mudasse —
// e o sintoma seria o servidor cortando num dia e a tela dizendo outro.
//
// ⚠️ TUDO AQUI É EM HORÁRIO DE BELÉM, nunca no fuso do servidor. A VPS pode
// estar em UTC: com `new Date().getHours()` o corte das 12h cairia às 9h da
// manhã na loja. É a mesma lição do `hojeISO` da ponte do Eclética (§4) e do
// `faltaClt.js` (§6), onde confundir local com UTC trocava o dia.
//
// ⚠️ E é por `Intl`, com o nome do fuso, não por um `-3` fixo. Hoje o Brasil
// não tem horário de verão (abolido em 2019) e Belém nunca teve, então o
// resultado é o mesmo; se um dia voltar, o `-3` cravado erraria uma hora
// durante meses e ninguém ligaria o corte estranho à constante.

export const FUSO = 'America/Belem';
export const HORA_CORTE = 12;

// Domingo = 0, como `Date#getDay`.
export const DIAS_FECHADOS_PADRAO = [0];

const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// ⚠️ TETO DA VARREDURA. Um `.env` que feche os sete dias (ou um feriado por dia
// durante um ano) faria o laço rodar para sempre e TRAVAR O SERVIDOR — o timer
// chama isto na subida. Com teto, o erro vira exceção com o motivo escrito.
const MAX_PULOS = 400;

// ── O fuso, nos dois sentidos ───────────────────────────────────────────────
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
});

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// O relógio de parede de Belém num instante.
export function emBelem(instante) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(instante)) p[type] = value;
  // `hour` vem "24" à meia-noite em alguns ICU; normaliza para 0.
  const hora = Number(p.hour) % 24;
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora, minuto: Number(p.minute), segundo: Number(p.second),
    diaSemana: WD[p.weekday],
    data: `${p.year}-${p.month}-${p.day}`,
  };
}

// O instante em que o relógio de Belém marca essa hora naquele dia.
//
// ⚠️ Duas passadas de propósito: o deslocamento do fuso é lido NUM instante, e
// o instante é o que se está procurando. Uma passada só erraria exatamente na
// virada de um horário de verão — o caso raro que ninguém testa e que volta a
// cada seis meses.
function instanteEmBelem(ano, mes, dia, hora, minuto = 0) {
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto, 0);
  let palpite = alvo;
  for (let i = 0; i < 2; i++) {
    const p = emBelem(new Date(palpite));
    const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    palpite = alvo - (comoUtc - palpite);
  }
  return new Date(palpite);
}

const somarDias = ({ ano, mes, dia }, n) => {
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
};
const comoISO = ({ ano, mes, dia }) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
const diaSemanaDe = ({ ano, mes, dia }) => new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();

// ── A configuração, do .env ─────────────────────────────────────────────────
// LISTA_DIAS_FECHADOS="0"              domingo (padrão)
// LISTA_FERIADOS="2026-12-25,2027-01-01"
//
// ⚠️ CONFIGURAÇÃO INVÁLIDA NÃO DERRUBA NADA — cai no padrão e AVISA. Fechar os
// sete dias não é uma loja sem compra: é um laço infinito. Falhar fechado aqui
// bricaria o servidor por causa de uma vírgula no `.env`, que é a lição do
// `APP_SESSION_SECRET` (§10.1).
export function configDoCiclo(env = {}, avisar = console.warn) {
  const crus = String(env.LISTA_DIAS_FECHADOS ?? '').trim();
  let fechados = crus === ''
    ? [...DIAS_FECHADOS_PADRAO]
    : [...new Set(crus.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];

  if (crus !== '' && !fechados.length) {
    avisar(`[listaCiclo] LISTA_DIAS_FECHADOS="${crus}" não tem nenhum dia válido (0=domingo … 6=sábado). Usando o padrão: domingo.`);
    fechados = [...DIAS_FECHADOS_PADRAO];
  }
  if (fechados.length >= 7) {
    avisar(`[listaCiclo] LISTA_DIAS_FECHADOS="${crus}" fecha a semana INTEIRA — não haveria dia de compra nenhum. Usando o padrão: domingo.`);
    fechados = [...DIAS_FECHADOS_PADRAO];
  }

  const feriados = new Set(
    String(env.LISTA_FERIADOS ?? '').split(',')
      .map((x) => x.trim())
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)),
  );
  const descartados = String(env.LISTA_FERIADOS ?? '').split(',')
    .map((x) => x.trim()).filter((x) => x && !/^\d{4}-\d{2}-\d{2}$/.test(x));
  if (descartados.length) {
    avisar(`[listaCiclo] LISTA_FERIADOS ignorou ${descartados.length} valor(es) fora do formato AAAA-MM-DD: ${descartados.join(', ')}`);
  }

  return { diasFechados: new Set(fechados), feriados, horaCorte: HORA_CORTE };
}

export function ehDiaFechado(dia, cfg) {
  const c = cfg || configDoCiclo();
  return c.diasFechados.has(diaSemanaDe(dia)) || c.feriados.has(comoISO(dia));
}

// ── De que dia é a compra ───────────────────────────────────────────────────
// Antes das 12h o dia da compra é HOJE; a partir das 12h já é o próximo. E
// depois disso anda até achar um dia ABERTO — é o que faz sábado 12h virar a
// compra de segunda em vez de "compra de domingo".
export function diaDaCompra(agora = new Date(), cfg = configDoCiclo()) {
  const b = emBelem(agora);
  let dia = { ano: b.ano, mes: b.mes, dia: b.dia };
  if (b.hora >= cfg.horaCorte) dia = somarDias(dia, 1);
  for (let i = 0; ehDiaFechado(dia, cfg); i++) {
    if (i >= MAX_PULOS) throw new Error(`[listaCiclo] ${MAX_PULOS} dias seguidos fechados a partir de ${comoISO(dia)} — confira LISTA_DIAS_FECHADOS e LISTA_FERIADOS.`);
    dia = somarDias(dia, 1);
  }
  return comoISO(dia);
}

// O corte que ABRIU o ciclo de agora: o último meio-dia de um dia ABERTO, nele
// inclusive. Em domingo e feriado não há corte — por isso o laço anda para trás
// até um dia aberto, e é isso que estica o ciclo de sábado até segunda.
export function ultimoCorte(agora = new Date(), cfg = configDoCiclo()) {
  const b = emBelem(agora);
  let dia = { ano: b.ano, mes: b.mes, dia: b.dia };
  if (b.hora < cfg.horaCorte) dia = somarDias(dia, -1);
  for (let i = 0; ehDiaFechado(dia, cfg); i++) {
    if (i >= MAX_PULOS) throw new Error(`[listaCiclo] ${MAX_PULOS} dias seguidos fechados antes de ${comoISO(dia)} — confira LISTA_DIAS_FECHADOS e LISTA_FERIADOS.`);
    dia = somarDias(dia, -1);
  }
  return instanteEmBelem(dia.ano, dia.mes, dia.dia, cfg.horaCorte);
}

// O corte que FECHA o ciclo de agora — e ele é, por construção, o meio-dia do
// dia da compra. Os dois saem da mesma conta de propósito: fossem duas, um dia
// a tela diria "compra de segunda" com o servidor cortando na terça.
export function proximoCorte(agora = new Date(), cfg = configDoCiclo()) {
  const [ano, mes, dia] = diaDaCompra(agora, cfg).split('-').map(Number);
  return instanteEmBelem(ano, mes, dia, cfg.horaCorte);
}

// `Compra de segunda · 26/10`
export function nomeDaCompra(agora = new Date(), cfg = configDoCiclo()) {
  const iso = diaDaCompra(agora, cfg);
  const [ano, mes, dia] = iso.split('-').map(Number);
  const nome = NOMES_DIA[diaSemanaDe({ ano, mes, dia })];
  return `Compra de ${nome} · ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

// Tudo de uma vez, para a tela e para o endpoint — um objeto só evita que
// alguém monte metade por um caminho e metade por outro.
export function cicloAtual(agora = new Date(), cfg = configDoCiclo()) {
  return {
    diaDaCompra: diaDaCompra(agora, cfg),
    nome: nomeDaCompra(agora, cfg),
    ultimoCorte: ultimoCorte(agora, cfg).toISOString(),
    proximoCorte: proximoCorte(agora, cfg).toISOString(),
    fuso: FUSO,
    horaCorte: cfg.horaCorte,
  };
}
