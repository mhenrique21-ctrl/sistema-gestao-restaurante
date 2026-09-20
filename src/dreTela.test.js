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

test('a compra que não entrou no CMV é ligada de volta a ele', () => {
  // ⚠️ Ela não some — desce para as Despesas. O que sumia era a LIGAÇÃO: o
  // Lucro Bruto ficava alto sem que desse para dizer por quê.
  assert.ok(DRE.includes('comprasForaDoCmv(foraCmvCats)'), 'falta a conferência do que ficou fora');
  assert.ok(DRE.includes('fora do CMV'), 'o texto precisa dizer que ficaram fora');
  assert.ok(DRE.includes('Compras → Reclassificar'), 'a categoria antiga precisa do caminho da migração');
});

test('categoria antiga e "não é CMV" são motivos DIFERENTES', () => {
  // Tratá-los igual esconde trabalho pendente: a antiga vira CMV assim que
  // alguém a migrar; a de limpeza nunca vira.
  assert.ok(DRE.includes('MOTIVO_FORA_CMV'), 'o motivo de cada linha tem que aparecer');
  assert.ok(/fora\.aReclassificar>0/.test(DRE), 'falta o destaque do que ainda dá para migrar');
});

test('a despesa que veio de Compras é marcada como tal', () => {
  // "Material de limpeza e higiene" no meio das despesas é uma COMPRA, não uma
  // conta a pagar — e sem a marca ninguém liga a linha à entrada que a gerou.
  assert.ok(DRE.includes('deCompras={foraCmvCats}'), 'o mapa das compras não chega no detalhe');
  assert.ok(DRE.includes('>de Compras<'), 'falta a marca na linha');
  assert.ok(DRE.includes('de compra · '), 'linha mista precisa mostrar as duas parcelas');
});
