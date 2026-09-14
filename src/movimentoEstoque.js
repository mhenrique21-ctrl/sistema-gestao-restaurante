// Movimentação manual de estoque: entrada, saída, ajuste e PRODUÇÃO.
// ============================================================================
// Vale pra insumo e pra produto acabado — os dois vivem em `materiasPrimas`,
// que é "item com saldo". Criar uma coleção só pros produtos do cardápio seria
// a quarta lista de produtos do sistema, e é o que infla o app.
//
// PRODUÇÃO é a única operação com dois lados: entra o produto e SAEM os insumos
// da ficha. Fazer isso num lugar só, com id de grupo, é o que permite conferir
// e desfazer a coisa inteira depois — separado, um lado some e ninguém percebe.

import { consumoTeorico, converterQtd } from './consumoTeorico.js';

export const OPERACOES = ['producao', 'entrada', 'saida', 'ajuste'];

const r3 = (n) => Math.round(n * 1000) / 1000;

// O que a produção de `qtd` unidades de um produto consome. Reaproveita o
// consumoTeorico (que já divide pelo rendimento da ficha e tem teste pra isso)
// em vez de repetir a divisão — repetir é como as duas contas divergem.
//
// Devolve também o que NÃO deu pra converter: por decisão do dono, produção
// nunca é bloqueada por cadastro incompleto, então o que falta vira aviso.
export function insumosDaProducao(ficha, qtd, materiasPrimas) {
  if (!ficha || !(qtd > 0)) return { linhas: [], avisos: [] };
  const { linhas } = consumoTeorico([{ nome: ficha.nome, qtd, total: 0 }], () => ficha);
  const saidas = [];
  const avisos = [];
  for (const l of linhas) {
    const mp = l.mpId ? (materiasPrimas || []).find((m) => m.id === l.mpId) : null;
    if (!mp) { avisos.push(`"${l.nome}" não está no cadastro de insumos — não foi baixado`); continue; }
    const q = converterQtd(l.qtd, l.unidade, mp.unidade || 'un');
    if (q == null) {
      avisos.push(`"${mp.nome}": ficha em "${l.unidade}" e insumo em "${mp.unidade}" — sem conversão, não foi baixado`);
      continue;
    }
    saidas.push({ mp, qtd: r3(q), unidade: mp.unidade || 'un', custo: parseFloat(mp.ultimoValor) || 0 });
  }
  return { linhas: saidas, avisos };
}

// Aplica uma operação sobre movEstoque + materiasPrimas e devolve os dois novos.
// Não grava nada: quem chama decide (e é o que torna a prévia da tela possível,
// mostrando exatamente o que vai acontecer antes de acontecer).
export function aplicarMovimento({ movEstoque, materiasPrimas, item, operacao, quantidade, motivo, data, ficha, agora, uid }) {
  if (!item) throw new Error('Item não informado');
  if (!OPERACOES.includes(operacao)) throw new Error(`Operação inválida: ${operacao}`);
  const qtd = parseFloat(quantidade);
  if (!Number.isFinite(qtd) || qtd < 0) throw new Error('Quantidade inválida');

  const mps = [...(materiasPrimas || [])];
  const movs = [...(movEstoque || [])];
  const idx = mps.findIndex((m) => m.id === item.id);
  if (idx < 0) throw new Error('Item não está no cadastro');
  const antes = parseFloat(mps[idx].estoqueAtual) || 0;

  // Ajuste informa o saldo CONTADO, não a diferença — é como a contagem física
  // funciona, e é o que o ajuste manual do Estoque já faz. Misturar os dois
  // sentidos no mesmo campo é erro clássico de inventário.
  const depois = operacao === 'ajuste' ? qtd : (operacao === 'saida' ? antes - qtd : antes + qtd);
  const delta = r3(depois - antes);

  const grupoId = uid();
  const mov = {
    id: uid(), grupoId, mpId: item.id, mpNome: item.nome,
    tipo: operacao === 'producao' ? 'entrada' : operacao,
    quantidade: Math.abs(delta), unidade: item.unidade || 'un',
    custo: parseFloat(item.ultimoValor) || 0,
    data, descricao: motivo || (operacao === 'producao' ? 'Produção' : operacao),
    origem: operacao === 'producao' ? 'producao' : 'manual',
    criadoEm: agora,
  };
  mps[idx] = { ...mps[idx], estoqueAtual: r3(depois), atualizadoEm: agora };
  movs.unshift(mov);

  const avisos = [];
  if (operacao === 'producao') {
    const { linhas, avisos: av } = insumosDaProducao(ficha, qtd, mps);
    avisos.push(...av);
    // Por decisão do dono: produzir NUNCA é bloqueado por falta de ficha ou de
    // cadastro. Travar a cozinha porque o cadastro está incompleto é pior que
    // registrar a produção e avisar o que não foi baixado.
    if (!ficha) avisos.push(`"${item.nome}" não tem ficha técnica — nenhum insumo foi baixado`);
    for (const s of linhas) {
      const i = mps.findIndex((m) => m.id === s.mp.id);
      if (i < 0) continue;
      const ant = parseFloat(mps[i].estoqueAtual) || 0;
      // Saldo pode ficar negativo: mostrar a inconsistência é melhor que
      // escondê-la travando o registro do que já aconteceu na cozinha.
      mps[i] = { ...mps[i], estoqueAtual: r3(ant - s.qtd), atualizadoEm: agora };
      movs.unshift({
        id: uid(), grupoId, mpId: s.mp.id, mpNome: s.mp.nome, tipo: 'saida',
        quantidade: s.qtd, unidade: s.unidade, custo: s.custo, data,
        descricao: `Produção de ${qtd} ${item.unidade || 'un'} — ${item.nome}`,
        origem: 'producao', criadoEm: agora,
      });
    }
  }

  return { movEstoque: movs, materiasPrimas: mps, grupoId, delta, antes, depois: r3(depois), avisos };
}

// Distribui a venda de N unidades entre as MARCAS de um mesmo produto.
// ============================================================================
// "Suco de abacaxi" pode ser comprado de duas marcas — dois insumos, um produto
// só no cardápio. O saldo mora nas marcas; a venda não sabe (nem precisa saber)
// qual saiu da geladeira.
//
// Tira primeiro de quem tem MAIS saldo e cascateia. Sem isso, uma marca ficaria
// muito negativa enquanto a outra seguia cheia — e nenhuma das duas refletiria
// a prateleira.
//
// qtdUnidades vem em unidade de VENDA (lata, garrafa). Cada marca converte pela
// própria embalagem: 12 latas podem ser 1 caixa numa marca e 2 packs de 6 noutra.
export function distribuirEntreMarcas(mps, qtdUnidades) {
  const lista = (mps || []).filter(Boolean);
  if (!lista.length || !(qtdUnidades > 0)) return [];
  const emb = (m) => parseFloat(m.unidadesPorEmbalagem) || 1;
  const dispUn = (m) => Math.max(0, (parseFloat(m.estoqueAtual) || 0) * emb(m));

  const ord = [...lista].sort((a, b) => dispUn(b) - dispUn(a));
  const totalDisp = ord.reduce((s, m) => s + dispUn(m), 0);
  const out = [];
  let restante = qtdUnidades;

  ord.forEach((mp, i) => {
    if (restante <= 0.0001) return;
    // Ninguém tem saldo: tudo na primeira, deixando negativo. "Vendeu sem ter
    // registrado compra" é a informação honesta — espalhar o negativo entre as
    // marcas só faria parecer que todas estão erradas.
    const usarUn = totalDisp <= 0
      ? (i === 0 ? restante : 0)
      : (i === ord.length - 1 ? restante : Math.min(restante, dispUn(mp)));
    if (usarUn <= 0) return;
    restante -= usarUn;
    out.push({ mp, unidades: Math.round(usarUn * 1000) / 1000, qtd: Math.round((usarUn / emb(mp)) * 1000) / 1000 });
  });
  return out;
}
