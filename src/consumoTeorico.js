// Consumo teórico de insumos a partir das vendas.
// ============================================================================
// Fora do App.tsx de propósito: as duas contas daqui erram em silêncio e o
// resultado continua parecendo plausível na tela. Um teste que trave isso vale
// mais que qualquer revisão.
//
//   1. `insumos[].quantidade` na ficha é da RECEITA INTEIRA, e `porcoes` diz
//      quantas unidades ela rende. Esquecer de dividir multiplica o consumo
//      pelo rendimento — uma receita que rende 50 pães acusa 50x o polvilho.
//   2. Ficha quase sempre é escrita em g/ml e a compra vem em kg/l. Sem
//      converter, "consumi 4500" contra "comprei 5" parece rombo de 4495.

// Conversão só onde ela é inequívoca: massa e volume. Fora dessas famílias
// (un, pct, cx...) NÃO se converte — quantas unidades tem um pacote é dado de
// cadastro, não de tabela, e chutar aqui inventaria número com cara de certo.
const UNIDADE_BASE = {
  mg: { familia: 'massa', fator: 0.001 },
  g: { familia: 'massa', fator: 1 },
  grama: { familia: 'massa', fator: 1 },
  gramas: { familia: 'massa', fator: 1 },
  kg: { familia: 'massa', fator: 1000 },
  quilo: { familia: 'massa', fator: 1000 },
  ml: { familia: 'volume', fator: 1 },
  l: { familia: 'volume', fator: 1000 },
  lt: { familia: 'volume', fator: 1000 },
  litro: { familia: 'volume', fator: 1000 },
  litros: { familia: 'volume', fator: 1000 },
};

// Precisa bater com o foldNome do App.tsx — é a normalização única do sistema.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Devolve null quando não dá pra converter. Quem chama TEM que tratar o null
// avisando, nunca assumindo 1:1 — foi assumindo 1:1 que o rombo apareceria.
export function converterQtd(qtd, de, para) {
  const a = UNIDADE_BASE[fold(de)];
  const b = UNIDADE_BASE[fold(para)];
  if (a && b) return a.familia === b.familia ? (qtd * a.fator) / b.fator : null;
  return fold(de) === fold(para) ? qtd : null;
}

// vendidos: [{nome, qtd, total}]  ·  resolverFicha: (nome) => ficha | null
export function consumoTeorico(vendidos, resolverFicha) {
  const porInsumo = new Map();
  let receitaComFicha = 0;
  let receitaSemFicha = 0;
  const semPorcoes = [];
  const semInsumos = [];

  (vendidos || []).forEach((p) => {
    const ficha = resolverFicha(p.nome);
    if (!ficha) { receitaSemFicha += p.total || 0; return; }
    receitaComFicha += p.total || 0;

    const insumos = ficha.insumos || [];
    if (!insumos.length) { semInsumos.push(ficha.nome); return; }

    const bruto = parseFloat(ficha.porcoes);
    // Rendimento ausente ou zero vira 1 — mas ENTRA na lista de avisos: tratar
    // como 1 em silêncio superestimaria o consumo sem ninguém perceber.
    if (!Number.isFinite(bruto) || bruto <= 0) semPorcoes.push(ficha.nome);
    const porcoes = Number.isFinite(bruto) && bruto > 0 ? bruto : 1;

    insumos.forEach((i) => {
      const chave = i.mpId || `nome:${fold(i.nome)}`;
      if (chave === 'nome:') return;
      const porUnidade = (parseFloat(i.quantidade) || 0) / porcoes;
      const qtd = porUnidade * (p.qtd || 0);
      const cur = porInsumo.get(chave) || {
        chave, nome: i.nome || '(sem nome)', unidade: i.unidade || 'un',
        mpId: i.mpId || '', qtd: 0, custo: 0, fontes: new Map(),
      };
      cur.qtd += qtd;
      cur.custo += qtd * (parseFloat(i.valorUnd) || 0);
      cur.fontes.set(p.nome, (cur.fontes.get(p.nome) || 0) + qtd);
      porInsumo.set(chave, cur);
    });
  });

  return {
    linhas: Array.from(porInsumo.values()).sort((a, b) => b.custo - a.custo),
    receitaComFicha, receitaSemFicha,
    semPorcoes: [...new Set(semPorcoes)],
    semInsumos: [...new Set(semInsumos)],
  };
}

// ── Baixa de estoque a partir das vendas ────────────────────────────────────
// Id determinístico por dia + insumo. É o que torna reprocessar seguro: o
// agente do Eclética REENVIA ontem e hoje a cada ciclo, e uma ficha corrigida
// deve refazer a baixa daquele dia — não somar uma segunda.
export const idBaixaVenda = (data, mpId) => `vsaida-${data}-${mpId}`;

// Aplica um mapa {data: {mpId: {qtd, ...}}} sobre movEstoque + materiasPrimas.
// Trabalha por DIFERENÇA contra o que já foi baixado antes, nunca por soma:
//
//   ontem baixou 2,0 kg · ficha corrigida agora pede 1,6 kg
//   → devolve 0,4 kg ao estoque e deixa o movimento em 1,6
//
// Somar daria 3,6 kg e o erro só apareceria na contagem física, semanas depois.
export function aplicarBaixaVendas(movEstoque, materiasPrimas, porDia, agora) {
  const movs = [...(movEstoque || [])];
  const mps = [...(materiasPrimas || [])];
  const porId = new Map(movs.map((m, i) => [m.id, i]));
  const mpPorId = new Map(mps.map((m, i) => [m.id, i]));
  let criados = 0, atualizados = 0, removidos = 0;
  const ajustes = new Map();                        // mpId -> delta de estoque

  for (const [data, porMp] of Object.entries(porDia || {})) {
    for (const [mpId, info] of Object.entries(porMp)) {
      const id = idBaixaVenda(data, mpId);
      const idx = porId.get(id);
      const anterior = idx != null ? (parseFloat(movs[idx].quantidade) || 0) : 0;
      const nova = Math.round((parseFloat(info.qtd) || 0) * 1000) / 1000;
      if (nova === anterior && idx != null) continue;

      // Saída consome estoque: quantidade maior => delta negativo.
      ajustes.set(mpId, (ajustes.get(mpId) || 0) - (nova - anterior));

      if (nova <= 0) {
        if (idx != null) { movs[idx] = null; removidos++; }
        continue;
      }
      const reg = {
        id, mpId, mpNome: info.nome || '', tipo: 'saida',
        quantidade: nova, unidade: info.unidade || 'un', custo: info.custo || 0,
        data, descricao: info.descricao || 'Baixa por venda', origem: 'venda',
        criadoEm: idx != null ? (movs[idx].criadoEm || agora) : agora, atualizadoEm: agora,
      };
      if (idx != null) { movs[idx] = reg; atualizados++; }
      else { movs.unshift(reg); criados++; porId.set(id, 0); recontar(movs, porId); }
    }
  }

  for (const [mpId, delta] of ajustes) {
    const i = mpPorId.get(mpId);
    if (i == null || !delta) continue;
    // Saldo pode ficar negativo de propósito: travar aqui porque o cadastro
    // está desatualizado esconderia a inconsistência em vez de mostrá-la.
    mps[i] = { ...mps[i], estoqueAtual: Math.round(((parseFloat(mps[i].estoqueAtual) || 0) + delta) * 1000) / 1000, atualizadoEm: agora };
  }

  return { movEstoque: movs.filter(Boolean), materiasPrimas: mps, criados, atualizados, removidos };
}

// unshift invalida todos os índices guardados; refazer o mapa é mais barato
// (e muito menos frágil) que corrigir cada um na mão.
function recontar(movs, porId) {
  porId.clear();
  movs.forEach((m, i) => { if (m) porId.set(m.id, i); });
}
