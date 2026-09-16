import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizarNome } from './vinculoProducao.js';

// Trava de regressão para um bug que NÃO aparece no build nem no runtime como
// erro: o App.tsx declara um `normalizarNome` PRÓPRIO (o da conciliação de
// importação, `(nome, norms)`), e ele sombreia o import do vinculoProducao.js.
//
// Chamado com um argumento só, o local cai no `if(!nome||!norms?.length) return
// nome` e devolve o nome INTACTO — sem minúscula, sem tirar acento. Foi assim
// que a busca "Buscar produto do Eclética" ficou sensível a maiúscula: o
// cardápio é cadastrado em CAIXA ALTA ("SALG COXINHA FRANGO", "TORTA BANOFFEE
// FATIA"), então nenhum produto do Eclética respondia à busca, e só os insumos
// comprados — digitados em minúscula — apareciam. O usuário via a despensa
// inteira no lugar do cardápio.
//
// Por isso o import entra apelidado (`normalizarNome as normProducao`). Este
// teste lê o código de verdade, como o carimbos.test.js e o paletas.test.js.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const CARD = (() => {
  const i = APP.indexOf('function VincularProducaoCard(');
  const f = APP.indexOf('function ProducaoPanel(', i);
  assert.ok(i >= 0 && f > i, 'VincularProducaoCard não encontrado');
  return APP.slice(i, f);
})();

test('⚠️ o App.tsx ainda tem o normalizarNome que sombreia o import', () => {
  // Se um dia ele sumir, o apelido deixa de ser necessário — mas enquanto
  // existir, usar o nome cru no card é o bug de volta.
  assert.match(APP, /const normalizarNome=\(nome:string,norms:any\[\]\)/);
});

test('⚠️ o card de vínculo NÃO chama `normalizarNome` cru', () => {
  const cru = [...CARD.matchAll(/(?<![\w.])normalizarNome\s*\(/g)];
  assert.equal(cru.length, 0,
    'chamada crua no card: pega o normalizador da importação, que devolve o nome intacto');
  assert.ok(CARD.includes('normProducao('), 'o card precisa usar o apelido');
});

test('o apelido está no import do vinculoProducao.js', () => {
  assert.match(APP, /import\s*\{[^}]*normalizarNome as normProducao[^}]*\}\s*from\s*"\.\/vinculoProducao\.js"/);
});

test('e o normalizador de verdade é quem faz a busca funcionar', () => {
  // A prova do que o sombreamento custava: sem minúscula, o cardápio some.
  const nomeDoCardapio = 'TORTA BANOFFEE FATIA';
  assert.equal(nomeDoCardapio.includes('ban'), false, 'cru, o cardápio não responde');
  assert.equal(normalizarNome(nomeDoCardapio).includes('ban'), true);
  assert.equal(normalizarNome('SALG. COXINHA FRANGO').includes('coxinha'), true);
});
