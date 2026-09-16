import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNome, tokens, pontuar, sugerirVinculo, itemDeEstoqueDaProducao, apelidosDoItem, fichasQueUsam, ehRecheio, candidatosDeVinculo, ehAlvoDeProducao } from './vinculoProducao.js';

// Análise do código sob teste (vinculoProducao.js):
// - Input: nome digitado no catálogo de produção ("Coxinha de frango") e a
//   lista de itens de estoque (produtos do Eclética, "SALG COXINHA FRANGO").
// - Output: sugestão de par com pontuação e a marca `seguro`, e o resolvedor
//   que a produção usa de verdade (vínculo explícito → nome → nada).
// - Sem efeitos colaterais: funções puras.
// - Existe porque sugerir par errado erra em SILÊNCIO — a produção entraria no
//   saldo do produto errado e só a contagem física denunciaria.

const mp = (id, nome) => ({ id, nome });
const ECLETICA = [
  mp('e1', 'SALG COXINHA FRANGO'),
  mp('e2', 'TRANCA CALABRESA'),
  mp('e3', 'TRANCA CAMARAO'),
  mp('e4', 'BOLO CHOCOLATE FATIA'),
  mp('e5', 'EMPADA FRANGO'),
];

test('normaliza acento, caixa e pontuação', () => {
  assert.equal(normalizarNome('Trança de salame (burguesa)'), 'tranca de salame burguesa');
  assert.equal(normalizarNome('SALG. COXINHA'), 'salg coxinha');
});

test('as palavras de ruído do catálogo saem dos tokens', () => {
  // "salg" e "de" não distinguem produto nenhum; deixá-los inflaria a
  // semelhança entre coisas diferentes.
  assert.deepEqual(tokens('SALG. COXINHA DE FRANGO'), ['coxinha', 'frango']);
  assert.deepEqual(tokens('Pasta de brigadeiro P/ café'), ['pasta', 'brigadeiro', 'cafe']);
});

test('ordem das palavras não atrapalha', () => {
  assert.equal(pontuar('Trança de salame (burguesa)', 'TRANCA SALAME BURGUESA'), 1);
  assert.equal(pontuar('Coxinha de frango', 'SALG COXINHA FRANGO'), 1);
});

test('nomes sem nada em comum pontuam zero', () => {
  assert.equal(pontuar('Bolo de milho', 'TRANCA CAMARAO'), 0);
});

test('sugere o par certo e marca como seguro', () => {
  const s = sugerirVinculo('Coxinha de frango', ECLETICA);
  assert.equal(s.mp.id, 'e1');
  assert.equal(s.seguro, true);
});

test('⚠️ par ambíguo NÃO é seguro — o lote não pode ligar camarão na calabresa', () => {
  // "Trança de camarão" casa 1.0 com TRANCA CAMARAO, mas TRANCA CALABRESA vem
  // logo atrás; a margem é o que impede o lote de errar em silêncio.
  const s = sugerirVinculo('Trança', ECLETICA);
  assert.equal(s.seguro, false, 'nome genérico demais não pode entrar no lote');
});

test('sem candidato parecido, devolve null em vez de chutar', () => {
  assert.equal(sugerirVinculo('Pão de batata', ECLETICA), null);
});

test('item já vinculado sai da lista de candidatos', () => {
  const s = sugerirVinculo('Coxinha de frango', ECLETICA, { excluirIds: ['e1'] });
  assert.equal(s, null);
});

test('o resolvedor usa o VÍNCULO antes do nome', () => {
  const produtosProducao = [{ id: 'c1', nome: 'Coxinha de frango', mpId: 'e1' }];
  const r = itemDeEstoqueDaProducao('Coxinha de frango', { produtosProducao, materiasPrimas: ECLETICA });
  assert.equal(r.mp.id, 'e1');
  assert.equal(r.origem, 'vinculo');
});

test('sem vínculo, casa pelo nome igual — é como tudo funcionava antes', () => {
  const mps = [...ECLETICA, mp('e9', 'Bolo de milho')];
  const r = itemDeEstoqueDaProducao('bolo de MILHO', { produtosProducao: [], materiasPrimas: mps });
  assert.equal(r.mp.id, 'e9');
  assert.equal(r.origem, 'nome');
});

test('⚠️ o resolvedor NUNCA chuta por semelhança', () => {
  // Semelhança é sugestão de tela; baixar saldo por palpite é o erro que este
  // módulo existe para evitar.
  assert.equal(itemDeEstoqueDaProducao('Coxinha de frango', { produtosProducao: [], materiasPrimas: ECLETICA }), null);
});

test('vínculo apontando para produto excluído cai no nome, não quebra', () => {
  const produtosProducao = [{ id: 'c1', nome: 'Coxinha de frango', mpId: 'sumiu' }];
  assert.equal(itemDeEstoqueDaProducao('Coxinha de frango', { produtosProducao, materiasPrimas: ECLETICA }), null);
});

test('apelidos: o fechamento do pedido precisa conhecer os dois nomes', () => {
  const produtosProducao = [
    { id: 'c1', nome: 'Coxinha de frango', mpId: 'e1' },
    { id: 'c2', nome: 'Coxinha frango grande', mpId: 'e1' },
    { id: 'c3', nome: 'Bolo de milho', mpId: 'e4' },
  ];
  assert.deepEqual(apelidosDoItem('e1', produtosProducao), ['Coxinha de frango', 'Coxinha frango grande']);
  assert.deepEqual(apelidosDoItem('nao-existe', produtosProducao), []);
});

// ── Recheio ──────────────────────────────────────────────────────────────
const FRANGO = mp('r1', 'Frango cremoso');
const FICHA_CROISSANT = { id: 'f1', nome: 'Croissant de frango', insumos: [{ mpId: 'r1', nome: 'Frango cremoso', quantidade: 2 }] };

test('recheio é reconhecido pela ficha que o usa como insumo', () => {
  assert.equal(ehRecheio('Frango cremoso', { fichasTecnicas: [FICHA_CROISSANT], mp: FRANGO }), true);
});

test('⚠️ recheio MARCADO no catálogo vale antes de existir ficha', () => {
  // Era o buraco: recheio recém-criado ficava sem identidade até alguém
  // escrever a ficha que o consome.
  const produtosProducao = [{ id: 'c1', nome: 'Frango cremoso', recheio: true }];
  assert.equal(ehRecheio('Frango cremoso', { produtosProducao, fichasTecnicas: [], mp: FRANGO }), true);
});

test('produto normal não vira recheio', () => {
  assert.equal(ehRecheio('Coxinha de frango', { produtosProducao: [{ id: 'c2', nome: 'Coxinha de frango' }], fichasTecnicas: [FICHA_CROISSANT], mp: ECLETICA[0] }), false);
});

test('ficha casa o insumo pelo mpId e, sem ele, pelo nome', () => {
  assert.equal(fichasQueUsam(FRANGO, [FICHA_CROISSANT]).length, 1);
  const porNome = { id: 'f2', nome: 'Esfirra', insumos: [{ nome: 'FRANGO CREMOSO', quantidade: 1 }] };
  assert.equal(fichasQueUsam(FRANGO, [porNome]).length, 1);
  assert.equal(fichasQueUsam(null, [FICHA_CROISSANT]).length, 0);
});

// ── Quem pode receber produção ───────────────────────────────────────────
// `materiasPrimas` é "item com saldo": os 281 produtos do Eclética moram na
// mesma coleção que a farinha e a bandeja de isopor.
const DESPENSA = [
  { id: 'x1', nome: 'SALG COXINHA FRANGO', codigoEcletica: '318' },
  { id: 'x2', nome: 'Banana nanica', categoria: 'Hortifruti' },
  { id: 'x3', nome: 'Bandeja retangular de isopor', categoria: 'Descartáveis de consumo do produto' },
  { id: 'x4', nome: 'Frango cremoso', categoria: 'Outros' },
  { id: 'x5', nome: 'Torta banoffee' },
];
const TIPOS = { 'frango cremoso': 'produzido' };

test('produto do Eclética entra pelo CÓDIGO, mesmo sem marcação de tipo', () => {
  // Importar sem marcar é o normal (ver CLAUDE.md, "Produtos Eclética"):
  // exigir a marcação esconderia da busca justamente o cardápio.
  assert.equal(ehAlvoDeProducao(DESPENSA[0], {}), true);
});

test('recheio entra pelo tipo produzido — ele não tem código, não é vendido', () => {
  assert.equal(ehAlvoDeProducao(DESPENSA[3], TIPOS), true);
});

test('⚠️ insumo COMPRADO fica fora — era o bug da busca', () => {
  // A busca de "Torta Banoffee" respondia "bandeja retangular de isopor",
  // "banana nanica", "bandana preta". Pior que o ruído: ligar ali faria a
  // fornada entrar no saldo do que se compra, e só a contagem denunciaria.
  assert.equal(ehAlvoDeProducao(DESPENSA[1], {}), false);
  assert.equal(ehAlvoDeProducao(DESPENSA[2], {}), false);
  assert.deepEqual(candidatosDeVinculo(DESPENSA, TIPOS).map((m) => m.id), ['x1', 'x4']);
});

test('item sem código e sem marcação nenhuma não é chute de alvo', () => {
  // "produzido" nunca vem de palpite por categoria — só de marcação explícita.
  assert.equal(ehAlvoDeProducao(DESPENSA[4], {}), false);
});

test('⚠️ a SUGESTÃO automática também bebe da lista filtrada', () => {
  // O botão "aplicar as sugestões seguras" vincula em lote: com a despensa
  // inteira no balaio, ele ligaria produção a insumo comprado sem ninguém ver.
  const comprado = [{ id: 'c1', nome: 'Coxinha de frango congelada', categoria: 'Proteínas' }];
  assert.equal(sugerirVinculo('Coxinha de frango', comprado).mp.id, 'c1', 'sem filtro, casa com o comprado');
  assert.equal(sugerirVinculo('Coxinha de frango', candidatosDeVinculo(comprado, {})), null);
});
