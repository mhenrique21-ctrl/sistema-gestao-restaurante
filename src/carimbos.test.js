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

test('⚠️ o catálogo grava pelo MESMO protocolo do setDbAndSave, nas duas empresas', () => {
  // applyBothProdutos era um SEGUNDO escritor sem coordenação: GET→funde→POST
  // próprio, sem ligar directSaveRef — o poll (800ms na Lista) e o auto-save
  // genérico não recuavam, e quem gravasse por último com leitura velha
  // apagava a edição. E `atualizado` era lido fora de flushSync: sob batching
  // do React o updater roda depois do `if`, o POST é pulado, sem erro.
  // Sintoma: "edito o produto sem rua e não salva" (25/09/2026).
  assert.ok(APP.includes('if (setState && _salvarAmbasRef.current) { _salvarAmbasRef.current(fn); return; }'),
    'applyBothProdutos tem que delegar ao caminho coordenado');
  const ini = APP.indexOf('const salvarAmbas=');
  const fim = APP.indexOf('_salvarAmbasRef.current=salvarAmbas;');
  assert.ok(ini > 0 && fim > ini, 'salvarAmbas sumiu ou não é registrado no ref');
  const bloco = APP.slice(ini, fim);
  assert.ok(bloco.includes('directSaveRef.current=true;'), 'sem a trava, poll e auto-save gravam por cima');
  assert.ok(bloco.includes('await mergeWithServerBeforePost(emp)'), 'tem que fundir com o servidor ANTES de gravar');
  assert.ok((bloco.match(/flushSync\(/g) || []).length >= 2, 'o corpo do POST precisa sair de um flushSync — fora dele pode vir null');
  assert.ok(bloco.includes('"produtosLista" in next[e]'), 'aplica em toda empresa que tem catálogo, não só na ativa');
  assert.ok(bloco.includes('directSaveRef.current=false;directSaveEndRef.current=Date.now();'), 'a trava tem que ser solta no finally');
});
