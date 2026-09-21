// O fechamento de vendas do dia — as decisões que erram em silêncio.
// ============================================================================
// A tela de Lançamentos é grande e mora no `App.tsx`. O que mora AQUI é só o
// que, errado, produz um número plausível:
//
//   1. o rótulo do canal de delivery, que mudou de nome e não pode mudar de
//      CAMPO junto (§ "Vendas Extras" era o mesmo `delivery`);
//   2. a taxa das plataformas, que alimenta a linha "Taxas das plataformas" da
//      DRE — qualquer mudança aqui aparece como margem errada, meses depois;
//   3. "loja fechada" contra "ainda não chegou", que a tela antiga não
//      distinguia;
//   4. a contagem do progresso do dia, que é o que diz se falta algo.

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── O nome do canal de delivery ─────────────────────────────────────────────
// ⚠️ "VENDAS EXTRAS" E "DELIVERY" SEMPRE FORAM O MESMO CAMPO: `vendas[].delivery`,
// com `aj.legVendasExtras` de rótulo configurável. O painel de TV já o chamava
// de "Delivery" (`CANAIS_VENDA_TV`) enquanto a tela de Lançamentos o chamava de
// "Vendas Extras" — dois nomes para um bucket.
//
// ⚠️ TROCAR O PADRÃO NÃO BASTA, e é aqui que quase se perde o rename: `setAj`
// grava `{...getVendasAjustes(d), [key]:val}`, então na primeira vez que a
// pessoa mexeu em QUALQUER ajuste o texto "Vendas Extras" foi congelado no
// `db`. Mudar só o default renomearia a tela de quem nunca abriu Ajustes e
// deixaria o nome antigo em quem abriu.
//
// ⚠️ E NÃO SE MIGRA O DADO. O valor antigo é traduzido na LEITURA, como o
// `LEGADO` do `tipoInsumo.js` e o `encargoDescontado()` do `folhaRh.js`: assim
// um rótulo que a pessoa REALMENTE escolheu ("Balcão 2") sobrevive, e só o
// padrão antigo é trocado.
export const LEGADO_ROTULO_DELIVERY = 'Vendas Extras';
export const ROTULO_DELIVERY = 'Delivery';
export const ROTULO_RECIBOS = 'Recibos';

export function rotuloDelivery(aj) {
  const guardado = String(aj?.legVendasExtras ?? '').trim();
  if (!guardado || guardado === LEGADO_ROTULO_DELIVERY) return ROTULO_DELIVERY;
  return guardado;
}

// ── Onde o recibo cai ───────────────────────────────────────────────────────
// ⚠️ O RECIBO DE BALCÃO CAÍA NO MESMO BUCKET DO DELIVERY. Os dois dinheiros são
// diferentes: um é entrega própria (sincronizada do sistema de entregas), o
// outro é uma venda avulsa que alguém emitiu no balcão. Somados, "Delivery" no
// Dashboard passava a incluir venda que não foi entregue a ninguém — e não
// havia como separar depois, porque o campo era um só.
//
// ⚠️ O HISTÓRICO NÃO É RECLASSIFICADO (decisão do dono, 21/09/2026): o que já
// está em `delivery` fica lá. Adivinhar quais reais antigos eram recibo seria
// chute sobre período já fechado; a separação vale a partir daqui, e a tela diz
// isso na primeira abertura.
export const BUCKET_RECIBO_BALCAO = 'recibosBalcao';
export const BUCKET_RECIBO_ENCOMENDA = 'entregasClientes';

export function bucketDoRecibo(origem) {
  return origem === 'producao' ? BUCKET_RECIBO_ENCOMENDA : BUCKET_RECIBO_BALCAO;
}

// ── TAREFA 3 · a taxa das plataformas, intocada ─────────────────────────────
// ⚠️ ESTA É A CONTA DA DRE, palavra por palavra como ela estava no `App.tsx`.
// Ela existe aqui para ter TESTE: é a única parte do fechamento que, mexida,
// não aparece na tela de Vendas — aparece na linha "Taxas das plataformas" da
// DRE, e só quando alguém for olhar a margem do mês.
//
// ⚠️ `?? v.ifood` NÃO É ENFEITE: lançamento sem líquido gravado (taxa em
// branco) tem líquido IGUAL ao bruto, então a taxa dele é ZERO. Trocando por
// `|| 0`, o líquido viraria zero e a taxa passaria a ser o bruto inteiro — a
// DRE mostraria o faturamento do iFood como despesa.
export function taxasDePlataforma(vendas, de, ate) {
  const dentro = (vendas || []).filter((v) => {
    const d = String(v?.data || '');
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  });
  const ifood = dentro.reduce((s, v) => s + (num(v.ifood) - num(v.ifoodLiq ?? v.ifood ?? 0)), 0);
  const nfood = dentro.reduce((s, v) => s + (num(v['99food']) - num(v.nfoodLiq ?? v['99food'] ?? 0)), 0);
  return { ifood: r2(ifood), nfood: r2(nfood), total: r2(ifood + nfood) };
}

// ── TAREFA 2 · loja fechada NÃO é pendência ─────────────────────────────────
// ⚠️ UM DOMINGO FECHADO E UM DIA ÚTIL EM QUE O 99FOOD ATRASOU eram a mesma
// linha na tela: "sem lançamento". Tratados juntos, a lista de pendências do
// Dashboard enche de domingos e deixa de ser lida — é a regra do "aviso que
// grita sempre é aviso que ninguém lê".
//
// ⚠️ E "AINDA NÃO CHEGOU" NÃO É ERRO. Antes da hora limite o automático
// legitimamente não chegou; depois dela, é pendência de verdade. Sem a hora, a
// tela acusaria o iFood às 9h da manhã, todo dia.
export const HORA_PENDENCIA_PADRAO = 21;

export function statusDoDia({ data, hoje, hora, semMovimento, faltando, temAlgumValor, horaLimite = HORA_PENDENCIA_PADRAO }) {
  // A declaração da pessoa vence qualquer heurística: ela sabe que fechou.
  if (semMovimento) return { status: 'fechado', rotulo: 'Loja fechada', cor: 'cinza' };
  const nFalta = (faltando || []).length;
  if (!nFalta) return { status: 'completo', rotulo: 'Fechado completo', cor: 'verde' };

  // Dia passado: a hora já passou, seja qual for. Dia futuro nunca é pendência.
  const passado = String(data) < String(hoje);
  const futuro = String(data) > String(hoje);
  if (futuro) return { status: 'aguardando', rotulo: 'Ainda não aconteceu', cor: 'neutro', faltando };
  const depoisDaHora = passado || num(hora) >= num(horaLimite);

  if (!depoisDaHora) {
    return { status: 'aguardando', rotulo: `Aguardando ${nFalta}`, cor: 'neutro', faltando };
  }
  // ⚠️ Dia sem NENHUM valor e sem marcador, depois da hora: é o candidato a
  // "esqueci de marcar que fechou", e não a "faltou um canal". A tela oferece o
  // marcador em vez de listar cinco pendências de um dia que não existiu.
  if (!temAlgumValor) return { status: 'vazio', rotulo: 'Nenhum lançamento', cor: 'ambar', faltando, ofereceFechado: true };
  return { status: 'pendente', rotulo: nFalta === 1 ? '1 pendência' : `${nFalta} pendências`, cor: 'ambar', faltando };
}

// ── O progresso do dia ──────────────────────────────────────────────────────
// ⚠️ CONTA CANAL, NÃO CAMPO PREENCHIDO. Um canal apurado pelo PDV está
// confirmado sem ninguém digitar nada, e um canal desligado em Ajustes não
// entra na conta — senão o progresso nunca fecharia numa loja que não usa
// 99Food, e "4/5" viraria um número que não chega a 5 nunca.
export function progressoDoDia(cards) {
  const ativos = (cards || []).filter((c) => c && c.ativo !== false);
  const feitos = ativos.filter((c) => c.temValor);
  return {
    feitos: feitos.length,
    total: ativos.length,
    pct: ativos.length ? Math.round((feitos.length / ativos.length) * 100) : 0,
    faltando: ativos.filter((c) => !c.temValor).map((c) => c.label),
  };
}

// ── Os últimos N dias, para o sparkline ─────────────────────────────────────
// ⚠️ DIA SEM VENDA ENTRA COMO ZERO, não sai da série. Fora dela, a linha ligaria
// sexta direto em domingo e o desenho mentiria sobre o ritmo da semana — é a
// mesma razão pela qual a média por dia da semana divide pelos dias ABERTOS
// (§7): o calendário faz parte do número.
export function serieDosDias(vendas, ate, dias = 7) {
  const fim = Date.parse(`${ate}T00:00:00Z`);
  if (!Number.isFinite(fim) || !(dias > 0)) return [];
  const porDia = new Map();
  for (const v of vendas || []) {
    const d = String(v?.data || '');
    if (!d) continue;
    porDia.set(d, r2((porDia.get(d) || 0) + num(v.total)));
  }
  const saida = [];
  for (let i = dias - 1; i >= 0; i--) {
    const iso = new Date(fim - i * 86400000).toISOString().slice(0, 10);
    saida.push({ data: iso, total: r2(porDia.get(iso) || 0) });
  }
  return saida;
}

// A média por dia da série, contando só os dias que TIVERAM venda: incluindo os
// fechados, "média/dia" viraria uma medida de quantos domingos caíram na semana.
export function mediaDaSerie(serie) {
  const abertos = (serie || []).filter((d) => d.total > 0);
  if (!abertos.length) return 0;
  return r2(abertos.reduce((s, d) => s + d.total, 0) / abertos.length);
}
