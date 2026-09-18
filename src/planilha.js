// Ler planilha (.xlsx e .csv) sem dependência nenhuma.
// ============================================================================
// ⚠️ Por que não instalar uma biblioteca: o app inteiro roda de um arquivo
// servido pela VPS e é aberto no celular do operador. Uma biblioteca de xlsx
// dobra o tamanho do bundle para uma tela que se usa uma vez por dia. O
// `png.js` do impressora-agent já tinha tomado essa decisão pelo mesmo motivo,
// e aqui o custo é menor ainda: um .xlsx é um ZIP com dois XML dentro, e o
// navegador já sabe descomprimir (`DecompressionStream`).
//
// ⚠️ `DecompressionStream('deflate-raw')` é o que faz isto funcionar sem
// dependência. Existe em Chrome/Edge 80+, Safari 16.4+, Firefox 113+ e no
// Node 18+. Navegador velho demais NÃO trava a tela: `lerPlanilha` avisa que
// não conseguiu abrir o .xlsx e manda exportar em CSV, que é texto puro.

const td = new TextDecoder('utf-8');

// ── ZIP ─────────────────────────────────────────────────────────────────────
// Um .xlsx é um ZIP. Só precisamos de dois arquivos de dentro dele, então não
// vale escrever um descompactador completo: acha o diretório central, localiza
// a entrada pelo nome e infla só ela.
function acharEocd(dv) {
  // O fim do diretório central tem tamanho variável (comentário no fim do
  // arquivo), então a assinatura é procurada de trás pra frente. 64 KB é o
  // máximo que o comentário pode ter.
  const limite = Math.max(0, dv.byteLength - 66000);
  for (let i = dv.byteLength - 22; i >= limite; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

export function listarZip(buffer) {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = acharEocd(dv);
  if (eocd < 0) throw new Error('não parece um arquivo .xlsx (ZIP não reconhecido)');
  const qtd = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const entradas = [];
  for (let i = 0; i < qtd; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const compTam = dv.getUint32(p + 20, true);
    const nomeTam = dv.getUint16(p + 28, true);
    const extraTam = dv.getUint16(p + 30, true);
    const comTam = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const nome = td.decode(bytes.subarray(p + 46, p + 46 + nomeTam));
    entradas.push({ nome, metodo, compTam, offset });
    p += 46 + nomeTam + extraTam + comTam;
  }
  return entradas;
}

// ⚠️ O tamanho do "extra" do cabeçalho LOCAL é diferente do que está no
// diretório central — é o erro clássico de quem escreve leitor de ZIP. Os
// dados começam depois do local, e é ele que manda.
async function inflarEntrada(buffer, e) {
  const dv = new DataView(buffer);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error(`entrada corrompida: ${e.nome}`);
  const nomeTam = dv.getUint16(e.offset + 26, true);
  const extraTam = dv.getUint16(e.offset + 28, true);
  const ini = e.offset + 30 + nomeTam + extraTam;
  const dados = new Uint8Array(buffer, ini, e.compTam);
  if (e.metodo === 0) return td.decode(dados);      // guardado sem comprimir
  if (e.metodo !== 8) throw new Error(`compressão não suportada (${e.metodo}) em ${e.nome}`);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('este navegador não sabe descompactar .xlsx — exporte o relatório em CSV');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([dados]).stream().pipeThrough(ds);
  return new Response(stream).text();
}

async function lerDoZip(buffer, nome) {
  const e = listarZip(buffer).find((x) => x.nome === nome);
  if (!e) return null;
  return inflarEntrada(buffer, e);
}

// ── XML da planilha ─────────────────────────────────────────────────────────
// Regex em vez de DOMParser de propósito: o sharedStrings de um relatório de
// mês tem dezenas de milhares de nós, e montar a árvore inteira no celular é
// o que faz a tela congelar. Aqui só se varre o texto uma vez.
const desescapar = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');           // por último, senão desfaz os de cima

export function lerSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // Cada <si> pode ter vários <t> (texto com formatação partida no meio): o
  // nome do produto vem quebrado e precisa ser juntado, não só o primeiro.
  const si = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = si.exec(xml))) {
    let txt = '';
    const t = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let k;
    while ((k = t.exec(m[1]))) txt += desescapar(k[1]);
    out.push(txt);
  }
  return out;
}

// "BC" → 54. A planilha pula coluna vazia, então sem converter a letra os
// valores andariam pra esquerda e cada linha teria um deslocamento diferente.
export function colunaParaIndice(ref) {
  let n = 0;
  for (const c of String(ref).replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function lerSheet(xml, strings) {
  const linhas = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const celulas = [];
    const cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = cRe.exec(r[1]))) {
      const attrs = c[1] || '';
      const corpo = c[2] || '';
      const ref = (attrs.match(/\sr="([A-Z]+\d+)"/) || [])[1];
      const tipo = (attrs.match(/\st="(\w+)"/) || [])[1];
      let valor = '';
      if (tipo === 'inlineStr') {
        const is = corpo.match(/<is>([\s\S]*?)<\/is>/);
        if (is) {
          const t = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let k;
          while ((k = t.exec(is[1]))) valor += desescapar(k[1]);
        }
      } else {
        const v = corpo.match(/<v>([\s\S]*?)<\/v>/);
        if (v) valor = tipo === 's' ? (strings[+v[1]] ?? '') : desescapar(v[1]);
      }
      const i = ref ? colunaParaIndice(ref) : celulas.length;
      while (celulas.length < i) celulas.push('');
      celulas[i] = valor;
    }
    linhas.push(celulas);
  }
  return linhas;
}

export async function lerXlsx(buffer) {
  // A primeira aba serve: estes relatórios saem com uma só. Ir atrás do
  // workbook.xml pra descobrir a ordem seria precisão que ninguém usa.
  const nomes = listarZip(buffer).map((e) => e.nome);
  const alvo = nomes.find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || nomes.find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!alvo) throw new Error('planilha sem aba de dados');
  const [sheet, ss] = await Promise.all([
    lerDoZip(buffer, alvo),
    lerDoZip(buffer, 'xl/sharedStrings.xml').catch(() => null),
  ]);
  return lerSheet(sheet, lerSharedStrings(ss));
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// ⚠️ O separador é DESCOBERTO, não fixado. Exportação brasileira sai com `;`
// (porque a vírgula é o decimal) e a internacional com `,`. Fixar um dos dois
// devolveria uma coluna só, com o relatório inteiro dentro dela.
export function separadorDoCsv(texto) {
  const linha = String(texto).split(/\r?\n/).find((l) => l.trim()) || '';
  const fora = linha.replace(/"[^"]*"/g, '');
  const p = (c) => (fora.split(c).length - 1);
  return p(';') > p(',') ? ';' : (p(',') ? ',' : (p('\t') ? '\t' : ';'));
}

export function lerCsv(texto, sep) {
  const s = String(texto).replace(/^﻿/, '');
  const d = sep || separadorDoCsv(s);
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (aspas) {
      if (ch === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') { aspas = true; continue; }
    if (ch === d) { linha.push(campo); campo = ''; continue; }
    if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    if (ch === '\r') continue;
    campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
}

// ── A porta de entrada ──────────────────────────────────────────────────────
export async function lerPlanilha(arquivo) {
  const nome = String(arquivo?.name || '').toLowerCase();
  if (/\.csv$|\.txt$/.test(nome)) return lerCsv(await arquivo.text());
  return lerXlsx(await arquivo.arrayBuffer());
}

// ⚠️ Número em planilha brasileira chega como "1.234,56" e em planilha do
// próprio sistema como "1234.56". Trocar vírgula por ponto sem tirar o ponto
// de milhar transformaria 1.234,56 em 1.234 — o relatório inteiro sairia mil
// vezes menor, com cara de número certo.
export function numeroBr(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/^[-(]|\)$/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

// A data pode vir como texto ("16/09/2026 20:08:46") ou como o SERIAL do
// Excel. Devolve sempre AAAA-MM-DD.
export function dataDaCelula(v) {
  const s = String(v ?? '').trim();
  const br = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // ⚠️ Serial do Excel: dia 1 é 01/01/1900 e a planilha acredita que 1900 foi
  // bissexto (não foi). O deslocamento de 25569 dias até a época do Unix já
  // embute esse bug — é por isso que a conta parece ter um dia a mais.
  const n = parseFloat(s);
  if (Number.isFinite(n) && n > 20000 && n < 90000) {
    return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return '';
}
