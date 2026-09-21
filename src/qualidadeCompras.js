// Qualidade do dado que entra por Compras — Fase 1.
// ============================================================================
// Quatro coisas estragam o CMV e a ficha técnica em silêncio, e as quatro
// nascem no momento da ENTRADA, não no relatório onde aparecem:
//
//   1. o mesmo fornecedor cadastrado três vezes, com grafias diferentes;
//   2. o insumo que cai em "Outros" porque ninguém foi perguntado;
//   3. o preço por unidade errado por uma ordem de grandeza (o óleo de soja a
//      R$ 769,00/100 ml), que passa porque R$ 76,90 num campo é plausível;
//   4. o acento corrompido, que parte uma categoria em duas.
//
// Tudo aqui é FUNÇÃO PURA e vive fora do `App.tsx` pela mesma razão do
// `folhaRh.js`: erro de conciliação não aparece na tela onde foi cometido —
// aparece no CMV, meses depois, como "margem apertada".

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Texto ───────────────────────────────────────────────────────────────────
// ⚠️ NFC ANTES de qualquer comparação. "proteína" digitado no Mac vem em NFD
// (o "i" e o til são dois code points) e no Windows em NFC (um só). As duas
// strings são visualmente idênticas, `===` diz que são diferentes, e o
// resultado é uma categoria partida em duas que ninguém consegue juntar
// olhando a tela.
export function normalizarTexto(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

// O caractere de substituição (U+FFFD) é o rastro de um byte lido com a
// codificação errada. Ele NÃO é consertável — a informação já se perdeu —,
// então o que dá para fazer é ACHAR, não adivinhar o que era.
export const temEncodingQuebrado = (s) => /�/.test(String(s ?? ''));

// ── TAREFA 1 · Fornecedor ───────────────────────────────────────────────────
// Só os dígitos. O CNPJ aparece "58.564.214/0001-70" na tela e "58564214000170"
// no XML — comparar a string formatada faria o mesmo fornecedor não casar
// consigo mesmo. É a mesma lição do `foldChave` da NF-e.
export function soDigitos(s) {
  return String(s ?? '').replace(/\D+/g, '');
}

export function cnpjValido(s) {
  const d = soDigitos(s);
  // 14 dígitos e não todos iguais. Não confere o dígito verificador de
  // propósito: recusar um CNPJ real mal digitado no cadastro antigo deixaria o
  // fornecedor sem chave nenhuma, o que é pior que uma chave imperfeita.
  return d.length === 14 && !/^(\d)\1{13}$/.test(d);
}

// Semelhança entre dois nomes, 0 a 1 — Dice sobre bigramas.
//
// ⚠️ Bigrama, não distância de edição: "COMERCIAL SANTA LUCIA LTDA" e "SANTA
// LUCIA COMERCIAL" têm quase todos os pares de letras em comum e uma distância
// de edição enorme, porque as palavras trocaram de lugar. Fornecedor é
// exatamente o campo onde isso acontece.
export function semelhanca(a, b) {
  const x = bigramas(a);
  const y = bigramas(b);
  if (!x.size || !y.size) return a === b ? 1 : 0;
  let comuns = 0;
  for (const g of x) if (y.has(g)) comuns++;
  return (2 * comuns) / (x.size + y.size);
}

function bigramas(s) {
  const t = String(s ?? '').replace(/[^a-z0-9]+/gi, ' ').trim();
  const out = new Set();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

// Palavras que aparecem em quase todo fornecedor e por isso não distinguem
// nenhum. Sem tirá-las, "LIDER LTDA" e "SENDAS LTDA" ganham semelhança de
// graça pelo sufixo.
const RUIDO_RAZAO = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'cia', 'comercio',
  'comercial', 'distribuidora', 'distribuicao', 'industria', 'e', 'de', 'da', 'do', 'dos', 'das']);

export function nucleoDoNome(nome, fold) {
  const t = fold(normalizarTexto(nome)).split(/[^a-z0-9]+/).filter(Boolean);
  const uteis = t.filter((p) => !RUIDO_RAZAO.has(p));
  // Sobrando nada, o nome ERA só ruído — volta o original, senão dois
  // fornecedores chamados "Comercial Ltda" casariam com semelhança 1.
  return (uteis.length ? uteis : t).join(' ');
}

export const LIMIAR_NOME_PADRAO = 0.82;

// Acha o fornecedor que já existe, antes de criar mais um.
//
// ⚠️ O CNPJ DECIDE SOZINHO quando existe dos dois lados — ele é identificador
// fiscal, não palpite, e vence qualquer diferença de grafia ("SENDAS
// DISTRIBUIDORA S/A LJ190" e "Sendas Distribuidora SA" são a mesma empresa).
//
// ⚠️ E quando o CNPJ existe nos dois e é DIFERENTE, o nome parecido NÃO conta:
// duas filiais têm razão social quase igual e CNPJ distinto, e juntá-las
// misturaria a compra de duas lojas num fornecedor só.
export function acharFornecedor(fornecedores, { cnpj, nome }, fold, limiar = LIMIAR_NOME_PADRAO) {
  const lista = fornecedores || [];
  const cnpjBusca = cnpjValido(cnpj) ? soDigitos(cnpj) : '';

  if (cnpjBusca) {
    const porCnpj = lista.find((f) => soDigitos(f?.cnpj) === cnpjBusca);
    if (porCnpj) return { fornecedor: porCnpj, motivo: 'cnpj', score: 1 };
  }

  const alvo = nucleoDoNome(nome, fold);
  if (!alvo) return null;

  let melhor = null;
  for (const f of lista) {
    // Filial com CNPJ próprio: o nome parecido não pode juntar as duas.
    if (cnpjBusca && cnpjValido(f?.cnpj) && soDigitos(f.cnpj) !== cnpjBusca) continue;
    const s = semelhanca(alvo, nucleoDoNome(f?.nome, fold));
    if (!melhor || s > melhor.score) melhor = { fornecedor: f, motivo: 'nome', score: r2(s * 100) / 100 };
  }
  if (melhor && melhor.score >= limiar) {
    // ⚠️ Nome exato entra direto; parecido é SUGESTÃO, nunca gravação
    // automática. A tela decide, porque "Frigorífico Boi Forte" e
    // "Frigorífico Boi Bom" passam de 0,82 e são dois fornecedores.
    melhor.exato = melhor.score >= 0.999;
    return melhor;
  }
  return null;
}

// Junta duplicados num só e REATRIBUI o histórico.
//
// ⚠️ Não basta apagar o registro: `compras[].fornecedor` guarda o NOME, não o
// id, e `materiasPrimas[].fornecedores` é uma lista de nomes. Apagando o
// cadastro sem reescrever esses dois, o histórico fica apontando para um
// fornecedor que não existe mais — e o filtro por fornecedor devolve vazio
// para compras que estão lá.
export function mesclarFornecedores(db, { canonicoId, idsRemovidos }) {
  const lista = db?.fornecedores || [];
  const canonico = lista.find((f) => f?.id === canonicoId);
  const remover = new Set((idsRemovidos || []).filter((id) => id && id !== canonicoId));
  if (!canonico || !remover.size) return null;

  const nomesAntigos = new Set(lista.filter((f) => remover.has(f.id)).map((f) => normalizarTexto(f?.nome)).filter(Boolean));
  const nomeNovo = normalizarTexto(canonico.nome);
  const agora = new Date().toISOString();
  let comprasTocadas = 0;
  let insumosTocados = 0;

  const compras = (db?.compras || []).map((c) => {
    if (!nomesAntigos.has(normalizarTexto(c?.fornecedor))) return c;
    comprasTocadas++;
    return { ...c, fornecedor: nomeNovo, atualizadoEm: agora };
  });

  const materiasPrimas = (db?.materiasPrimas || []).map((m) => {
    const fs = m?.fornecedores || [];
    if (!fs.some((f) => nomesAntigos.has(normalizarTexto(f)))) return m;
    insumosTocados++;
    const novos = [...new Set(fs.map((f) => (nomesAntigos.has(normalizarTexto(f)) ? nomeNovo : normalizarTexto(f))).filter(Boolean))];
    return { ...m, fornecedores: novos, atualizadoEm: agora };
  });

  // O canônico herda o CNPJ de quem tiver um, se ele mesmo não tiver — é o
  // dado que impede a duplicata de voltar na próxima importação.
  const doadorCnpj = lista.find((f) => remover.has(f.id) && cnpjValido(f?.cnpj));
  const fornecedores = lista
    .filter((f) => !remover.has(f.id))
    .map((f) => (f.id !== canonicoId ? f
      : { ...f, cnpj: cnpjValido(f.cnpj) ? f.cnpj : (doadorCnpj?.cnpj || f.cnpj || ''), atualizadoEm: agora }));

  return { fornecedores, compras, materiasPrimas, comprasTocadas, insumosTocados, removidos: [...remover] };
}

// Os grupos que a tela de administração lista.
export function gruposDeFornecedor(fornecedores, fold, limiar = LIMIAR_NOME_PADRAO) {
  const lista = (fornecedores || []).filter((f) => f?.id);
  const usados = new Set();
  const grupos = [];

  // Primeiro por CNPJ: é certeza, e tira esses do jogo do nome.
  const porCnpj = new Map();
  for (const f of lista) {
    if (!cnpjValido(f.cnpj)) continue;
    const k = soDigitos(f.cnpj);
    if (!porCnpj.has(k)) porCnpj.set(k, []);
    porCnpj.get(k).push(f);
  }
  for (const [cnpj, fs] of porCnpj) {
    if (fs.length < 2) continue;
    fs.forEach((f) => usados.add(f.id));
    grupos.push({ motivo: 'cnpj', chave: cnpj, score: 1, itens: fs });
  }

  for (let i = 0; i < lista.length; i++) {
    if (usados.has(lista[i].id)) continue;
    const base = nucleoDoNome(lista[i].nome, fold);
    if (!base) continue;
    const juntos = [lista[i]];
    for (let j = i + 1; j < lista.length; j++) {
      if (usados.has(lista[j].id)) continue;
      // CNPJ diferente nos dois = filiais. Não agrupa.
      if (cnpjValido(lista[i].cnpj) && cnpjValido(lista[j].cnpj)
        && soDigitos(lista[i].cnpj) !== soDigitos(lista[j].cnpj)) continue;
      if (semelhanca(base, nucleoDoNome(lista[j].nome, fold)) >= limiar) juntos.push(lista[j]);
    }
    if (juntos.length < 2) continue;
    juntos.forEach((f) => usados.add(f.id));
    grupos.push({ motivo: 'nome', chave: base, score: limiar, itens: juntos });
  }

  // CNPJ primeiro (certeza antes de palpite), depois o grupo maior.
  return grupos.sort((a, b) => (a.motivo === b.motivo ? b.itens.length - a.itens.length : a.motivo === 'cnpj' ? -1 : 1));
}

// ── TAREFA 4 · Preço por unidade-base ───────────────────────────────────────
// g e ml viram a unidade grande ANTES de comparar. R$ 7,69 por 100 g e
// R$ 76,90 por kg são o mesmo preço; sem normalizar, o segundo parece dez
// vezes o primeiro e o alerta dispararia em todo item comprado em grama.
const BASE = {
  g: { base: 'kg', fator: 0.001 }, grama: { base: 'kg', fator: 0.001 }, gramas: { base: 'kg', fator: 0.001 },
  kg: { base: 'kg', fator: 1 }, quilo: { base: 'kg', fator: 1 },
  mg: { base: 'kg', fator: 0.000001 },
  ml: { base: 'l', fator: 0.001 }, l: { base: 'l', fator: 1 }, lt: { base: 'l', fator: 1 },
  litro: { base: 'l', fator: 1 }, litros: { base: 'l', fator: 1 },
};

export function precoPorUnidadeBase({ valorTotal, quantidade, unidade }) {
  const q = num(quantidade);
  const v = num(valorTotal);
  if (!(q > 0) || !(v > 0)) return null;
  const u = String(unidade || 'un').trim().toLowerCase();
  const conv = BASE[u];
  if (!conv) return { preco: r2(v / q), unidade: u || 'un', base: u || 'un' };
  const qBase = q * conv.fator;
  if (!(qBase > 0)) return null;
  return { preco: r2(v / qBase), unidade: u, base: conv.base };
}

export const DESVIO_PADRAO_PRECO = 3;

// A referência é a MEDIANA das compras anteriores do mesmo insumo.
//
// ⚠️ Mediana, não média: uma compra já lançada com a unidade errada (o óleo a
// R$ 769/100 ml) puxaria a média para cima e passaria a ABSOLVER o próximo
// erro igual. A mediana ignora o outlier — é a mesma lição da taxa do plano do
// iFood.
export function referenciaDePreco(compras, { nomeProduto, categoria }, fold) {
  const alvo = fold(normalizarTexto(nomeProduto));
  const precos = [];
  const daCategoria = [];
  for (const c of compras || []) {
    const p = precoPorUnidadeBase({ valorTotal: c?.valor, quantidade: c?.quantidade, unidade: c?.unidade });
    if (!p) continue;
    if (alvo && fold(normalizarTexto(c?.nomeProduto)) === alvo) precos.push({ ...p });
    else if (categoria && c?.categoria === categoria) daCategoria.push({ ...p });
  }
  const mesmaBase = (arr, base) => arr.filter((x) => x.base === base).map((x) => x.preco).sort((a, b) => a - b);
  return {
    // A tela escolhe a base; devolvemos as duas amostras cruas.
    doItem: precos,
    daCategoria,
    mediana(base) {
      const a = mesmaBase(precos, base);
      const b = a.length ? a : mesmaBase(daCategoria, base);
      if (!b.length) return null;
      const meio = Math.floor(b.length / 2);
      return { valor: b.length % 2 ? b[meio] : r2((b[meio - 1] + b[meio]) / 2), n: b.length, de: a.length ? 'item' : 'categoria' };
    },
  };
}

export function conferirPreco(compras, item, fold, desvio = DESVIO_PADRAO_PRECO) {
  const p = precoPorUnidadeBase({ valorTotal: item?.valor ?? item?.valorTotal, quantidade: item?.quantidade, unidade: item?.unidade });
  if (!p) return { ok: true, motivo: 'sem preço para conferir' };
  const ref = referenciaDePreco(compras, { nomeProduto: item?.nomeProduto ?? item?.nome, categoria: item?.categoria }, fold).mediana(p.base);
  // ⚠️ Sem referência NÃO se bloqueia. O primeiro cadastro de um insumo não
  // tem com o que ser comparado, e travar ali ensinaria a ignorar o aviso.
  if (!ref) return { ok: true, preco: p, motivo: 'primeiro preço deste insumo' };
  const razao = ref.valor > 0 ? p.preco / ref.valor : 0;
  const fora = razao >= desvio || (razao > 0 && razao <= 1 / desvio);
  return {
    ok: !fora,
    preco: p,
    referencia: ref,
    razao: r2(razao * 100) / 100,
    acima: razao >= desvio,
    motivo: fora
      ? `${p.preco > ref.valor ? 'acima' : 'abaixo'} da mediana (${ref.n} compra(s) ${ref.de === 'item' ? 'deste insumo' : 'da categoria'})`
      : 'dentro do esperado',
  };
}

// O mesmo teste rodado sobre o que JÁ está gravado.
export function auditarPrecos(db, fold, desvio = DESVIO_PADRAO_PRECO) {
  const compras = db?.compras || [];
  const achados = [];
  for (const c of compras) {
    const r = conferirPreco(compras.filter((o) => o !== c), c, fold, desvio);
    if (r.ok || !r.preco) continue;
    achados.push({
      id: c.id, data: c.data, nome: c.nomeProduto, categoria: c.categoria,
      unidade: c.unidade, quantidade: num(c.quantidade), valor: num(c.valor),
      preco: r.preco.preco, base: r.preco.base, mediana: r.referencia.valor, razao: r.razao, acima: r.acima,
    });
  }
  // Pior primeiro: quem está mais longe da mediana é quem mais distorce o CMV.
  return achados.sort((a, b) => Math.max(b.razao, 1 / (b.razao || 1)) - Math.max(a.razao, 1 / (a.razao || 1)));
}

// ── TAREFA 5 · Encoding ─────────────────────────────────────────────────────
// ⚠️ SÓ NORMALIZA, nunca "conserta" o U+FFFD. Onde o byte se perdeu não há o
// que recuperar, e chutar a letra criaria um nome novo que não casa com nada.
// Esses ficam listados para a pessoa decidir.
const CAMPOS_TEXTO = {
  materiasPrimas: ['nome', 'categoria', 'unidade'],
  compras: ['nomeProduto', 'categoria', 'fornecedor', 'unidade'],
  produtosLista: ['nome', 'cat'],
  fornecedores: ['nome'],
  produtosProducao: ['nome'],
};

export function normalizarEncoding(db) {
  const saida = {};
  let camposTocados = 0;
  const quebrados = [];

  for (const [colecao, campos] of Object.entries(CAMPOS_TEXTO)) {
    const arr = db?.[colecao];
    if (!Array.isArray(arr)) continue;
    let mudou = false;
    const novo = arr.map((reg) => {
      if (!reg) return reg;
      let cópia = reg;
      for (const campo of campos) {
        const antes = reg[campo];
        if (typeof antes !== 'string') continue;
        if (temEncodingQuebrado(antes)) quebrados.push({ colecao, id: reg.id, campo, valor: antes });
        const depois = normalizarTexto(antes);
        if (depois === antes) continue;
        if (cópia === reg) cópia = { ...reg };
        cópia[campo] = depois;
        camposTocados++;
        mudou = true;
      }
      return cópia;
    });
    if (mudou) saida[colecao] = novo;
  }
  return { ...saida, camposTocados, quebrados };
}

// Os pares que só são dois registros por causa do texto.
export function duplicadasPorTexto(valores, fold) {
  const porChave = new Map();
  for (const v of valores || []) {
    const t = normalizarTexto(v);
    if (!t) continue;
    const k = fold(t);
    if (!porChave.has(k)) porChave.set(k, new Set());
    porChave.get(k).add(t);
  }
  return [...porChave.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([chave, s]) => ({ chave, variantes: [...s].sort() }));
}

// ── TAREFA 6 · Compra × consumo estimado, por categoria ─────────────────────
// ⚠️ Isto NÃO é o consumo teórico da ficha (`consumoTeorico.js`). Ele precisa
// de ficha completa; este painel existe justamente porque ela não está pronta,
// e usa o único dado que sempre existe: o que foi comprado e o que foi vendido.
//
// ⚠️ E por isso ele NÃO é uma medida de perda — é uma medida de DESCOMPASSO.
// Compra é irregular (a nota chega num dia e abastece a semana) e venda é
// diária: num recorte curto a diferença é calendário, não desperdício. É a
// mesma armadilha do CMV vazio da DRE, e a tela tem que dizer isso.
export const MARGEM_ALERTA_PADRAO = 20;

export function conciliacaoPorCategoria({ compras, receita, pctPorCategoria, de, ate, margem = MARGEM_ALERTA_PADRAO }) {
  const dentro = (compras || []).filter((c) => c?.data && c.data >= de && c.data <= ate);
  const compradoPorCat = new Map();
  for (const c of dentro) {
    const cat = normalizarTexto(c?.categoria) || 'Outros';
    compradoPorCat.set(cat, r2((compradoPorCat.get(cat) || 0) + num(c.valor)));
  }

  const cats = new Set([...compradoPorCat.keys(), ...Object.keys(pctPorCategoria || {})]);
  const linhas = [];
  for (const cat of cats) {
    const comprado = r2(compradoPorCat.get(cat) || 0);
    const pct = num(pctPorCategoria?.[cat]);
    // Sem percentual cadastrado não se inventa estimativa: a linha aparece com
    // o comprado e um "sem referência", em vez de um alerta sobre um número
    // que ninguém definiu.
    const estimado = pct > 0 ? r2((num(receita) * pct) / 100) : null;
    const dif = estimado == null ? null : r2(comprado - estimado);
    const pctDif = estimado > 0 ? r2(((comprado - estimado) / estimado) * 100) : null;
    linhas.push({
      cat, comprado, pct, estimado, dif, pctDif,
      alerta: pctDif != null && pctDif >= margem,
      semReferencia: estimado == null,
    });
  }
  return {
    linhas: linhas.sort((a, b) => (b.dif ?? -Infinity) - (a.dif ?? -Infinity) || b.comprado - a.comprado),
    totalComprado: r2(linhas.reduce((s, l) => s + l.comprado, 0)),
    totalEstimado: r2(linhas.reduce((s, l) => s + (l.estimado || 0), 0)),
    receita: r2(num(receita)),
  };
}

// O percentual histórico de cada categoria sobre a receita — a régua do painel,
// tirada do próprio histórico em vez de um número chutado.
//
// ⚠️ A janela tem que ser LONGA (meses), pela mesma razão: compra irregular
// contra venda diária só se encontra no tempo.
export function pctHistoricoPorCategoria({ compras, vendas, de, ate }) {
  const receita = r2((vendas || [])
    .filter((v) => v?.data && v.data >= de && v.data <= ate)
    .reduce((s, v) => s + num(v?.total), 0));
  if (!(receita > 0)) return { receita: 0, pct: {}, dias: 0 };

  const pct = {};
  for (const c of compras || []) {
    if (!c?.data || c.data < de || c.data > ate) continue;
    const cat = normalizarTexto(c?.categoria) || 'Outros';
    pct[cat] = r2((pct[cat] || 0) + num(c.valor));
  }
  for (const k of Object.keys(pct)) pct[k] = r2((pct[k] / receita) * 100);
  return { receita, pct };
}

// ── O ponto ÚNICO por onde fornecedor entra ─────────────────────────────────
// ⚠️ Eram QUATRO cópias de `f.nome.toLowerCase()===nome.toLowerCase()` — uma
// em cada caminho de importação (manual, Cupom IA, XML, SEFAZ). Quatro cópias
// da mesma regra é como uma delas fica para trás: a do Cupom IA nem gravava o
// CNPJ que a IA já tinha lido, então todo cupom do mesmo fornecedor entrava
// sem a chave que evitaria a duplicata seguinte.
export function garantirFornecedor(fornecedores, { nome, cnpj, endereco }, fold, uid, limiar) {
  const lista = fornecedores || [];
  const nomeLimpo = normalizarTexto(nome);
  if (!nomeLimpo) return { fornecedores: lista, fornecedor: null, criado: false, sugestao: null };

  const achado = acharFornecedor(lista, { cnpj, nome: nomeLimpo }, fold, limiar);

  // Por CNPJ, ou por nome IDÊNTICO, reaproveita direto.
  if (achado && (achado.motivo === 'cnpj' || achado.exato)) {
    const atualizado = (!cnpjValido(achado.fornecedor.cnpj) && cnpjValido(cnpj))
      ? { ...achado.fornecedor, cnpj: normalizarTexto(cnpj), atualizadoEm: new Date().toISOString() }
      : achado.fornecedor;
    return {
      // ⚠️ Grava o CNPJ que faltava no cadastro antigo. É essa gravação que faz
      // a dedução por CNPJ passar a valer para o histórico que já existia.
      fornecedores: atualizado === achado.fornecedor ? lista : lista.map((f) => (f.id === atualizado.id ? atualizado : f)),
      fornecedor: atualizado, criado: false, motivo: achado.motivo, sugestao: null,
    };
  }

  // Parecido mas não igual: CRIA, e devolve a sugestão para a tela oferecer a
  // mesclagem. ⚠️ Juntar sozinho aqui seria decidir, com um palpite de nome,
  // que duas empresas são uma — e o histórico das duas iria junto.
  const novo = {
    id: uid(), nome: nomeLimpo,
    cnpj: cnpjValido(cnpj) ? normalizarTexto(cnpj) : '',
    endereco: normalizarTexto(endereco) || '',
    criadoEm: new Date().toISOString(),
  };
  return {
    fornecedores: [...lista, novo], fornecedor: novo, criado: true,
    sugestao: achado ? { fornecedor: achado.fornecedor, score: achado.score } : null,
  };
}

// ── TAREFA 3 · o insumo comprado nasce com item na Lista ────────────────────
// ⚠️ `produtosLista` é COMPARTILHADO entre Confraria e Seama (§1/§3 do
// CLAUDE.md). Item criado aqui numa compra da Confraria APARECE na Seama —
// é como a Lista já funciona hoje, não uma regressão introduzida aqui. Se um
// dia a Lista virar por empresa, este é um dos pontos a revisitar.
//
// ⚠️ E o item nasce com `atualizadoEm`: sem o carimbo, o primeiro save da vida
// dele já nasce perdendo a fusão (a armadilha do §3).
export function criarItemDaLista(mp, uid, agora = new Date().toISOString()) {
  return {
    id: uid(),
    nome: normalizarTexto(mp?.nome),
    cat: mp?.categoria || '',
    unidade: mp?.unidade || 'un',
    mpVinculados: [mp?.id].filter(Boolean),
    criadoEm: agora,
    atualizadoEm: agora,
    criadoPor: 'compra',
  };
}
