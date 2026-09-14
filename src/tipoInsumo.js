// Tipo do insumo: matéria-prima de produção, revenda, ou consumo interno.
// ============================================================================
// É a marcação que decide o que acontece com o insumo quando algo é vendido:
//
//   insumo     comprado, vira ingrediente          farinha, queijo em kg
//   revenda    comprado e vendido como está        água, coca, cerveja
//   produzido  feito na cozinha, tem ficha         bolo, pão de queijo
//   dose       porção vendida à parte              fatia de queijo, bacon
//   interno    não sai por venda                   detergente, saco de lixo
//
// O QUE CADA UM FAZ AO SER VENDIDO — a regra inteira em três linhas:
//
//   revenda    baixa o PRÓPRIO saldo
//   produzido  baixa o PRÓPRIO saldo (o insumo já saiu quando foi produzido;
//              baixar de novo aqui contaria a farinha duas vezes)
//   dose       baixa o INSUMO pela ficha, porque não se estoca "fatia de
//              queijo" — se estoca queijo, e a fatia é tirada na hora
//
// Mora aqui, fora do App.tsx, por dois motivos: a regra automática precisa de
// teste (ela decide sozinha o destino da maioria dos insumos, e um engano aqui
// só apareceria no estoque semanas depois), e a mesma regra é consultada pela
// baixa e pela tela.

export const TIPOS_INSUMO = ['insumo', 'revenda', 'produzido', 'dose', 'interno'];

// "producao" foi o nome do ingrediente comprado numa versão anterior, marcada
// em produção no mesmo dia. Traduzir aqui é mais barato e mais seguro que uma
// migração de dados: quem já marcou não perde o trabalho, e o valor antigo
// deixa de existir sozinho conforme as telas regravam.
const LEGADO = { producao: 'insumo' };

// Padrão por CATEGORIA CONTÁBIL da compra (as 8 fixas). Só entram aqui as
// categorias cuja resposta é inequívoca — "Outros" não tem resposta honesta e
// fica de fora de propósito, pra virar pendência na tela em vez de um palpite.
//
// "Descartáveis de consumo do produto" (copo, guardanapo) sai junto com a venda
// mas não está na ficha técnica de ninguém: tratar como produção faria a baixa
// procurar uma ficha que não existe e o insumo nunca baixaria. Fica interno,
// que é o comportamento honesto — controlado pela contagem, não pela venda.
const PADRAO_POR_CATEGORIA = {
  'bebidas para revenda': 'revenda',
  'proteinas': 'insumo',
  'hortifruti': 'insumo',
  'laticinios': 'insumo',
  'mercearia/secos': 'insumo',
  'material de limpeza e higiene': 'interno',
  'descartaveis de consumo do produto': 'interno',
};

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

export function tipoPadraoPorCategoria(categoria) {
  return PADRAO_POR_CATEGORIA[fold(categoria)] || null;
}

// Resolve o tipo de um insumo. A marcação manual SEMPRE vence: a regra por
// categoria é um palpite bom, mas o dono é quem sabe que aquele chocolate é
// revenda e não ingrediente.
//
// Devolve {tipo, origem} — a origem é o que permite à tela mostrar "você marcou"
// x "veio da categoria", e listar como pendente só quem não tem nenhum dos dois.
// Chave de identidade do item. Produto importado do Eclética tem CÓDIGO, e o
// código é o que não muda: renomear "Agua Mineral" para "Água Mineral 500ml" no
// Gestão não pode perder a marcação nem desvincular a venda. Insumo comprado
// não tem código, e aí o nome normalizado continua sendo a chave — é a mesma
// regra do resto do sistema (foldNome).
export function chaveTipo(mp) {
  const cod = String(mp?.codigoEcletica || '').trim();
  return cod ? `cod:${cod}` : fold(mp?.nome);
}

export function tipoDoInsumo(mapa, mp) {
  // Tenta o código primeiro e cai no nome depois: quem foi marcado antes de o
  // código existir continua valendo, sem migração de dado.
  const m = mapa || {};
  const bruto = m[chaveTipo(mp)] ?? m[fold(mp?.nome)];
  const marcado = LEGADO[bruto] || bruto;
  if (marcado && TIPOS_INSUMO.includes(marcado)) return { tipo: marcado, origem: 'marcado' };
  const padrao = tipoPadraoPorCategoria(mp?.categoria);
  if (padrao) return { tipo: padrao, origem: 'categoria' };
  return { tipo: null, origem: 'nenhum' };
}

// Insumos que precisam de atenção na tela de Insumos. Separados porque são
// perguntas diferentes e cada uma tem consequência própria:
//
//   semTipo       o insumo fica fora de qualquer baixa por venda
//   semConversao  a comparação vendido × comprado sai errada, não vazia — e
//                 número errado com cara de certo é pior que número ausente
export function pendenciasDeInsumo(mapa, materiasPrimas) {
  const semTipo = [];
  const semConversao = [];
  for (const mp of materiasPrimas || []) {
    if (!mp?.nome) continue;
    const { tipo } = tipoDoInsumo(mapa, mp);
    if (!tipo) semTipo.push(mp);
    // Conversão só faz sentido pra revenda: é o que traduz "vendi 40 latas"
    // em "saiu 3,33 caixas". Insumo sai em g/kg pela ficha, que tem a própria
    // conversão, e produzido/dose não são comprados em embalagem.
    if (tipo === 'revenda') {
      const porEmb = parseFloat(mp.unidadesPorEmbalagem) || 1;
      const un = fold(mp.unidade);
      const unitaria = ['un', 'und', 'unid', 'unidade', ''].includes(un);
      if (porEmb === 1 && !unitaria) semConversao.push(mp);
    }
  }
  return { semTipo, semConversao };
}

// O que a VENDA de um item faz com o estoque. Separado do tipo porque é a
// pergunta que as telas realmente fazem, e escrever a regra num lugar só é o
// que impede a farinha de ser contada duas vezes.
export function baixaDaVenda(tipo) {
  if (tipo === 'revenda' || tipo === 'produzido') return 'proprio';
  if (tipo === 'dose') return 'ficha';
  return 'nenhum';           // insumo e interno não são vendidos
}

// Itens que aparecem na tela de Saldo, e em qual ordem de importância.
// Insumo e interno ficam de fora do filtro "produtos" porque quem abre Saldo
// depois de importar o cardápio quer ver o cardápio, não a despensa.
export const ehProdutoVendido = (tipo) => ['revenda', 'produzido', 'dose'].includes(tipo);
