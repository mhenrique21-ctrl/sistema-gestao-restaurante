import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Trava, LENDO o App.tsx, o bug que o dono encontrou em 20/09/2026:
//
//   "Logo após digitar o primeiro número, ele já grava automaticamente."
//
// O que acontecia: a visibilidade do campo "1 un = ___ g" dependia do RESULTADO
// do próprio campo. Digitado o "9" de "900", o rendimento deixava de ser null,
// a linha trocava para o texto verde de confirmação e o input DESAPARECIA no
// meio da digitação — gravando 9 onde deviam entrar 900.
//
// ⚠️ Campo cuja existência depende do que se digita nele é sempre bug, e nem o
// build nem o TypeScript acusam: é JSX válido.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const CARD = (() => {
  const i = APP.indexOf('function AgruparMarcasCard');
  assert.ok(i > 0, 'AgruparMarcasCard sumiu do App.tsx');
  const j = APP.indexOf('\nfunction ', i + 10);
  return APP.slice(i, j > 0 ? j : APP.length);
})();

test('o rendimento que decide a TELA não olha o que está sendo digitado', () => {
  assert.ok(!/rendimentoDaMarca\(\s*marcada/.test(CARD),
    'rendimentoDaMarca voltou a receber o valor digitado — o campo some ao digitar');
  assert.ok(/const auto\s*=\s*rendimentoDaMarca\(mp\s*,/.test(CARD),
    'o rendimento automático tem que sair SÓ do que está gravado na marca');
});

test('o campo fica aberto enquanto a marca estiver marcada', () => {
  // Nada além de "está marcada" pode decidir se o input existe.
  assert.ok(/\{marcada&&<>/.test(CARD), 'o bloco do campo não está sob `marcada&&` sozinho');
  assert.ok(!/marcada&&r==null&&</.test(CARD), 'a condição antiga voltou');
  assert.ok(!/marcada&&r!=null&&</.test(CARD), 'a condição antiga voltou');
});

test('o campo vem preenchido com o que já foi salvo — senão não dá pra corrigir', () => {
  // Uma declaração errada já gravada (o "9" em vez de "900") só é corrigível se
  // o campo aparecer com o valor atual dentro.
  assert.ok(/value=\{rend\[mp\.id\]\?\?\(mp\.porUnidadeBase>0/.test(CARD.replace(/\s/g, '')) ||
    /value=\{rend\[mp\.id\]\s*\?\?\s*\(mp\.porUnidadeBase\s*>\s*0/.test(CARD),
    'o input precisa cair no porUnidadeBase já salvo quando nada foi digitado');
});

test('dá pra trocar a unidade de um grupo que já existe', () => {
  // Antes, `unidadeBase` só era escolhida na criação: um grupo criado em "un"
  // ficava preso nela, e o Nescau nunca passaria a contar em gramas.
  assert.ok(CARD.includes('trocarBase('), 'falta a troca de unidade do grupo');
  assert.ok(/prodDestino&&/.test(CARD), 'a troca tem que aparecer quando o destino é um grupo existente');
});

test('a troca de unidade passa pelos DOIS caminhos de gravação', () => {
  // `produtosLista` é compartilhado entre as empresas (applyBothProdutos) e
  // `materiasPrimas` é por empresa (setDbAndSave). Gravar os dois no mesmo
  // lugar poria a matéria-prima de uma empresa dentro da outra (§3).
  const bloco = CARD.slice(CARD.indexOf('const trocarBase='), CARD.indexOf('const desagrupar='));
  assert.ok(bloco.includes('applyBothProdutos('), 'produtosLista tem que ir por applyBothProdutos');
  assert.ok(/setDbAndSave\|\|setDb/.test(bloco), 'materiasPrimas tem que ir por setDbAndSave');
  assert.ok(bloco.includes('produtosLista:r.produtosLista'), 'só produtosLista no caminho compartilhado');
  assert.ok(bloco.includes('materiasPrimas:r.materiasPrimas'), 'só materiasPrimas no caminho por empresa');
});
