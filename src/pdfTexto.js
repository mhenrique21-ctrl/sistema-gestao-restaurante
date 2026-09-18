// Tirar as LINHAS de texto de um PDF, sem dependência nenhuma.
// ============================================================================
// O relatório de pedidos também sai em PDF, e quem exporta nem sempre tem a
// opção de planilha à mão. O que esta parte faz é genérico — não conhece
// relatório nenhum: devolve linhas de células, no mesmo formato que o
// `planilha.js` devolve, e quem entende de relatório continua sendo o
// `relatorioPlataforma.js`.
//
// ⚠️ PDF NÃO TEM LINHA NEM COLUNA. Ele tem pedaços de texto com uma POSIÇÃO na
// página. A tabela que a gente enxerga é um efeito das coordenadas. Por isso:
//   • mesma altura (Y) ⇒ mesma linha
//   • dentro da linha, a ordem é pela posição horizontal (X)
// Ler na ordem em que os pedaços aparecem no arquivo devolveria a tabela
// embaralhada — e embaralhada de um jeito plausível, que é o pior.
//
// ⚠️ Um PDF cuja tabela não é texto (página escaneada, print de tela) não tem
// o que extrair. `lerPdf` devolve vazio e quem chamou avisa — em vez de
// entregar meia tabela.

const WIN_ANSI_EXTRA = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
  0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ',
  0x9E: 'ž', 0x9F: 'Ÿ',
};
// ⚠️ A térmica do agente falava CP850; o PDF fala WinAnsi. São tabelas
// DIFERENTES, e a faixa 0x80–0x9F é justamente onde elas discordam. Fora dela
// WinAnsi é igual ao Latin-1, então só essa faixa precisa de tabela.
const deWinAnsi = (bytes) => bytes.map((b) => WIN_ANSI_EXTRA[b] || String.fromCharCode(b)).join('');

// ── Strings do PDF ──────────────────────────────────────────────────────────
// Literal: (texto), com escapes e PARÊNTESES ANINHADOS — `(Taxa (R$))` é uma
// string só. Contar o primeiro ")" como fim cortaria o texto no meio.
export function lerStringLiteral(s, i) {
  let nivel = 1;
  const bytes = [];
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
      if (oct) { bytes.push(parseInt(oct[0], 8)); i += 1 + oct[0].length; continue; }
      const mapa = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (n === '\n') { i += 2; continue; }               // quebra escapada some
      bytes.push(mapa[n] ?? n.charCodeAt(0));
      i += 2; continue;
    }
    if (c === '(') nivel++;
    if (c === ')') { nivel--; if (!nivel) return { texto: deWinAnsi(bytes), fim: i + 1 }; }
    bytes.push(c.charCodeAt(0));
    i += 1;
  }
  return { texto: deWinAnsi(bytes), fim: i };
}

// Hexadecimal: <0054 0061> (UTF-16) ou <546178> (um byte por caractere).
export function lerStringHex(s, i) {
  const fim = s.indexOf('>', i);
  const cru = s.slice(i, fim < 0 ? s.length : fim).replace(/[^0-9a-fA-F]/g, '');
  const hex = cru.length % 2 ? `${cru}0` : cru;           // ímpar: completa com 0
  let texto = '';
  if (/^feff/i.test(hex)) {
    for (let k = 4; k + 3 < hex.length + 1; k += 4) texto += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
  } else {
    const bytes = [];
    for (let k = 0; k + 1 < hex.length + 1; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16));
    texto = deWinAnsi(bytes);
  }
  return { texto, fim: (fim < 0 ? s.length : fim) + 1 };
}

// ── O fluxo de conteúdo ─────────────────────────────────────────────────────
// Só os operadores de texto interessam. Tudo que é desenho (linha da tabela,
// fundo, logo) é ignorado de propósito.
export function lerConteudo(txt) {
  const itens = [];
  let x = 0, y = 0, linhaX = 0, linhaY = 0, avanco = 12;
  const pilha = [];
  let i = 0;

  const empilhar = (v) => { pilha.push(v); if (pilha.length > 8) pilha.shift(); };
  const num = (n) => parseFloat(pilha[pilha.length - n]) || 0;
  const guardar = (texto) => { if (texto.trim()) itens.push({ x, y, texto }); };

  while (i < txt.length) {
    const c = txt[i];
    if (c === '(') { const r = lerStringLiteral(txt, i + 1); empilhar(r.texto); i = r.fim; continue; }
    if (c === '<' && txt[i + 1] !== '<') { const r = lerStringHex(txt, i + 1); empilhar(r.texto); i = r.fim; continue; }
    if (c === '[') {
      // TJ: [(Pedi) -20 (do)] — os pedaços são UMA palavra partida pelo
      // espacejamento. Tratar cada um como célula quebraria todo cabeçalho.
      const fecha = txt.indexOf(']', i);
      const dentro = txt.slice(i + 1, fecha < 0 ? txt.length : fecha);
      let j = 0, junto = '';
      while (j < dentro.length) {
        if (dentro[j] === '(') { const r = lerStringLiteral(dentro, j + 1); junto += r.texto; j = r.fim; continue; }
        if (dentro[j] === '<') { const r = lerStringHex(dentro, j + 1); junto += r.texto; j = r.fim; continue; }
        j += 1;
      }
      empilhar(junto);
      i = (fecha < 0 ? txt.length : fecha) + 1;
      continue;
    }
    const op = txt.slice(i).match(/^(BT|ET|T\*|TJ|Tj|TD|Td|Tm|TL|'|")/);
    if (op) {
      const o = op[1];
      if (o === 'BT') { x = y = linhaX = linhaY = 0; }
      else if (o === 'Td') { linhaX += num(2); linhaY += num(1); x = linhaX; y = linhaY; }
      else if (o === 'TD') { avanco = -num(1); linhaX += num(2); linhaY += num(1); x = linhaX; y = linhaY; }
      else if (o === 'Tm') { linhaX = num(2); linhaY = num(1); x = linhaX; y = linhaY; }
      else if (o === 'TL') { avanco = num(1); }
      else if (o === 'T*') { linhaY -= avanco; x = linhaX; y = linhaY; }
      else if (o === 'Tj' || o === 'TJ') { guardar(String(pilha[pilha.length - 1] ?? '')); }
      else if (o === "'" ) { linhaY -= avanco; x = linhaX; y = linhaY; guardar(String(pilha[pilha.length - 1] ?? '')); }
      else if (o === '"') { linhaY -= avanco; x = linhaX; y = linhaY; guardar(String(pilha[pilha.length - 1] ?? '')); }
      pilha.length = 0;
      i += o.length;
      continue;
    }
    const n = txt.slice(i).match(/^-?\d*\.?\d+/);
    if (n) { empilhar(n[0]); i += n[0].length; continue; }
    i += 1;
  }
  return itens;
}

// ⚠️ A MESMA LINHA NÃO TEM O MESMO Y EXATO. Cada célula é posicionada por
// conta própria e sobra fração de ponto; exigindo igualdade, uma tabela de 20
// linhas viraria 60. A tolerância é meia altura de linha.
export function agruparEmLinhas(itens, tolerancia = 3) {
  const ordenados = [...itens].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const linhas = [];
  let atual = null;
  for (const it of ordenados) {
    if (!atual || Math.abs(atual.y - it.y) > tolerancia) {
      atual = { y: it.y, celulas: [] };
      linhas.push(atual);
    }
    atual.celulas.push(it);
  }
  return linhas.map((l) => l.celulas.sort((a, b) => a.x - b.x).map((c) => c.texto.trim()));
}

// ── O arquivo ───────────────────────────────────────────────────────────────
const bin = (u8, ini, fim) => {
  let s = '';
  for (let i = ini; i < fim; i++) s += String.fromCharCode(u8[i]);
  return s;
};

async function inflar(u8) {
  if (typeof DecompressionStream !== 'function') return null;
  for (const formato of ['deflate', 'deflate-raw']) {
    try {
      const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream(formato));
      const buf = new Uint8Array(await new Response(st).arrayBuffer());
      return bin(buf, 0, buf.length);
    } catch { /* tenta o próximo */ }
  }
  return null;
}

export async function lerPdf(buffer) {
  const u8 = new Uint8Array(buffer);
  const bruto = bin(u8, 0, u8.length);
  if (!bruto.startsWith('%PDF')) throw new Error('isto não é um PDF');

  // ⚠️ O comprimento declarado (/Length) costuma ser uma REFERÊNCIA a outro
  // objeto ("/Length 12 0 R"), que exigiria resolver a tabela de referências
  // cruzadas. Achar o `endstream` é o que funciona em arquivo de qualquer
  // gerador — inclusive nos que trazem o xref quebrado.
  const partes = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(bruto))) {
    const ini = m.index + m[0].length;
    let fim = bruto.indexOf('endstream', ini);
    if (fim < 0) break;
    // ⚠️ A QUEBRA DE LINHA ANTES DE `endstream` NÃO É DADO. Ela é separador, e
    // o descompactador a lê como lixo depois do fim do fluxo — e falha. O
    // sintoma é o pior possível: nenhum erro, só um PDF que "não tem texto".
    const corte = fim;
    if (bruto[fim - 1] === '\n') fim -= 1;
    if (bruto[fim - 1] === '\r') fim -= 1;
    const dados = u8.subarray(ini, fim);
    const texto = await inflar(dados);
    partes.push(texto ?? bin(u8, ini, fim));
    re.lastIndex = corte;
  }
  // PDF sem stream nenhum é raro, mas um gerador simples pode pôr o conteúdo
  // solto: vale tentar o arquivo inteiro antes de dizer que não tem texto.
  if (!partes.length) partes.push(bruto);

  const linhas = [];
  for (const parte of partes) {
    if (!/\b(Tj|TJ)\b/.test(parte)) continue;      // stream de imagem ou fonte
    linhas.push(...agruparEmLinhas(lerConteudo(parte)));
  }
  return linhas.filter((l) => l.some((c) => c !== ''));
}
