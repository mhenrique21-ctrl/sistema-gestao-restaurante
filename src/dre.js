// A DRE em uma barra, e o aviso de quando ela está mentindo.
// ============================================================================
// A conta da DRE já existia dentro do `App.tsx` e continua lá. O que mora aqui
// são as duas partes que a REMODELAGEM de 20/09/2026 precisou, e que erram em
// silêncio se ficarem soltas no meio do JSX:
//
//   1. as fatias da barra — se elas não fecharem 100%, a tela desenha uma
//      proporção errada e ninguém confere um pixel;
//   2. a conferência do CMV — o recorte curto sem compra nenhuma faz a margem
//      parecer o dobro, e era exatamente isso que a tela antiga mostrava sem
//      dizer nada.

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Onde foi cada real que entrou.
//
// ⚠️ AS LARGURAS FECHAM 100% SEMPRE, e não é detalhe de desenho: a barra é a
// única parte da tela que a pessoa lê como PROPORÇÃO. A versão antiga desta
// informação ("Para cada R$ 100 vendidos") somava cinco porcentagens
// calculadas em separado e precisava de uma linha "restante não alocado" para
// explicar a diferença — ou seja, ela já sabia que não fechava.
//
// ⚠️ PREJUÍZO NÃO ENCOLHE A BARRA. Quando o custo passa da receita, as fatias
// são escaladas para preencher a barra inteira e o que faltou vira um número
// escrito (`faltou`). Desenhar custo de 130% dentro de uma barra de 100%
// mostraria uma sobra que não existe.
export function fatiasDaReceita({ vendasBrutas, despVendas, totalCMV, totalDesp, imposto, lucroLiq }) {
  const base = num(vendasBrutas);
  const custos = [
    { chave: 'taxa', rotulo: 'Taxas das plataformas', valor: r2(num(despVendas)) },
    { chave: 'cmv', rotulo: 'Insumos vendidos (CMV)', valor: r2(num(totalCMV)) },
    { chave: 'despesa', rotulo: 'Despesas', valor: r2(num(totalDesp)) },
    { chave: 'imposto', rotulo: 'Simples Nacional', valor: r2(num(imposto)) },
  ];
  const sobra = r2(num(lucroLiq));

  if (!(base > 0)) {
    return { base: 0, fatias: custos.map((c) => ({ ...c, pct: 0, largura: 0 })), sobra: { valor: sobra, pct: 0, largura: 0 }, negativo: false, faltou: 0 };
  }

  const pctDe = (v) => r2((v / base) * 100);
  const negativo = sobra < 0;
  const somaCustos = custos.reduce((s, c) => s + c.valor, 0);

  // No positivo a régua é a RECEITA; no negativo é o custo total, senão as
  // fatias estourariam a largura da barra.
  const regua = negativo ? somaCustos : base;
  const fatias = custos.map((c) => ({ ...c, pct: pctDe(c.valor), largura: regua > 0 ? r2((c.valor / regua) * 100) : 0 }));

  // O resíduo do arredondamento vai na ÚLTIMA fatia desenhada, para a soma das
  // larguras dar 100 exato — três casas de sobra deixariam um fio de fundo
  // aparecendo no fim da barra.
  const alvo = negativo ? fatias : [...fatias, { chave: 'sobra' }];
  const somaLarg = fatias.reduce((s, f) => s + f.largura, 0) + (negativo ? 0 : r2((sobra / base) * 100));
  const ajuste = r2(100 - somaLarg);
  const ultima = alvo[alvo.length - 1];
  if (ultima.chave === 'sobra') {
    return {
      base,
      fatias,
      sobra: { valor: sobra, pct: pctDe(sobra), largura: r2(r2((sobra / base) * 100) + ajuste) },
      negativo: false,
      faltou: 0,
    };
  }
  ultima.largura = r2(ultima.largura + ajuste);
  return {
    base,
    fatias,
    sobra: { valor: sobra, pct: pctDe(sobra), largura: 0 },
    negativo: true,
    faltou: r2(somaCustos - base),
  };
}

// Dá para confiar no CMV deste recorte?
//
// ⚠️ COMPRA É IRREGULAR E VENDA É DIÁRIA. A nota chega num dia e abastece a
// semana inteira; a venda acontece todo dia. Num recorte curto o CMV quase
// nunca corresponde ao insumo que realmente saiu da despensa — e quando ele dá
// ZERO, o Lucro Bruto sai igual à Receita Líquida e a tela anuncia uma margem
// que não existe. Foi o que o dono viu em 14–19/09/2026: CMV R$ 0,00, margem
// aparente de 48%, e R$ 3.725,82 de compra no mês logo abaixo, sem uma palavra
// ligando as duas coisas.
export function conferirCmv(compras, de, ate) {
  const dentro = (compras || []).filter((c) => c?.data && c.data >= de && c.data <= ate);
  const total = r2(dentro.reduce((s, c) => s + num(c.valorNum ?? c.valor), 0));
  const dias = diasNoIntervalo(de, ate);
  const diasComCompra = new Set(dentro.map((c) => c.data)).size;

  // O mês do INÍCIO. Num recorte que atravessa meses não existe "o mês", e
  // oferecer um deles escolheria por conta própria qual — então não oferece.
  const mesRef = String(de || '').slice(0, 7);
  const mesmoMes = mesRef && mesRef === String(ate || '').slice(0, 7);
  const doMes = mesmoMes ? (compras || []).filter((c) => String(c?.data || '').startsWith(mesRef)) : [];
  const totalMes = r2(doMes.reduce((s, c) => s + num(c.valorNum ?? c.valor), 0));

  // ⚠️ DUAS ALTURAS, de propósito. "Zero compra" é um erro de leitura garantido
  // e ganha aviso; "recorte curto com compra" é só um cuidado e ganha uma nota
  // de uma linha. Gritar nos dois casos é o jeito de ninguém mais ler nenhum.
  let nivel = 'nenhum';
  if (total <= 0) nivel = 'aviso';
  else if (dias <= 10) nivel = 'nota';

  return {
    nivel, total, dias, diasComCompra,
    mesRef: mesmoMes ? mesRef : null,
    totalMes: mesmoMes ? totalMes : 0,
    // Só vale oferecer o mês quando ele tem mais compra que o recorte.
    ofereceMes: !!mesmoMes && totalMes > total,
  };
}

export function diasNoIntervalo(de, ate) {
  const a = Date.parse(`${de}T00:00:00Z`);
  const b = Date.parse(`${ate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// O intervalo do mês de uma data — é ele que o botão "ver o mês inteiro" usa,
// e o que a tela abre por padrão (decisão do dono, 20/09/2026).
//
// ⚠️ Tudo em UTC: o app guarda `AAAA-MM-DD` e o Amapá é UTC−3. Lido como hora
// local, o dia 1º vira o último dia do mês anterior (§7).
export function mesDaData(data) {
  const s = String(data || '');
  const mes = s.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) return null;
  const [y, m] = mes.split('-').map(Number);
  const fim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(fim).padStart(2, '0')}` };
}

// Quanto sobrou por dia — o número que responde "isso é bom?" melhor que o
// total, porque um período de 6 dias e um de 30 não se comparam.
export function porDia(valor, de, ate) {
  const d = diasNoIntervalo(de, ate);
  return d > 0 ? r2(num(valor) / d) : 0;
}

// ── As compras do período que NÃO entraram no CMV ───────────────────────────
// A linha do CMV soma só as SEIS categorias de matéria-prima (§5). O que ficou
// de fora não sumiu — desceu para as Despesas —, mas some da vista: ninguém
// liga "Material de limpeza e higiene" no meio das despesas à compra que
// gerou aquela linha, e o Lucro Bruto fica alto sem que dê para dizer por quê.
//
// ⚠️ "A reclassificar" é um motivo DIFERENTE de "não é CMV", e tratá-los igual
// esconde trabalho pendente: a categoria antiga vira CMV assim que alguém a
// migrar em Compras → Reclassificar, e a de limpeza nunca vira.
export const MOTIVO_FORA_CMV = {
  reclassificar: 'categoria antiga, ainda não migrada',
  naoCmv: 'não é custo de mercadoria',
};

export function comprasForaDoCmv(foraCmvCats, chaveReclassificar = 'A reclassificar') {
  const linhas = Object.entries(foraCmvCats || {})
    .filter(([, v]) => num(v) > 0)
    .map(([cat, valor]) => ({
      cat,
      valor: r2(num(valor)),
      motivo: cat === chaveReclassificar ? 'reclassificar' : 'naoCmv',
    }))
    // Maior primeiro; o nome desempata para a lista não trocar de ordem entre
    // dois renders quando dois valores empatam.
    .sort((a, b) => b.valor - a.valor || a.cat.localeCompare(b.cat, 'pt-BR'));

  return {
    linhas,
    total: r2(linhas.reduce((s, l) => s + l.valor, 0)),
    aReclassificar: r2(linhas.filter((l) => l.motivo === 'reclassificar').reduce((s, l) => s + l.valor, 0)),
  };
}
