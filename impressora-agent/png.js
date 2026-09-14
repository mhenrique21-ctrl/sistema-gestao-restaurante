// Grava PNG sem depender de biblioteca nenhuma.
// ============================================================================
// Existe porque a comanda do 99Food pode chegar como IMAGEM, não como texto: a
// tipografia do papel (fonte proporcional, caixa de canto arredondado) não é
// coisa que impressora térmica desenhe sozinha — é o aplicativo mandando pronto.
// Nesse caso o .txt sai vazio e a única forma de ver o que chegou é montar a
// imagem de volta.
//
// POR QUE SEM BIBLIOTECA: o agente roda no PC do caixa, onde "npm install" é
// uma coisa a mais pra dar errado às 20h. zlib já vem no Node, e PNG de 1 bit é
// pouco mais que um cabeçalho em volta do deflate.

import zlib from 'node:zlib';

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function bloco(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

// Imagem de 1 bit, como a impressora entende: bit ligado = ponto PRETO.
// No PNG em tons de cinza é o contrário — 0 é preto —, então inverte aqui. Sem
// isso a comanda sai em negativo e ninguém consegue ler.
export function pngMono({ bytesLinha, altura, dados }) {
  const largura = bytesLinha * 8;
  const bruto = Buffer.alloc((bytesLinha + 1) * altura);
  for (let y = 0; y < altura; y++) {
    const destino = y * (bytesLinha + 1);
    bruto[destino] = 0;                       // filtro "nenhum"
    for (let x = 0; x < bytesLinha; x++) {
      bruto[destino + 1 + x] = ~(dados[y * bytesLinha + x] || 0) & 0xFF;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 1;    // 1 bit por amostra
  ihdr[9] = 0;    // tons de cinza
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(bruto)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}
