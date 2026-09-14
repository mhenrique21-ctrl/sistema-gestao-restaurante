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
