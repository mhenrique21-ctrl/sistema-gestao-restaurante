// Tipo do insumo: matéria-prima de produção, revenda, ou consumo interno.
// ============================================================================
// É a marcação que decide o que acontece com o insumo quando algo é vendido:
//
//   producao  sai pela FICHA TÉCNICA do produto vendido (polvilho, queijo)
//   revenda   o que se vende É o que se compra (água, refrigerante, cerveja)
//   interno   não sai por venda (detergente, saco de lixo)
//
// Mora aqui, fora do App.tsx, por dois motivos: a regra automática precisa de
// teste (ela decide sozinha o destino da maioria dos insumos, e um engano aqui
// só apareceria no estoque semanas depois), e a mesma regra é consultada pela
// baixa e pela tela.

export const TIPOS_INSUMO = ['producao', 'revenda', 'interno'];

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
  'proteinas': 'producao',
  'hortifruti': 'producao',
  'laticinios': 'producao',
  'mercearia/secos': 'producao',
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
export function tipoDoInsumo(mapa, mp) {
  const marcado = (mapa || {})[fold(mp?.nome)];
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
    // em "saiu 3,33 caixas". Insumo de produção sai em g/kg pela ficha, que
    // tem a própria conversão.
    if (tipo === 'revenda') {
      const porEmb = parseFloat(mp.unidadesPorEmbalagem) || 1;
      const un = fold(mp.unidade);
      const unitaria = ['un', 'und', 'unid', 'unidade', ''].includes(un);
      if (porEmb === 1 && !unitaria) semConversao.push(mp);
    }
  }
  return { semTipo, semConversao };
}
