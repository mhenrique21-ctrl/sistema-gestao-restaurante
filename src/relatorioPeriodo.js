// Vendas → Relatório → Por Período: a conta do período, dos canais e das formas.
// ============================================================================
// Junta o que eram TRÊS abas (Por Canal, Evolução Mensal, Sazonalidade) e
// acrescenta a comparação entre períodos, que não existia em nenhuma delas.
//
// ⚠️ A conta mora AQUI, fora do `App.tsx`, pela mesma razão do `folhaRh.js` e do
// `lancamentoVendas.js`: relatório erra em SILÊNCIO. Leitor errado aparece na
// tela; soma errada vira um número plausível que alguém leva para a reunião.
//
// ⚠️ A aba **Sazonalidade** lia só `recibosVenda`. Numa operação de balcão, que
// não emite recibo, ela dizia "Nenhum recibo no período" ao lado de um período
// com R$ 44.938,86 — o dado estava em `vendas` o tempo todo. Aqui tudo vem de
// `vendas`, que é onde o faturamento mora.

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ⚠️ ORDEM FIXA. A cor de cada canal sai da posição nesta lista, e a regra da
// paleta categórica é que a cor segue a ENTIDADE, nunca o ranking: um filtro
// que mude quantos canais aparecem não pode repintar os que sobraram.
export const CANAIS = [
  { k: 'balcao',   label: 'Balcão' },
  { k: 'extras',   label: 'Vendas Extras' },
  { k: 'entregas', label: 'Entregas a clientes' },
  { k: 'ifood',    label: 'iFood' },
  { k: 'nfood',    label: '99Food' },
];

export const FORMAS = [
  { k: 'credito', label: 'Crédito' },
  { k: 'debito',  label: 'Débito' },
  { k: 'dinheiro', label: 'Dinheiro' },
  { k: 'pix',     label: 'PIX' },
  { k: 'outros',  label: 'Outros' },
  { k: 'pendura', label: 'Pendura' },
];

// ⚠️ O BALCÃO É `maquininha + dinheiro + PENDURA`, e as duas metades dessa
// frase são armadilhas medidas no dado real (PDV Eclética, 17/09/2026):
//
//   dinheiro 117,00 · crédito 2.282,79 · PIX 343,29 · pendura 82,24
//   maquininha 2.626,08 = crédito + PIX        ← o PIX está DENTRO da maquininha
//   total      2.825,32 = maquininha + dinheiro + pendura
//
// Somar `credito + debito + pix` junto com `maquininha` contaria o PIX duas
// vezes. E deixar a pendura de fora faria o balcão do relatório não fechar com
// o total do dia — por R$ 82,24 num dia só, sem nada denunciando.
export function canaisDaVenda(v) {
  const pendura = num(v?.formas?.pendura);
  return {
    balcao: r2(num(v?.maquininha) + num(v?.dinheiro) + pendura),
    extras: r2(num(v?.delivery)),
    entregas: r2(num(v?.entregasClientes)),
    // O que entra no faturamento da plataforma é o LÍQUIDO — o que ela pagou.
    // O bruto continua disponível à parte (ver `brutoDaVenda`): ele responde
    // "de que tamanho é este canal", não "quanto entrou".
    ifood: r2(num(v?.ifoodLiq) || num(v?.ifood)),
    nfood: r2(num(v?.nfoodLiq) || num(v?.['99food'])),
  };
}

export const brutoDaVenda = (v) => ({
  ifood: r2(num(v?.ifood)),
  nfood: r2(num(v?.['99food'])),
});

// ── O período ───────────────────────────────────────────────────────────────
export function diasDoPeriodo(ini, fim) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim || '')) return out;
  // ⚠️ UTC de propósito. O app guarda AAAA-MM-DD e o Amapá é UTC−3: lido como
  // hora local, `new Date('2026-09-01')` cai em 31/08 às 21h e o período inteiro
  // anda um dia. É a mesma decisão do `faltaClt.js`.
  const d = new Date(`${ini}T12:00:00Z`);
  const ate = new Date(`${fim}T12:00:00Z`);
  while (d <= ate && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ⚠️ O PERÍODO ANTERIOR TEM O MESMO NÚMERO DE DIAS, e termina na véspera.
// Comparar 20 dias com um mês de 31 mostraria uma queda de 35% que é só o
// calendário — e é exatamente o tipo de número que vira decisão errada.
export function periodoAnterior(ini, fim) {
  const dias = diasDoPeriodo(ini, fim).length;
  if (!dias) return null;
  const f = new Date(`${ini}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() - 1);
  const i = new Date(f);
  i.setUTCDate(i.getUTCDate() - (dias - 1));
  return { ini: i.toISOString().slice(0, 10), fim: f.toISOString().slice(0, 10), dias };
}

export function resumoPeriodo(vendas, ini, fim) {
  const dias = diasDoPeriodo(ini, fim);
  const noPeriodo = (vendas || []).filter((v) => {
    const d = String(v?.data || '');
    return d >= ini && d <= fim;
  });

  const zero = () => CANAIS.reduce((a, c) => ({ ...a, [c.k]: 0 }), {});
  const canais = zero();
  const bruto = { ifood: 0, nfood: 0 };
  const porDia = new Map(dias.map((d) => [d, { data: d, total: 0, canais: zero(), lancamentos: 0 }]));
  let total = 0;

  for (const v of noPeriodo) {
    const c = canaisDaVenda(v);
    const b = brutoDaVenda(v);
    for (const k of Object.keys(canais)) canais[k] = r2(canais[k] + c[k]);
    bruto.ifood = r2(bruto.ifood + b.ifood);
    bruto.nfood = r2(bruto.nfood + b.nfood);
    total = r2(total + num(v.total));
    const d = porDia.get(String(v.data));
    if (d) {
      d.total = r2(d.total + num(v.total));
      d.lancamentos += 1;
      for (const k of Object.keys(canais)) d.canais[k] = r2(d.canais[k] + c[k]);
    }
  }

  // ⚠️ O RESÍDUO É MOSTRADO, não escondido. Se a soma dos canais não bate com o
  // total dos lançamentos, é porque algum dia tem valor num campo que nenhum
  // canal lê — dado antigo, ou campo novo que alguém esqueceu de mapear aqui.
  // Espalhar a diferença pelos canais, ou simplesmente usar a soma dos canais
  // como total, esconderia isso para sempre.
  const somaCanais = r2(Object.values(canais).reduce((s, x) => s + x, 0));
  const naoClassificado = r2(total - somaCanais);

  const linhas = [...porDia.values()];
  const comVenda = linhas.filter((d) => d.total > 0);
  const melhor = comVenda.reduce((m, d) => (!m || d.total > m.total ? d : m), null);

  return {
    ini, fim, dias: dias.length, total, canais, bruto, naoClassificado,
    porDia: linhas,
    semLancamento: linhas.filter((d) => !d.lancamentos).map((d) => d.data),
    diasComVenda: comVenda.length,
    // Duas médias, porque respondem coisas diferentes: a do período serve para
    // comparar com outro período; a dos dias abertos é a régua da operação.
    mediaDia: dias.length ? r2(total / dias.length) : 0,
    mediaDiaAberto: comVenda.length ? r2(total / comVenda.length) : 0,
    melhorDia: melhor ? { data: melhor.data, total: melhor.total } : null,
  };
}

// ── Formas de pagamento ─────────────────────────────────────────────────────
// ⚠️ A COBERTURA FAZ PARTE DO NÚMERO. Só o PDV manda `formas`; iFood, 99Food e
// lançamento manual entram no total sem quebra nenhuma. Uma barra de formas sem
// dizer que cobre 77% do período parece o período inteiro — e a conclusão que
// se tira dela ("quase tudo é crédito") seria sobre outro conjunto de vendas.
export function formasDoPeriodo(vendas, ini, fim) {
  const noPeriodo = (vendas || []).filter((v) => String(v?.data || '') >= ini && String(v?.data || '') <= fim);
  const totais = FORMAS.reduce((a, f) => ({ ...a, [f.k]: 0 }), {});
  const diasCom = new Set();
  let coberto = 0;
  let totalPeriodo = 0;

  for (const v of noPeriodo) {
    totalPeriodo = r2(totalPeriodo + num(v.total));
    const f = v?.formas;
    if (!f || typeof f !== 'object') continue;
    let soma = 0;
    for (const { k } of FORMAS) { const n = num(f[k]); totais[k] = r2(totais[k] + n); soma += n; }
    if (soma > 0) { diasCom.add(String(v.data)); coberto = r2(coberto + soma); }
  }

  const dias = diasDoPeriodo(ini, fim).length;
  return {
    totais,
    // O que a quebra soma — e NÃO o total do período, que é maior.
    coberto,
    totalPeriodo,
    semQuebra: r2(totalPeriodo - coberto),
    pctCobertura: totalPeriodo ? r2(coberto / totalPeriodo * 100) : 0,
    diasComQuebra: diasCom.size,
    dias,
    // ⚠️ Pendura sai à parte em toda tela que mostrar "entrou em caixa": está no
    // total e FORA de dinheiro e maquininha, porque é venda fiada. Somada ali,
    // o caixa do dia "sobraria" o valor dela.
    pendura: totais.pendura,
    emCaixa: r2(coberto - totais.pendura),
  };
}

// ── Dia da semana ───────────────────────────────────────────────────────────
export const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function porDiaDaSemana(resumo) {
  const linhas = NOMES_DIA.map((nome, i) => ({ dia: i, nome, total: 0, dias: 0, abertos: 0 }));
  for (const d of resumo?.porDia || []) {
    // UTC pelo mesmo motivo de `diasDoPeriodo`: em hora local a segunda vira
    // domingo e a semana inteira desanda.
    const i = new Date(`${d.data}T12:00:00Z`).getUTCDay();
    linhas[i].total = r2(linhas[i].total + d.total);
    linhas[i].dias += 1;
    if (d.total > 0) linhas[i].abertos += 1;
  }
  // ⚠️ A MÉDIA divide pelos dias ABERTOS, não por quantos daquele dia caíram no
  // período. Num recorte de 20 dias há 3 segundas e 2 quartas; dividindo pelo
  // número de ocorrências, um domingo fechado puxaria a média do domingo para
  // perto de zero e pareceria "domingo vende pouco" em vez de "domingo fecha".
  return linhas.map((l) => ({ ...l, media: l.abertos ? r2(l.total / l.abertos) : 0 }));
}

// ── Mês a mês ───────────────────────────────────────────────────────────────
// A antiga "Evolução Mensal" ignorava o filtro de data de propósito e lia o
// histórico inteiro. Mantido: é a única visão que responde "e antes disso?".
export function porMes(vendas, meses = 6) {
  const mapa = new Map();
  for (const v of vendas || []) {
    const m = String(v?.data || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    mapa.set(m, r2((mapa.get(m) || 0) + num(v.total)));
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-Math.max(1, meses)).map(([mes, total]) => ({ mes, total }));
}

// ── A comparação ────────────────────────────────────────────────────────────
export function compararPeriodos(vendas, ini, fim) {
  const atual = resumoPeriodo(vendas, ini, fim);
  const ant = periodoAnterior(ini, fim);
  const anterior = ant ? resumoPeriodo(vendas, ant.ini, ant.fim) : null;

  // ⚠️ Variação a partir de ZERO não é "infinito%" nem "0%": é um canal que
  // NASCEU no período. Os dois números mentem de jeitos diferentes — o primeiro
  // enche a tela de lixo, o segundo esconde um canal novo. `null` deixa a tela
  // escrever "novo".
  const varia = (hoje, antes) => (antes > 0 ? r2((hoje - antes) / antes * 100) : null);

  return {
    atual,
    anterior,
    delta: anterior ? {
      total: r2(atual.total - anterior.total),
      pct: varia(atual.total, anterior.total),
      mediaDia: varia(atual.mediaDia, anterior.mediaDia),
      canais: CANAIS.reduce((a, c) => ({
        ...a,
        [c.k]: {
          atual: atual.canais[c.k], anterior: anterior.canais[c.k],
          dif: r2(atual.canais[c.k] - anterior.canais[c.k]),
          pct: varia(atual.canais[c.k], anterior.canais[c.k]),
        },
      }), {}),
    } : null,
  };
}
