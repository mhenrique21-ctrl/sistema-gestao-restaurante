import test from 'node:test';
import assert from 'node:assert/strict';
import { textoDeEscPos, extrairEscPos, linhasUteis } from './escpos.js';

const ESC = 0x1B, GS = 0x1D;
const txt = (s) => Buffer.from(s, 'latin1');
const bytes = (...n) => Buffer.from(n);
const juntar = (...partes) => Buffer.concat(partes.map((p) => (Buffer.isBuffer(p) ? p : txt(p))));

test('texto simples sobrevive inteiro', () => {
  assert.equal(textoDeEscPos(txt('PEDIDO 1234\nX-Salada\n')), 'PEDIDO 1234\nX-Salada');
});

test('acento vem da CP850, não de UTF-8', () => {
  // Na CP850 o "Ã" é 0xC7 e o "ç" é 0x87 — um byte só. Lidos como UTF-8 eles
  // não formam caractere nenhum, e o nome do item deixa de casar com o cadastro.
  assert.equal(textoDeEscPos(juntar('P', bytes(0xC7), 'O DE QUEIJO')), 'PÃO DE QUEIJO');
  assert.equal(textoDeEscPos(juntar('A', bytes(0x87), 'a', bytes(0xA1))), 'Açaí');
});

test('ESC @ não come a primeira letra', () => {
  // ESC @ é o primeiro byte de quase todo trabalho; tem ZERO parâmetro.
  assert.equal(textoDeEscPos(juntar(bytes(ESC, 0x40), 'ABC')), 'ABC');
});

test('parâmetro de ESC ! não vaza como caractere', () => {
  // ESC ! 0x30 = negrito+duplo. Sem consumir o 0x30, sairia um "0" no texto.
  assert.equal(textoDeEscPos(juntar(bytes(ESC, 0x21, 0x30), 'TOTAL')), 'TOTAL');
});

test('alinhamento e sublinhado somem sem deixar resto', () => {
  const b = juntar(bytes(ESC, 0x61, 0x01), '99FOOD', bytes(0x0A), bytes(ESC, 0x2D, 0x31), 'Item');
  assert.equal(textoDeEscPos(b), '99FOOD\nItem');
});

test('GS V com m=66 tem dois parâmetros', () => {
  // GS V 66 0x40 = corte com avanço. Tratado como 1 parâmetro, o 0x40 vira "@".
  assert.equal(textoDeEscPos(juntar('FIM', bytes(0x0A, GS, 0x56, 66, 0x40))), 'FIM');
  // e com m=0 (corte total) o byte seguinte é texto de verdade
  assert.equal(textoDeEscPos(juntar('FIM', bytes(0x0A, GS, 0x56, 0x00), 'X')), 'FIM\nX');
});

test('logo raster GS v 0 é pulado pelo tamanho declarado', () => {
  // 4 bytes por linha × 3 linhas = 12 bytes de binário, todos imprimíveis de
  // propósito: se não pular pelo tamanho, eles apareceriam no texto.
  const dados = Buffer.alloc(12, 0x41);
  const b = juntar(bytes(GS, 0x76, 0x30, 0x00, 4, 0, 3, 0), dados, bytes(0x0A), 'PEDIDO');
  assert.equal(textoDeEscPos(b), 'PEDIDO');
});

test('QR Code (GS ( k) é pulado pelo pL/pH', () => {
  const dado = txt('https://99food/x');
  const n = dado.length + 3;
  const b = juntar(bytes(GS, 0x28, 0x6B, n & 0xFF, n >> 8, 0x31, 0x50, 0x30), dado, 'DEPOIS');
  assert.equal(textoDeEscPos(b), 'DEPOIS');
});

test('código de barras termina no NUL quando m < 65', () => {
  const b = juntar(bytes(GS, 0x6B, 0x04), '123456789', bytes(0x00, 0x0A), 'OK');
  assert.equal(textoDeEscPos(b), 'OK');
});

test('código de barras de tamanho declarado quando m >= 65', () => {
  const b = juntar(bytes(GS, 0x6B, 73, 5), '12345', bytes(0x0A), 'OK');
  assert.equal(textoDeEscPos(b), 'OK');
});

test('ESC * pula a imagem pelo número de colunas', () => {
  // m=33 → 3 bytes por coluna. 5 colunas = 15 bytes.
  const b = juntar(bytes(ESC, 0x2A, 33, 5, 0), Buffer.alloc(15, 0x42), bytes(0x0A), 'OK');
  assert.equal(textoDeEscPos(b), 'OK');
});

test('avanço de papel do fim não vira linhas em branco', () => {
  const b = juntar('TOTAL 42,00', bytes(0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, GS, 0x56, 0x00));
  assert.equal(textoDeEscPos(b), 'TOTAL 42,00');
});

test('CR sozinho não duplica a quebra de linha', () => {
  assert.equal(textoDeEscPos(juntar('A', bytes(0x0D, 0x0A), 'B')), 'A\nB');
});

test('linhasUteis derruba separador e linha vazia', () => {
  const t = '99FOOD\n--------------\n\n1x Cafe\n==============\nTOTAL 8,00';
  assert.deepEqual(linhasUteis(t), ['99FOOD', '1x Cafe', 'TOTAL 8,00']);
});

test('linhasUteis preserva o recuo à esquerda', () => {
  // O layout da comanda usa recuo pra observação do item; tirar mataria o
  // único sinal de que a linha pertence ao item de cima.
  assert.deepEqual(linhasUteis('1x Cafe\n   sem acucar  '), ['1x Cafe', '   sem acucar']);
});

test('GS v 0 não é só pulado: a faixa volta pra montar a imagem', () => {
  // A comanda do 99Food tem fonte proporcional e caixa arredondada — não é
  // desenho de térmica, é imagem pronta. Se o extrator só pulasse, o .txt
  // sairia vazio e não haveria como ver o que chegou no papel.
  const dados = Buffer.from([0b10000001, 0x00, 0xFF, 0xFF]);
  const b = juntar(bytes(GS, 0x76, 0x30, 0x00, 2, 0, 2, 0), dados);
  const { texto, imagem, faixas } = extrairEscPos(b);
  assert.equal(texto, '');
  assert.equal(faixas, 1);
  assert.equal(imagem.bytesLinha, 2);
  assert.equal(imagem.altura, 2);
  assert.deepEqual(imagem.dados, dados);
});

test('ESC * vem em COLUNAS e é virado pra linhas', () => {
  // Guardada como veio, a imagem sai deitada e ilegível.
  const dados = Buffer.from([0b10000000, 0b00000001]);
  const { imagem } = extrairEscPos(juntar(bytes(ESC, 0x2A, 0, 2, 0), dados));
  assert.equal(imagem.bytesLinha, 1);
  assert.equal(imagem.altura, 8);
  assert.equal(imagem.dados[0], 0b10000000);  // coluna 0, ponto de cima
  assert.equal(imagem.dados[7], 0b01000000);  // coluna 1, ponto de baixo
});

test('faixas do trabalho viram UMA imagem, na ordem do papel', () => {
  // O driver manda a comanda em dezenas de fatias; uma imagem por fatia daria
  // 60 arquivos inúteis no lugar de uma comanda.
  const f1 = juntar(bytes(GS, 0x76, 0x30, 0x00, 1, 0, 1, 0), bytes(0xAA));
  const f2 = juntar(bytes(GS, 0x76, 0x30, 0x00, 1, 0, 2, 0), bytes(0x0F, 0xF0));
  const { imagem, faixas } = extrairEscPos(juntar(f1, f2));
  assert.equal(faixas, 2);
  assert.equal(imagem.altura, 3);
  assert.deepEqual(Array.from(imagem.dados), [0xAA, 0x0F, 0xF0]);
});

test('faixa mais estreita é alinhada à esquerda, como a impressora imprime', () => {
  const larga  = juntar(bytes(GS, 0x76, 0x30, 0x00, 2, 0, 1, 0), bytes(0xFF, 0xFF));
  const estreita = juntar(bytes(GS, 0x76, 0x30, 0x00, 1, 0, 1, 0), bytes(0xC0));
  const { imagem } = extrairEscPos(juntar(larga, estreita));
  assert.equal(imagem.bytesLinha, 2);
  assert.deepEqual(Array.from(imagem.dados), [0xFF, 0xFF, 0xC0, 0x00]);
});

test('trabalho sem imagem nenhuma não inventa imagem', () => {
  const { texto, imagem, faixas } = extrairEscPos(txt('PEDIDO 1\n'));
  assert.equal(texto, 'PEDIDO 1');
  assert.equal(imagem, null);
  assert.equal(faixas, 0);
});
