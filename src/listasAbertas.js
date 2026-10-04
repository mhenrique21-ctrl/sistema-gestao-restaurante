// Várias listas de compra abertas ao mesmo tempo, cada uma com nome e autor.
// ============================================================================
// Até aqui existia UMA lista aberta, identificada só por `listaAtualId`, sem
// nome e sem dono. Quem precisava separar a feira da semana da compra de
// bebidas não tinha como: fechava uma para abrir a outra, e os pendentes da
// primeira iam para o Arquivo.
//
// ⚠️ ISTO NASCE DE UM DEFEITO, não de uma ideia nova. Item cujo `listaId` não
// é o da lista aberta já existia — era o ÓRFÃO invisível de `src/listaId.js`,
// a anomalia que ninguém via. Dando nome e tela às outras listas, o mesmo
// estado deixa de ser anomalia e passa a ser o recurso.
//
// Mora fora do App.tsx porque a parte das 48 horas TIRA COISA DA TELA sozinha,
// e erro aqui aparece como "sumiu a lista que eu estava usando".

export const OCIOSA_HORAS = 48;

// ── O nome automático ───────────────────────────────────────────────────────
// `04/10 · 21:14 · Mário`. Data e hora LOCAIS: o Amapá é UTC−3 e às 21h o UTC
// já é o dia seguinte — uma lista criada à noite nasceria com a data de amanhã.
export function nomeAutomatico(quando = new Date(), usuario = '') {
  const d = quando instanceof Date ? quando : new Date(quando);
  const p = (n) => String(n).padStart(2, '0');
  const dataHora = `${p(d.getDate())}/${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
  const quem = String(usuario || '').trim();
  return quem ? `${dataHora} · ${quem}` : dataHora;
}

// ⚠️ Nome em branco VOLTA para o automático, nunca grava vazio. Uma lista sem
// nome na barra do topo é uma lista que ninguém sabe qual é — e a barra existe
// justamente para não se digitar na lista errada.
export function nomeDaLista(digitado, quando, usuario) {
  const n = String(digitado ?? '').trim();
  return n || nomeAutomatico(quando, usuario);
}

// ── As listas abertas, a partir do db ───────────────────────────────────────
// ⚠️ O CADASTRO É DERIVADO, nunca exigido. Toda a operação de hoje tem itens
// com `listaId` e nenhuma entrada em `listasCompra` — exigir o cadastro faria
// a lista em uso sumir da tela no deploy. Cada `listaId` que aparece nos itens
// vira uma lista, com o nome que tiver; sem nome, a data do item mais antigo.
export function listasAbertas({
  listasCompra = [], listaCompras = [], listaAtualId = '', listaAtualAbertaEm = '',
} = {}) {
  const porId = new Map();
  const garantir = (id) => {
    if (!id) return null;
    if (!porId.has(id)) porId.set(id, { id, nome: '', criadaPor: '', criadaEm: '', itens: 0, pendentes: 0, movimento: 0 });
    return porId.get(id);
  };

  for (const l of listasCompra) {
    if (!l?.id) continue;
    const e = garantir(l.id);
    e.nome = String(l.nome || '').trim();
    e.criadaPor = String(l.criadaPor || '').trim();
    e.criadaEm = l.criadaEm || '';
    e.movimento = Math.max(e.movimento, Date.parse(l.criadaEm || '') || 0);
  }

  // A lista aberta existe mesmo sem cadastro e sem item nenhum: é nela que a
  // próxima inserção cai.
  if (listaAtualId) {
    const e = garantir(listaAtualId);
    const ab = Date.parse(listaAtualAbertaEm || '') || 0;
    if (!e.criadaEm && ab) e.criadaEm = listaAtualAbertaEm;
    e.movimento = Math.max(e.movimento, ab);
  }

  for (const i of listaCompras) {
    const id = i?.listaId;
    if (!id) continue;
    const e = garantir(id);
    e.itens++;
    if (!i.comprado) e.pendentes++;
    const t = Number(i.updatedAt) || Date.parse(i.criadoEm || '') || 0;
    e.movimento = Math.max(e.movimento, t);
    if (!e.criadaEm && i.criadoEm) e.criadaEm = i.criadoEm;
  }

  const saida = [...porId.values()].map((e) => ({
    ...e,
    nome: e.nome || rotuloDeFallback(e),
    ativa: e.id === listaAtualId,
  }));
  // A ativa primeiro; depois por movimento mais recente. Sem o terceiro
  // critério a ordem muda entre um render e outro e a tela "pisca".
  return saida.sort((a, b) =>
    (b.ativa ? 1 : 0) - (a.ativa ? 1 : 0) || b.movimento - a.movimento || String(a.id).localeCompare(String(b.id)));
}

// Lista antiga, sem cadastro: o rótulo sai da data que ela tem.
function rotuloDeFallback(e) {
  const t = e.criadaEm ? new Date(e.criadaEm) : (e.movimento ? new Date(e.movimento) : null);
  return t && !Number.isNaN(t.getTime()) ? nomeAutomatico(t, '') : 'Lista sem nome';
}

export function listaPorId(listas, id) {
  return (listas || []).find((l) => l.id === id) || null;
}

// ── As que passaram de 48 h ─────────────────────────────────────────────────
// ⚠️ ELAS SÃO APAGADAS, NÃO ARQUIVADAS (decisão do dono, 04/10/2026, depois de
// eu ter proposto arquivar e ele ter reafirmado). Os itens somem do banco e não
// há desfazer — por isso tudo abaixo, e por isso a tela avisa ANTES
// (`horasAteApagar`), em vez de a lista simplesmente deixar de existir.
//
// ⚠️ A CONTA É DE OCIOSIDADE, NÃO DE IDADE. Por idade, uma lista aberta na
// segunda e usada todo dia sumiria na quarta no meio da compra. O relógio
// reinicia a cada item inserido ou marcado.
//
// ⚠️ A ATIVA NUNCA SAI SOZINHA. Ela é a que está na tela de todo mundo: fazê-la
// desaparecer no meio do expediente é o pior desfecho possível, e o motivo de
// ela estar parada pode ser simplesmente a loja ter fechado no fim de semana.
//
// ⚠️ Lista SEM MOVIMENTO CONHECIDO não sai: chutar "ninguém mexeu" apagaria
// uma lista sobre a qual não se sabe nada. A vazia sai — não há o que perder,
// e deixá-la para sempre encheria o trocador de lista vazia, que é justamente
// o que a limpeza existe para evitar.
export function listasOciosas(listas, agoraMs = Date.now(), horas = OCIOSA_HORAS) {
  const limite = horas * 3600 * 1000;
  return (listas || [])
    .filter((l) => !l.ativa && l.movimento > 0 && (agoraMs - l.movimento) >= limite)
    .map((l) => l.id);
}

// Quantas horas faltam para esta lista ser apagada. `null` = não está na fila
// (é a ativa, ou não se sabe quando mexeram nela).
//
// ⚠️ EXISTE PORQUE APAGAR NÃO TEM DESFAZER. Sem o aviso, a pessoa abre o
// trocador num dia e a lista que ela montou simplesmente não está mais lá.
export function horasAteApagar(lista, agoraMs = Date.now(), horas = OCIOSA_HORAS) {
  if (!lista || lista.ativa || !lista.movimento) return null;
  const restam = (lista.movimento + horas * 3600 * 1000) - agoraMs;
  return Math.max(0, Math.ceil(restam / 3600000));
}

// Qual lista fica aberta quando a ativa é arquivada: a de movimento mais
// recente entre as que sobram. Nenhuma sobrando devolve null — quem chama cria
// uma nova, porque a aba Lista nunca pode ficar sem lista aberta.
export function proximaAtiva(listas, saindoId) {
  const resto = (listas || []).filter((l) => l.id !== saindoId);
  if (!resto.length) return null;
  return resto.slice().sort((a, b) => b.movimento - a.movimento || String(a.id).localeCompare(String(b.id)))[0].id;
}
