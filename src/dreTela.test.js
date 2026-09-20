import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Trava, LENDO o App.tsx, o que a remodelagem da DRE de 20/09/2026 corrigiu.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const DRE = (() => {
  const i = APP.indexOf('function DREComp');
  assert.ok(i > 0, 'DREComp sumiu do App.tsx');
  const j = APP.indexOf('\nfunction ', i + 10);
  return APP.slice(i, j > 0 ? j : APP.length);
})();

test('a DRE abre no MÊS', () => {
  // ⚠️ No recorte curto a compra quase nunca cai dentro, o CMV sai zero e a
  // margem aparece dobrada — foi o que aconteceu em 14–19/09/2026.
  assert.ok(/useState\("mes"\)/.test(DRE), 'o período padrão voltou a ser outro');
});

test('o recorte sem compra nenhuma vira aviso escrito', () => {
  // Antes a tela mostrava "Total CMV R$ 0,00" e, logo abaixo, "Realizado
  // R$ 3.725,82" — sem dizer que são recortes diferentes.
  assert.ok(DRE.includes('conferirCmv(db.compras||[],de,ate)'), 'falta a conferência do CMV');
  assert.ok(DRE.includes('não são a sua margem'), 'o aviso precisa dizer o que o número NÃO é');
  assert.ok(DRE.includes('verMesInteiro'), 'falta o atalho para o mês inteiro');
});

test('a barra fecha por construção — as fatias saem do módulo', () => {
  // ⚠️ A versão antiga somava cinco porcentagens calculadas em separado e
  // precisava de uma linha "restante não alocado": ela já sabia que não fechava.
  assert.ok(DRE.includes('fatiasDaReceita({vendasBrutas'), 'as fatias têm que vir do dre.js');
  assert.ok(!DRE.includes('Restante não alocado'), 'o remendo do rodapé voltou');
  assert.ok(!DRE.includes('Para cada R$100,00 vendidos'), 'o bloco duplicado do rodapé voltou');
});

test('não há texto DENTRO das fatias da barra', () => {
  // A fatia fina não tem largura para texto nenhum, e o número dentro obrigaria
  // cada cor a ter contraste de texto próprio. A legenda carrega tudo.
  const barra = DRE.slice(DRE.indexOf('barra.fatias.filter'), DRE.indexOf('gridTemplateColumns:"repeat(auto-fit,minmax(168px'));
  assert.ok(!/>\{[^}]*pct/.test(barra), 'apareceu porcentagem dentro do preenchimento');
});

test('o detalhe fica recolhido, e a despesa abre por padrão', () => {
  assert.ok(/useState<Set<string>>\(new Set\(\["despesa"\]\)\)/.test(DRE), 'a despesa tem que abrir por padrão');
  assert.ok(DRE.includes('ver ${quantos}') || DRE.includes('`ver ${quantos}`'), 'falta o "ver N"');
});

test('os quatro cartões do topo saíram', () => {
  // Eles repetiam quatro linhas da tabela logo abaixo.
  assert.ok(!DRE.includes('{label:"Resultado Op.",v:resultadoOp'), 'os cartões voltaram');
});

test('a folha continua aberta por funcionário', () => {
  // Sem isso ela é um número que ninguém consegue conferir.
  assert.ok(DRE.includes('sub={{[LINHA_FOLHA]:folhaPorFunc}}'), 'a folha perdeu o detalhe por funcionário');
});
