// Produção do dia: o que a cozinha fez, o que saiu do estoque e QUANTO CUSTOU.
// ============================================================================
// A baixa de insumo por produção já existia em movimentoEstoque.js. O que não
// existia era o custo: o produto entrava no estoque com o `ultimoValor` do
// próprio cadastro — que num item feito na cozinha nunca foi preenchido, porque
// ele não vem de compra. Resultado: Saldo Estoque mostrava 25 produtos e
// R$ 0,00, a Margem por Produto não tinha custo pra comparar e o CMV não
// fechava pelo lado do produzido.
//
// O custo unitário sai daqui: soma o que os insumos custaram e divide pelas
// unidades BOAS.
//
// ⚠️ DIVIDE PELAS BOAS, NÃO PELO PRODUZIDO (decisão do dono, 15/09/2026).
// Assou 50 e 3 queimaram: os insumos de 50 saíram do estoque, mas só 47 entram.
// Dividir por 47 joga o custo das 3 perdidas em cima das que sobraram — é como
// se apura custo de produção, e faz a perda aparecer no preço em vez de sumir.
// Dividir por 50 daria um custo unitário que nenhuma unidade real tem.
//
// ⚠️ A PERDA É REGISTRADA À PARTE, num movimento próprio. Embutida só no custo,
// ninguém consegue medir a quebra do mês por produto — que é metade do motivo
// de ter esse controle.

import { insumosDaProducao } from './movimentoEstoque.js';

const r3 = (n) => Math.round(n * 1000) / 1000;
const cent = (v) => Math.round((v || 0) * 100) / 100;
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null || v === '') return 0;
  const t = String(v).trim().replace(/\s/g, '');
  const n = /,/.test(t) ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};

// Uma linha da folha do dia: o produto, quanto se fez, quanto se perdeu, o que
// sai do estoque e o custo que sai disso.
export function calcularLinha({ item, ficha, produzido, perda = 0, materiasPrimas }) {
  const qProd = num(produzido);
  const qPerda = Math.max(num(perda), 0);
  const boas = r3(qProd - qPerda);
  const avisos = [];

  if (!(qProd > 0)) return null;                 // linha em branco NÃO é zero
  if (qPerda > qProd) {
    avisos.push(`Perda (${qPerda}) maior que o produzido (${qProd}) — corrija antes de registrar`);
  }

  // Os insumos saem pelo PRODUZIDO, não pelas boas: a farinha das 3 que
  // queimaram saiu do estoque do mesmo jeito.
  const { linhas, avisos: avIns } = insumosDaProducao(ficha, qProd, materiasPrimas);
  avisos.push(...avIns);
  if (!ficha) avisos.push(`"${item?.nome}" não tem ficha técnica — nenhum insumo baixa e o custo fica em branco`);

  const custoTotal = cent(linhas.reduce((s, l) => s + l.qtd * (l.custo || 0), 0));
  // Sem ficha ou sem insumo casado, custo é NULL — não zero. Zero diria "este
  // bolo não custou nada", que é justamente a mentira que existe hoje.
  const custoUnit = (boas > 0 && linhas.length) ? custoTotal / boas : null;

  return {
    itemId: item?.id, nome: item?.nome, unidade: item?.unidade || 'un',
    produzido: qProd, perda: qPerda, boas,
    insumos: linhas, custoTotal, custoUnitario: custoUnit,
    avisos, bloqueado: qPerda > qProd,
  };
}

export function calcularProducaoDia({ db, linhas, resolverFicha }) {
  const mps = db?.materiasPrimas || [];
  const calc = (linhas || []).map((l) => {
    const item = mps.find((m) => m.id === l.itemId);
    if (!item) return null;
    return calcularLinha({
      item, ficha: resolverFicha ? resolverFicha(item) : null,
      produzido: l.produzido, perda: l.perda, materiasPrimas: mps,
    });
  }).filter(Boolean);

  // Saldo previsto de cada insumo somando TODAS as linhas: dois produtos que
  // usam a mesma farinha precisam mostrar o saldo depois dos dois, não depois
  // de cada um — senão a tela promete estoque que não vai existir.
  const porInsumo = new Map();
  for (const c of calc) {
    for (const i of c.insumos) {
      const cur = porInsumo.get(i.mp.id) || { mp: i.mp, qtd: 0, unidade: i.unidade };
      cur.qtd = r3(cur.qtd + i.qtd);
      porInsumo.set(i.mp.id, cur);
    }
  }
  const insumos = [...porInsumo.values()].map((i) => {
    const antes = num(i.mp.estoqueAtual);
    return { ...i, antes, depois: r3(antes - i.qtd), negativo: antes - i.qtd < 0 };
  }).sort((a, b) => String(a.mp.nome).localeCompare(String(b.mp.nome), 'pt-BR'));

  return {
    linhas: calc,
    insumos,
    totalProdutos: calc.length,
    totalBoas: r3(calc.reduce((s, c) => s + c.boas, 0)),
    totalPerdas: r3(calc.reduce((s, c) => s + c.perda, 0)),
    custoTotal: cent(calc.reduce((s, c) => s + c.custoTotal, 0)),
    avisos: calc.flatMap((c) => c.avisos.map((a) => ({ nome: c.nome, aviso: a }))),
    bloqueado: calc.some((c) => c.bloqueado),
  };
}

// Aplica a folha inteira. Um grupoId só para o dia: entrada do produto, saída
// dos insumos e perda saem juntos ou não saem — separados, um lado some e
// ninguém percebe (mesma razão do grupoId da produção avulsa).
export function aplicarProducaoDia({ db, calculo, data, agora, uid, motivo }) {
  const mps = [...(db?.materiasPrimas || [])];
  const movs = [...(db?.movEstoque || [])];
  const grupoId = uid();
  const desc = motivo || `Produção do dia ${data}`;

  for (const c of calculo.linhas) {
    const i = mps.findIndex((m) => m.id === c.itemId);
    if (i < 0) continue;
    const antes = num(mps[i].estoqueAtual);

    movs.unshift({ id: uid(), grupoId, mpId: c.itemId, mpNome: c.nome, tipo: 'entrada',
      quantidade: c.boas, unidade: c.unidade, custo: c.custoUnitario ?? 0,
      data, descricao: desc, origem: 'producao_dia', criadoEm: agora });

    // O custo unitário passa a valer para o produto. É o que enche o valor do
    // estoque de produzidos (hoje R$ 0,00) e dá base à Margem por Produto.
    // Só sobrescreve quando FOI calculado: sem ficha, manter o que havia é
    // melhor que zerar o custo que alguém pode ter posto à mão.
    mps[i] = {
      ...mps[i], estoqueAtual: r3(antes + c.boas),
      ...(c.custoUnitario != null ? { ultimoValor: cent(c.custoUnitario) } : {}),
      atualizadoEm: agora,
    };

    if (c.perda > 0) {
      // Movimento próprio, não embutido na entrada: é assim que dá pra somar a
      // quebra do mês por produto.
      movs.unshift({ id: uid(), grupoId, mpId: c.itemId, mpNome: c.nome, tipo: 'perda',
        quantidade: c.perda, unidade: c.unidade, custo: c.custoUnitario ?? 0,
        data, descricao: `Perda na produção — ${c.nome}`, origem: 'producao_dia',
        criadoEm: agora });
    }
  }

  for (const ins of calculo.insumos) {
    const i = mps.findIndex((m) => m.id === ins.mp.id);
    if (i < 0) continue;
    const antes = num(mps[i].estoqueAtual);
    // Saldo pode ficar negativo de propósito: mostrar a inconsistência é melhor
    // que travar o registro do que já aconteceu na cozinha.
    mps[i] = { ...mps[i], estoqueAtual: r3(antes - ins.qtd), atualizadoEm: agora };
    movs.unshift({ id: uid(), grupoId, mpId: ins.mp.id, mpNome: ins.mp.nome, tipo: 'saida',
      quantidade: ins.qtd, unidade: ins.unidade, custo: num(ins.mp.ultimoValor),
      data, descricao: desc, origem: 'producao_dia', criadoEm: agora });
  }

  return { materiasPrimas: mps, movEstoque: movs, grupoId };
}

// Fecha o pedido da cozinha com o que foi produzido (decisão do dono).
// ⚠️ Só fecha quando a quantidade BATE. Produziu menos? Fica `parcial`, com o
// que falta — fechar assim mesmo sumiria com a parte não feita, e ninguém
// lembraria dela.
export function baixarPedidos({ pedidos, produzidoPorItem }) {
  const feito = new Map(Object.entries(produzidoPorItem || {}));
  return (pedidos || []).map((ped) => {
    if (!ped || ped.status === 'atendido') return ped;
    let mexeu = false;
    const itens = (ped.itens || []).map((it) => {
      const chave = it.produtoId || it.id || it.nome;
      const qFeita = num(feito.get(chave));
      if (!(qFeita > 0)) return it;
      mexeu = true;
      const pedida = num(it.quantidade);
      const jaFeito = num(it.produzido) + qFeita;
      return { ...it, produzido: r3(jaFeito), atendido: jaFeito >= pedida - 0.001 };
    });
    if (!mexeu) return ped;
    const todos = itens.every((it) => it.atendido || !(num(it.quantidade) > 0));
    return { ...ped, itens, status: todos ? 'atendido' : 'parcial' };
  });
}
