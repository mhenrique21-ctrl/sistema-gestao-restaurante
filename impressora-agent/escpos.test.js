import test from 'node:test';
import assert from 'node:assert/strict';
import { textoDeEscPos, linhasUteis } from './escpos.js';

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
