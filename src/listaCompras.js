// Categoria e LOCAL de compra — dois campos que eram um só.
// ============================================================================
// A Lista misturava "o que o item é" com "onde ele se compra", e a mistura não
// foi descuido: era o único caminho que a tela oferecia.
//
//   • `listaCompras[].rua` guardava ora um corredor ("Rua 7", dentro do Açaí ou
//     do Sendas), ora o nome de uma loja inteira ("Santa Lucia");
//   • `db.ruaCatMap` DERIVA a rua da categoria (`getRuaDaCat`). Então quem
//     precisava arquivar um item por onde compra só tinha um jeito: criar uma
//     CATEGORIA com o nome da loja — e a rua vinha junto. Foi assim que
//     "queijo minas" e "cia do sorveteiro" viraram categoria;
//   • e desde a Fase 1 de Compras, `criarItemDaLista` grava a categoria
//     CONTÁBIL no mesmo campo: todo insumo auto-criado entra como "Proteínas"
//     ou "Mercearia/Secos". O campo tem três origens diferentes.
//
// Decisão do dono (21/09/2026): a Lista **mantém taxonomia própria** — ela
// organiza o corredor, não mede CMV (§5, e a lição da Contagem: categoria
// contábil não serve para andar pela loja com o celular) — mas vira **fechada**,
// e o "onde" sai dela para um campo próprio.

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// ── A taxonomia FECHADA da Lista ────────────────────────────────────────────
// ⚠️ DEZ, NÃO DEZENOVE. As 19 antigas se sobrepunham tanto que arquivar virava
// adivinhação: "carnes" e "proteína" são a mesma coisa; "grãos", "farinhas",
// "massas", "molhos", "temperos" e "latas, caixas e temperos" são todas a
// mercearia. Categoria que se sobrepõe não organiza nada — ela só multiplica o
// lugar onde o item pode estar, e foi parte do motivo de alguém preferir criar
// uma categoria nova a procurar a certa.
//
// ⚠️ A ordem é a do CORREDOR, não alfabética: é nela que a lista é lida
// enquanto se anda pela loja.
export const CATS_LISTA = [
  'Hortifruti',
  'Açougue e frios',
  'Laticínios',
  'Mercearia',
  'Bebidas',
  'Doces e sobremesas',
  'Café e complementos',
  'Descartáveis e embalagens',
  'Limpeza e higiene',
  'Outros',
];

// As 19 antigas → as 10. Tradução na LEITURA, como o `LEGADO` do
// `tipoInsumo.js`: nenhum item precisa ser reescrito para continuar aparecendo
// no lugar certo.
const DE_19 = {
  'carnes': 'Açougue e frios', 'proteina': 'Açougue e frios',
  'hortifruti': 'Hortifruti',
  'laticinios': 'Laticínios',
  'graos': 'Mercearia', 'mercearia basica': 'Mercearia', 'farinhas': 'Mercearia',
  'massas': 'Mercearia', 'molhos': 'Mercearia', 'temperos': 'Mercearia',
  'latas, caixas e temperos': 'Mercearia',
  'bebidas': 'Bebidas',
  'chocolates': 'Doces e sobremesas', 'polpas': 'Doces e sobremesas',
  'cafes e complementos': 'Café e complementos',
  'descartaveis': 'Descartáveis e embalagens', 'embalagens': 'Descartáveis e embalagens',
  'material de limpeza': 'Limpeza e higiene',
  'outros': 'Outros',
};

// ⚠️ A CATEGORIA CONTÁBIL TAMBÉM ENTRA AQUI, porque Compras grava nela desde a
// Fase 1. Sem esta tradução, todo insumo auto-criado cairia em "Outros" e a
// fila de revisão nasceria cheia de item que o sistema já sabia classificar.
const DE_CONTABIL = {
  'proteinas': 'Açougue e frios',
  'hortifruti': 'Hortifruti',
  'laticinios': 'Laticínios',
  'mercearia/secos': 'Mercearia',
  'bebidas para revenda': 'Bebidas',
  'descartaveis de consumo do produto': 'Descartáveis e embalagens',
  'material de limpeza e higiene': 'Limpeza e higiene',
  'outros': 'Outros',
};

// Devolve a categoria fechada, ou `null` quando não sabe — e **não chuta**.
// ⚠️ Chutar "Outros" esconderia o trabalho: o que não casa é exatamente o que
// precisa da fila de revisão (é onde estão os nomes de loja e os produtos que
// alguém cadastrou como categoria).
export function categoriaFechada(valor) {
  const v = fold(valor);
  if (!v) return null;
  const direta = CATS_LISTA.find((c) => fold(c) === v);
  if (direta) return direta;
  return DE_CONTABIL[v] || DE_19[v] || null;
}

// ── "Rua 7" é corredor; "Santa Lucia" é loja ────────────────────────────────
// ⚠️ O NÚMERO É O QUE SEPARA OS DOIS, e é a única pista confiável que o dado
// antigo tem. Tudo que é só número (com ou sem a palavra rua/corredor) é
// posição DENTRO de um local; o resto é o nome do local.
//
// ⚠️ E o corredor NÃO diz de qual loja ele é: "Rua 7" existe no Açaí e no
// Sendas. Por isso a migração de um corredor **exige escolher o local à mão** —
// adivinhar mandaria o item para a loja errada, e a lista sairia impossível de
// seguir sem ninguém entender por quê.
const RE_CORREDOR = /^(?:rua|corredor|corr\.?)?\s*n?[.º°]?\s*(\d{1,3})$/i;

export function classificarRua(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return { tipo: 'vazio' };
  const m = v.match(RE_CORREDOR);
  if (m) return { tipo: 'corredor', numero: String(Number(m[1])), precisaLocal: true };
  return { tipo: 'local', nome: v };
}

// ── Os locais de compra ─────────────────────────────────────────────────────
export function novoLocal({ id, nome, temCorredor = false, corredores = [], ativo = true }) {
  return {
    id, nome: String(nome || '').trim(), temCorredor: !!temCorredor,
    corredores: (corredores || []).map((c) => String(c).trim()).filter(Boolean),
    ativo: ativo !== false, atualizadoEm: new Date().toISOString(),
  };
}

// ⚠️ INATIVAR, NUNCA EXCLUIR (pedido do dono). Item antigo aponta para o local
// pelo id: apagando o cadastro, o histórico passa a mostrar "local
// desconhecido" — e a lista arquivada deixa de dizer onde aquilo foi comprado.
export function locaisAtivos(locais) {
  return (locais || []).filter((l) => l && l.ativo !== false);
}

export function localPorId(locais, id) {
  return (locais || []).find((l) => l?.id === id) || null;
}

// ── O plano de migração ─────────────────────────────────────────────────────
// Lê o que existe HOJE e diz o que vira o quê. Não grava nada: é o que a tela
// mostra antes de a pessoa confirmar — mesma divisão de papéis da
// Compras → Reclassificar.
//
// ⚠️ NADA É DECIDIDO SOZINHO AQUI. Corredor não sabe de qual loja é, e uma
// categoria fora da taxonomia tanto pode ser uma loja ("cia do sorveteiro")
// quanto um produto que alguém cadastrou como categoria ("bombom"). As duas
// viram PERGUNTA, não palpite.
export function planoDeMigracao({ listaCompras = [], produtosLista = [], listaRuas = [], listaCategorias = [] } = {}) {
  const itens = [...listaCompras, ...produtosLista];

  // Os valores de "rua" que existem de fato, com quantos itens dependem de cada.
  const usoRua = new Map();
  for (const i of itens) {
    const v = String(i?.rua ?? '').trim();
    if (!v) continue;
    usoRua.set(v, (usoRua.get(v) || 0) + 1);
  }
  for (const r of listaRuas) {
    const v = String(r ?? '').trim();
    if (v && !usoRua.has(v)) usoRua.set(v, 0);
  }

  const locais = [];
  const corredores = [];
  for (const [valor, n] of usoRua) {
    const c = classificarRua(valor);
    if (c.tipo === 'corredor') corredores.push({ valor, numero: c.numero, itens: n });
    else if (c.tipo === 'local') locais.push({ valor, itens: n });
  }

  // As categorias em uso, e quais delas a taxonomia fechada não reconhece.
  const usoCat = new Map();
  for (const i of itens) {
    const v = String(i?.categoria ?? i?.cat ?? '').trim();
    if (!v) continue;
    usoCat.set(v, (usoCat.get(v) || 0) + 1);
  }
  for (const c of listaCategorias) {
    const v = String(c ?? '').trim();
    if (v && !usoCat.has(v)) usoCat.set(v, 0);
  }

  const categoriasOk = [];
  const categoriasPendentes = [];
  const nomesDeLocal = new Set([...locais.map((l) => fold(l.valor))]);
  for (const [valor, n] of usoCat) {
    const alvo = categoriaFechada(valor);
    if (alvo) { categoriasOk.push({ valor, alvo, itens: n }); continue; }
    // ⚠️ Categoria com o MESMO nome de uma rua é a assinatura do problema: a
    // pessoa escreveu a loja nos dois lugares. Isso não decide nada sozinho —
    // só sobe a linha na fila, com o motivo escrito.
    categoriasPendentes.push({ valor, itens: n, pareceLocal: nomesDeLocal.has(fold(valor)) });
  }

  const porItens = (a, b) => b.itens - a.itens || String(a.valor).localeCompare(String(b.valor), 'pt-BR');
  return {
    locais: locais.sort(porItens),
    corredores: corredores.sort((a, b) => Number(a.numero) - Number(b.numero)),
    categoriasOk: categoriasOk.sort(porItens),
    categoriasPendentes: categoriasPendentes.sort(porItens),
    totalItens: itens.length,
  };
}

// ── O saldo que a Lista mostra ──────────────────────────────────────────────
// ⚠️ "TEM NA LOJA" ERA DIGITADO À MÃO (`estoqueQtd` no item) e nunca mais era
// conferido: o número que aparecia podia ter sido escrito três semanas antes.
// Decisão do dono (21/09/2026): passa a vir do saldo REAL.
//
// ⚠️ SEM VÍNCULO NÃO SE MOSTRA NADA. O produto da Lista chega ao saldo por
// `mpVinculados` → `materiasPrimas[].estoqueAtual`; sem esse elo, qualquer
// número seria invenção — e um campo vazio que a pessoa possa preencher à mão
// reintroduz exatamente o dado velho que estamos tirando.
export function saldoDoItem({ nome, produtosLista = [], materiasPrimas = [] }) {
  const alvo = fold(nome);
  if (!alvo) return null;
  const prod = produtosLista.find((p) => fold(p?.nome) === alvo);
  const ids = prod?.mpVinculados || [];
  if (!ids.length) return null;
  const marcas = ids.map((id) => materiasPrimas.find((m) => m?.id === id)).filter(Boolean);
  if (!marcas.length) return null;
  const total = marcas.reduce((s, m) => s + (Number(m.estoqueAtual) || 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    unidade: prod?.unidadeBase || marcas[0]?.unidade || 'un',
    marcas: marcas.length,
  };
}

// ── Da Lista para Compras ───────────────────────────────────────────────────
// ⚠️ AS DUAS TAXONOMIAS MEDEM COISAS DIFERENTES (§5): a da Lista organiza o
// corredor, a de Compras mede CMV. Mandar "Açougue e frios" direto para o campo
// de Compras criaria uma categoria contábil nova — a mesma poluição que esta
// fase limpou, só que do outro lado. Esta é a ponte, e ela é explícita.
//
// ⚠️ "Doces e sobremesas" e "Café e complementos" caem em Mercearia/Secos
// porque é isso que eles são contabilmente: não existe linha de CMV para doce.
const PARA_CONTABIL = {
  'Hortifruti': 'Hortifruti',
  'Açougue e frios': 'Proteínas',
  'Laticínios': 'Laticínios',
  'Mercearia': 'Mercearia/Secos',
  'Bebidas': 'Bebidas para revenda',
  'Doces e sobremesas': 'Mercearia/Secos',
  'Café e complementos': 'Mercearia/Secos',
  'Descartáveis e embalagens': 'Descartáveis de consumo do produto',
  'Limpeza e higiene': 'Material de limpeza e higiene',
  'Outros': 'Outros',
};

// ⚠️ Sem categoria na Lista, devolve "Outros" — e "Outros" é justamente o que a
// revisão de entrada de Compras (Fase 1) obriga alguém a resolver antes de
// gravar. O item chega no carrinho pedindo decisão, em vez de entrar calado
// numa categoria que ninguém escolheu.
export function contabilDaLista(catLista) {
  return PARA_CONTABIL[catLista] || 'Outros';
}
