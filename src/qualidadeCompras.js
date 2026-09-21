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

// ── A FILA do que já entrou sem categoria ───────────────────────────────────
// A tela de Classificar já existia e listava as pendências na ordem em que
// apareceram nas compras. O que faltava era a ordem que diz POR ONDE COMEÇAR:
// são centenas de nomes, e a fila só encolhe se as primeiras linhas forem as
// que mais pesam no CMV.
//
// ⚠️ "PARADO" É O DINHEIRO, não a contagem. Um insumo comprado 18 vezes a
// R$ 2,00 muda menos o CMV que um comprado uma vez a R$ 1.800,00 — e é a
// contagem que a tela antiga sugeria, porque era o que ela mostrava.
//
// ⚠️ UMA LINHA POR NOME, nunca por compra: classificar é uma decisão só, e a
// mesma decisão repetida dez vezes é o que fazia a fila parecer intransponível.
//
// ⚠️ `palpiteDe` entra POR PARÂMETRO. Quem traduz nome em categoria é o
// `classificarItem` do `App.tsx` (regras de limpeza > dicionário > palavra-
// chave), e duplicar essa regra aqui criaria duas respostas para a mesma
// pergunta — a mesma razão pela qual `fold` também é parâmetro (§5).
export function filaSemCategoria(compras, { dicionario, palpiteDe, fold, ordem = 'valor', semCategoria = 'Outros' } = {}) {
  const dic = dicionario || {};
  const porNome = new Map();
  for (const c of compras || []) {
    if (c?.categoria !== semCategoria) continue;
    const chave = fold(normalizarTexto(c?.nomeProduto || ''));
    // Já ensinado: sai da fila mesmo que o histórico ainda mostre "Outros" —
    // é o mesmo recorte do `itensClassificacaoPendente`.
    if (!chave || dic[chave]) continue;
    const atual = porNome.get(chave) || { chave, nome: normalizarTexto(c.nomeProduto), compras: 0, valor: 0, ultima: '' };
    atual.compras += 1;
    atual.valor = r2(atual.valor + num(c.valor));
    if (String(c.data || '') > atual.ultima) atual.ultima = String(c.data || '');
    porNome.set(chave, atual);
  }

  const linhas = [...porNome.values()].map((l) => {
    const p = palpiteDe ? palpiteDe(l.nome) : null;
    // ⚠️ Palpite é só o que veio de REGRA ou PALAVRA-CHAVE. "Outros" com
    // origem "nenhuma" NÃO é palpite: tratá-lo como um mandaria a fila inteira
    // de volta para "Outros" num clique, que é exatamente como ela se formou.
    const temPalpite = !!(p && p.categoria && p.categoria !== semCategoria && p.origem !== 'nenhuma');
    return { ...l, palpite: temPalpite ? p.categoria : null, origemPalpite: temPalpite ? p.origem : null, temPalpite };
  });

  const porA_Z = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  if (ordem === 'nome') linhas.sort(porA_Z);
  else if (ordem === 'compras') linhas.sort((a, b) => b.compras - a.compras || porA_Z(a, b));
  else linhas.sort((a, b) => b.valor - a.valor || porA_Z(a, b));

  return {
    linhas,
    total: linhas.length,
    totalParado: r2(linhas.reduce((s, l) => s + l.valor, 0)),
    comPalpite: linhas.filter((l) => l.temPalpite).length,
  };
}

// ── A janela da régua do painel de conciliação ──────────────────────────────
// ⚠️ A RÉGUA NÃO PODE INCLUIR O PERÍODO QUE ESTÁ SENDO MEDIDO. Se incluísse, a
// compra exagerada entraria no próprio percentual histórico e SUAVIZARIA o
// alerta sobre ela mesma — quanto mais fora da curva o mês, menos ele
// apareceria. É a mesma armadilha da média contra a mediana do preço: a
// referência não pode ser contaminada pelo caso que ela julga.
//
// A janela termina na VÉSPERA do período e olha `dias` para trás.
export function janelaAnterior(de, dias = 180) {
  const t = Date.parse(`${de}T00:00:00Z`);
  if (!Number.isFinite(t) || !(dias > 0)) return null;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { de: iso(t - dias * 86400000), ate: iso(t - 86400000) };
}

// ── A REVISÃO NO ATO DA ENTRADA ─────────────────────────────────────────────
// As duas conferências que só servem ANTES de gravar. Depois de gravado, a
// categoria virou fila em "Sem categoria" e o preço virou linha na Auditoria —
// as duas telas existem porque isto não existia.
//
// ⚠️ A REVISÃO SÓ ABRE SE HOUVER O QUE REVISAR. Uma tela a mais em todo
// import, quase sempre vazia, é a tela que a pessoa aprende a fechar sem ler —
// e aí a vez em que ela tinha algo passa igual.
//
// ⚠️ E ela recebe TODOS os itens da compra, não só os que a conciliação não
// casou. A conciliação resolve "de que produto da Lista é esta marca"; isto
// resolve "em que categoria entra" e "o preço faz sentido". Um item que casou
// perfeitamente com o catálogo pode estar entrando com a unidade errada.
export function linhasDaRevisao(itens, { compras, fold, palpiteDe, desvio = DESVIO_PADRAO_PRECO, semCategoria = 'Outros' } = {}) {
  const linhas = [];
  const vistas = new Set();
  for (const it of itens || []) {
    const nome = normalizarTexto(it?.nome);
    if (!nome) continue;
    const chave = fold(nome);
    // Duas linhas do mesmo nome na mesma nota é uma decisão só — e duas
    // caixinhas para a mesma pergunta é como uma fica sem resposta.
    if (vistas.has(chave)) continue;
    vistas.add(chave);

    const categoria = it?.categoria || '';
    const p = palpiteDe ? palpiteDe(nome) : null;
    const temPalpite = !!(p && p.categoria && p.categoria !== semCategoria && p.origem !== 'nenhuma');
    const preco = conferirPreco(compras || [], {
      nomeProduto: nome, categoria, unidade: it?.unidade,
      quantidade: it?.quantidade, valor: it?.valorTotal ?? it?.valor,
    }, fold, desvio);

    linhas.push({
      chave, nome, categoria,
      unidade: it?.unidade || 'un',
      quantidade: num(it?.quantidade),
      valorTotal: r2(num(it?.valorTotal ?? it?.valor)),
      // ⚠️ "Sem categoria" É "Outros" TAMBÉM, e não é detalhe: nenhum caminho de
      // importação deixa o campo vazio — todos caem em "Outros" sozinhos. Pedir
      // só quando está vazio seria uma pergunta que nunca aparece.
      precisaCategoria: !categoria || categoria === semCategoria,
      palpite: temPalpite ? p.categoria : null,
      origemPalpite: temPalpite ? p.origem : null,
      precoFora: !preco.ok,
      preco,
    });
  }
  return linhas;
}

// Pode gravar? A categoria BLOQUEIA; o preço exige uma resposta, que pode ser
// "está certo".
//
// ⚠️ O ESCAPE DO PREÇO É DE PROPÓSITO. Insumo caro em quantidade pequena
// acontece, e bloqueio sem saída vira um campo que a pessoa aprende a
// contornar digitando qualquer coisa. O que NÃO existe é passar calado.
export function pendenciasDaRevisao(linhas, escolhas, { compras, fold, desvio = DESVIO_PADRAO_PRECO } = {}) {
  const esc = escolhas || {};
  const faltaCategoria = [];
  const precoNaoResolvido = [];
  for (const l of linhas || []) {
    const e = esc[l.chave] || {};
    const cat = e.categoria || (l.precisaCategoria ? '' : l.categoria);
    if (!cat || cat === 'Outros') {
      // "Outros" escolhido À MÃO passa: é uma decisão, e o item existe mesmo
      // (frete, brinde). O que não passa é o "Outros" que ninguém escolheu.
      if (e.categoria !== 'Outros') faltaCategoria.push(l.chave);
    }
    if (!l.precoFora) continue;
    if (e.precoOk) continue;
    // Corrigiu os números? Refaz a conta: dentro da faixa, resolvido.
    const refeito = conferirPreco(compras || [], {
      nomeProduto: l.nome, categoria: cat || l.categoria,
      unidade: e.unidade ?? l.unidade,
      quantidade: e.quantidade ?? l.quantidade,
      valor: e.valorTotal ?? l.valorTotal,
    }, fold, desvio);
    // ⚠️ APAGAR O NÚMERO NÃO RESOLVE. Sem preço legível `conferirPreco` devolve
    // `ok` (não há com o que comparar), então um campo vazio — ou um "7,69" que
    // não virou número — faria o aviso sumir e a compra entrar valendo zero. A
    // pendência só cai com número válido ou com o "está certo" explícito.
    const semPreco = !refeito.preco;
    if (!refeito.ok || semPreco) precoNaoResolvido.push(l.chave);
  }
  return {
    faltaCategoria, precoNaoResolvido,
    podeConfirmar: !faltaCategoria.length && !precoNaoResolvido.length,
  };
}

// O que a revisão devolve para a gravação: só o que MUDOU, chaveado por nome.
export function correcoesDaRevisao(linhas, escolhas) {
  const esc = escolhas || {};
  const out = {};
  for (const l of linhas || []) {
    const e = esc[l.chave];
    if (!e) continue;
    const c = { nome: l.nome };
    if (e.categoria && e.categoria !== l.categoria) c.categoria = e.categoria;
    if (e.unidade != null && e.unidade !== l.unidade) c.unidade = e.unidade;
    // ⚠️ Correção numérica só entra quando é um número POSITIVO: zero aqui é
    // quase sempre texto que não virou número ("7,69" lido por `Number`), e
    // gravar zero destrói o lançamento em vez de corrigi-lo.
    if (e.quantidade != null && num(e.quantidade) > 0 && num(e.quantidade) !== l.quantidade) c.quantidade = num(e.quantidade);
    if (e.valorTotal != null && num(e.valorTotal) > 0 && r2(num(e.valorTotal)) !== l.valorTotal) c.valorTotal = r2(num(e.valorTotal));
    // ⚠️ Mexeu na quantidade ou no valor? O UNITÁRIO tem que ser refeito. Sem
    // isso a compra guardaria 100 ml pelo unitário de 900 e a auditoria
    // apontaria o mesmo lançamento amanhã — corrigido na tela, errado no banco.
    if (c.quantidade != null || c.valorTotal != null) {
      const q = c.quantidade ?? l.quantidade;
      const v = c.valorTotal ?? l.valorTotal;
      if (q > 0) c.valorUnitario = r2(v / q);
    }
    if (Object.keys(c).length > 1) out[l.chave] = c;
  }
  return out;
}

// ── O que a tela de normalizar texto mostra ANTES de aplicar ────────────────
// ⚠️ A PRÉVIA E A APLICAÇÃO SAEM DA MESMA FUNÇÃO (`normalizarEncoding`). Duas
// contagens calculadas por caminhos diferentes divergem no dia em que uma
// muda, e a pessoa aprovaria um número para receber outro.
export function resumoDoEncoding(db, fold) {
  const r = normalizarEncoding(db);
  const colecoes = Object.keys(r).filter((k) => k !== 'camposTocados' && k !== 'quebrados');
  return {
    camposTocados: r.camposTocados,
    colecoes,
    quebrados: r.quebrados,
    // As categorias que hoje são duas e passam a ser uma. É a parte que muda
    // RELATÓRIO, não só texto: duas grafias somam em duas linhas da DRE.
    categoriasQueJuntam: duplicadasPorTexto((db?.compras || []).map((c) => c?.categoria), fold),
    catsListaQueJuntam: duplicadasPorTexto((db?.produtosLista || []).map((p) => p?.cat), fold),
    mudanca: r,
  };
}
