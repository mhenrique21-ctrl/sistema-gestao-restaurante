// Extrai o texto de um trabalho de impressão ESC/POS.
// ============================================================================
// A comanda que sai do 99Food (e do iFood) chega como bytes de impressora
// térmica: texto misturado com comandos de negrito, corte de papel, alinhamento
// e gaveta. Ler isso como UTF-8 puro devolve lixo no meio das palavras.
//
// Mora fora do agente porque é o que vai mudar quando o layout mudar — e é a
// única parte testável sem uma impressora na mesa.
//
// ⚠️ NEM TODA COMANDA É TEXTO. A do 99Food tem fonte proporcional e caixa de
// canto arredondado — coisa que térmica não desenha sozinha, sinal de que o
// aplicativo manda a comanda pronta como IMAGEM. Por isso o extrator não só
// PULA o raster: ele também DEVOLVE, para o agente montar um PNG. Sem isso o
// .txt sairia vazio e não haveria como ver o que chegou no papel.

// Tabela de caracteres das térmicas: quase todas usam CP850 ou CP437 no Brasil.
// Sem isso, "PÃO" vira "P?O" e o nome do produto deixa de casar com o cadastro.
const CP850 = {
  128:'Ç',129:'ü',130:'é',131:'â',132:'ä',133:'à',134:'å',135:'ç',136:'ê',137:'ë',
  138:'è',139:'ï',140:'î',141:'ì',142:'Ä',143:'Å',144:'É',145:'æ',146:'Æ',147:'ô',
  148:'ö',149:'ò',150:'û',151:'ù',152:'ÿ',153:'Ö',154:'Ü',155:'ø',156:'£',157:'Ø',
  160:'á',161:'í',162:'ó',163:'ú',164:'ñ',165:'Ñ',166:'ª',167:'º',168:'¿',
  181:'Á',182:'Â',183:'À',198:'ã',199:'Ã',210:'Ê',211:'Ë',212:'È',214:'Í',215:'Î',
  216:'Ï',222:'Ì',224:'Ó',226:'Ô',227:'Ò',229:'Õ',228:'õ',233:'Ú',234:'Û',235:'Ù',
  245:'§',248:'°',253:'²',
};

// Comandos ESC/POS que carregam um número fixo de bytes de parâmetro. Sem
// consumir esses bytes, o parâmetro vira caractere solto no meio do texto —
// é assim que aparece um "@" ou um "!" grudado no nome do item.
const ESC_PARAMS = {
  0x21:1, 0x2D:1, 0x33:1, 0x40:0, 0x61:1, 0x45:1, 0x47:1, 0x4A:1, 0x64:1,
  0x52:1, 0x74:1, 0x7B:1, 0x56:1, 0x70:3, 0x63:1, 0x44:0, 0x4D:1, 0x20:1,
  0x53:0, 0x32:0, 0x69:0, 0x6D:0, 0x72:1, 0x63:1,
};
const GS_PARAMS = {
  0x21:1, 0x42:1, 0x4C:2, 0x57:2, 0x61:1, 0x66:1, 0x68:1, 0x77:1, 0x72:1,
  0x48:2, 0x45:1, 0x62:1, 0x50:2, 0x54:0,
};

// Uma faixa de pontos do papel, já em linhas (o ESC/POS guarda de dois jeitos
// diferentes; quem chama não deveria precisar saber qual).
function faixa(bytesLinha, altura, dados) { return { bytesLinha, altura, dados }; }

// Converte a banda do ESC * — que vem em COLUNAS, 8 ou 24 pontos de altura —
// para linhas. Guardada como veio, a imagem sai deitada e ilegível.
function bandaDeEscEstrela(m, colunas, dados) {
  const altura = (m === 32 || m === 33) ? 24 : 8;
  const porColuna = altura / 8;
  const bytesLinha = Math.ceil(colunas / 8);
  const saida = Buffer.alloc(bytesLinha * altura);
  for (let x = 0; x < colunas; x++) {
    for (let k = 0; k < porColuna; k++) {
      const byte = dados[x * porColuna + k] || 0;
      for (let bit = 0; bit < 8; bit++) {
        if (!(byte & (0x80 >> bit))) continue;
        const y = k * 8 + bit;
        saida[y * bytesLinha + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return faixa(bytesLinha, altura, saida);
}

// Empilha as faixas na ordem em que saíram do papel. O driver manda a comanda
// em dezenas de fatias; salvar uma imagem por fatia daria 60 arquivos inúteis.
// Faixa mais estreita é alinhada à esquerda, que é como a impressora imprime.
export function montarImagem(faixas) {
  const lista = (faixas || []).filter((f) => f && f.altura > 0 && f.bytesLinha > 0);
  if (!lista.length) return null;
  const bytesLinha = Math.max(...lista.map((f) => f.bytesLinha));
  const altura = lista.reduce((a, f) => a + f.altura, 0);
  const dados = Buffer.alloc(bytesLinha * altura);
  let y = 0;
  for (const f of lista) {
    for (let l = 0; l < f.altura; l++, y++) {
      f.dados.copy(dados, y * bytesLinha, l * f.bytesLinha, (l + 1) * f.bytesLinha);
    }
  }
  return faixa(bytesLinha, altura, dados);
}

export function textoDeEscPos(buf) {
  return extrairEscPos(buf).texto;
}

export function extrairEscPos(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const faixas = [];
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];

    if (c === 0x1B) {                           // ESC
      const cmd = b[i + 1];
      // ESC * = imagem de bits (o logo da praça, em muitas impressoras).
      // nL/nH contam COLUNAS, e cada coluna ocupa 1 ou 3 bytes conforme o modo.
      if (cmd === 0x2A) {
        const m = b[i + 2] || 0;
        const cols = (b[i + 3] || 0) + (b[i + 4] || 0) * 256;
        const largura = cols * (m === 32 || m === 33 ? 3 : 1);
        if (cols > 0) faixas.push(bandaDeEscEstrela(m, cols, b.subarray(i + 5, i + 5 + largura)));
        i += 4 + largura;
        continue;
      }
      i += 1 + (ESC_PARAMS[cmd] ?? 1);
      continue;
    }

    if (c === 0x1D) {                           // GS
      const cmd = b[i + 1];
      // GS v 0 = imagem raster (logo). O tamanho vem nos 4 bytes seguintes e
      // os dados são binário puro: sem pular tudo, o logo vira páginas de lixo.
      if (cmd === 0x76) {
        const xL = b[i + 4] || 0, xH = b[i + 5] || 0, yL = b[i + 6] || 0, yH = b[i + 7] || 0;
        const bytesLinha = xL + xH * 256, altura = yL + yH * 256;
        const n = bytesLinha * altura;
        if (n > 0) faixas.push(faixa(bytesLinha, altura, b.subarray(i + 8, i + 8 + n)));
        i += 7 + n;
        continue;
      }
      // GS ( = famílias novas (QR Code, entre elas). O tamanho é declarado em
      // pL/pH — é a única forma de pular, porque o conteúdo é livre.
      if (cmd === 0x28) {
        const n = (b[i + 3] || 0) + (b[i + 4] || 0) * 256;
        i += 4 + n;
        continue;
      }
      // GS k = código de barras. Abaixo de 65 o dado termina em NUL; de 65 pra
      // cima o próprio comando diz quantos bytes vêm. O número do pedido às
      // vezes sai aqui, mas ele também vem escrito — não vale inventar.
      if (cmd === 0x6B) {
        const m = b[i + 2] || 0;
        if (m >= 65) { i += 3 + (b[i + 3] || 0); continue; }
        let j = i + 3;
        while (j < b.length && b[j] !== 0x00) j++;
        i = j;
        continue;
      }
      // GS V m n: só existe o segundo parâmetro quando m é 65 ou 66 (corte com
      // avanço). Tratar sempre como 1 deixaria o "n" escapar como caractere.
      if (cmd === 0x56) {
        const m = b[i + 2] || 0;
        i += 2 + (m === 65 || m === 66 ? 1 : 0);
        continue;
      }
      i += 1 + (GS_PARAMS[cmd] ?? 1);
      continue;
    }

    if (c === 0x10) { i += 2; continue; }       // DLE (comandos de tempo real)
    if (c === 0x1C) { i += 1; continue; }       // FS (modo kanji/moeda)
    if (c === 0x0A) { out += '\n'; continue; }
    if (c === 0x0D) continue;                   // CR: a térmica usa LF sozinho
    if (c === 0x09) { out += ' '; continue; }
    if (c < 0x20) continue;                     // demais controles
    out += c < 128 ? String.fromCharCode(c) : (CP850[c] || '');
  }
  // Térmica manda dezenas de LF no fim pra empurrar o papel até a guilhotina.
  const texto = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { texto, imagem: montarImagem(faixas), faixas: faixas.length };
}

// Linhas úteis, já sem as de enfeite. Separador é o que a comanda usa pra
// dividir cabeçalho, itens e total — mantê-los atrapalha qualquer regex.
export function linhasUteis(texto) {
  return String(texto || '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^[-=*_.\s]+$/.test(l));
}
