import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeArrayById } from '../mergeDocument.js';

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

test('sem carimbo, a fusão devolve a versão do SERVIDOR', () => {
  // A prova do bug "altero a rua, salvo, e o produto volta sem rua".
  // mergeFromServer chama mergeArrayById(servidor, local): quando só o lado do
  // servidor tem timestamp, ele vence — e a edição local é revertida no poll.
  const vazio = new Set();
  const servidor = { id: 'p1', rua: '', atualizadoEm: '2026-09-15T10:00:00Z' };
  const semCarimbo = mergeArrayById([servidor], [{ id: 'p1', rua: 'Padaria' }], vazio)[0];
  assert.equal(semCarimbo.rua, '', 'sem carimbo o servidor vence — é o bug');

  const comCarimbo = mergeArrayById([servidor],
    [{ id: 'p1', rua: 'Padaria', atualizadoEm: '2026-09-15T10:00:01Z' }], vazio)[0];
  assert.equal(comCarimbo.rua, 'Padaria', 'com carimbo a edição local sobrevive');
});

test('toda escrita que MODIFICA produtosLista carimba atualizadoEm', () => {
  // Varre o App.tsx. Escrita com `.map(` sobre produtosLista altera item
  // existente: sem carimbo, ela é revertida pelo poll e o usuário vê o valor
  // "voltar sozinho". As de `.filter(` só removem e não precisam.
  const linhas = APP.split('\n');
  const faltando = [];
  linhas.forEach((l, i) => {
    if (!/produtosLista:\s*\(d\.produtosLista\|\|\[\]\)\.map\(/.test(l)) return;
    // o objeto pode fechar nas linhas seguintes
    const bloco = linhas.slice(i, i + 4).join('\n');
    if (!bloco.includes('atualizadoEm')) faltando.push(`${i + 1}: ${l.trim().slice(0, 90)}`);
  });
  assert.deepEqual(faltando, [], `\n  ${faltando.join('\n  ')}\n`);
});

test('toda CRIAÇÃO em produtosLista carimba', () => {
  // Produto novo sem carimbo perde para qualquer versão carimbada do servidor
  // no primeiro conflito — some sem deixar rastro.
  const linhas = APP.split('\n');
  const faltando = [];
  linhas.forEach((l, i) => {
    if (!/produtosLista:\s*\[\.\.\.\(d\.produtosLista\|\|\[\]\),\s*\{/.test(l)) return;
    const bloco = linhas.slice(i, i + 3).join('\n');
    if (!bloco.includes('atualizadoEm')) faltando.push(`${i + 1}: ${l.trim().slice(0, 90)}`);
  });
  assert.deepEqual(faltando, []);
});

test('as telas de rua salvam de verdade, não por setState cru', () => {
  // setState cru depende do auto-save genérico. applyBothProdutos busca o
  // servidor, funde e grava as duas empresas por conta própria — é o que
  // garante que a mudança de rua chega aos outros aparelhos.
  assert.ok(!APP.includes('"listaCompras" in nx[e]'),
    'sobrou tela de rua com setState cru em vez de applyBothProdutos');
});
