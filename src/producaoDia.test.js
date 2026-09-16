import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularLinha, calcularProducaoDia, aplicarProducaoDia, baixarPedidos } from './producaoDia.js';

let n = 0;
const uid = () => `id${++n}`;
const AGORA = '2026-09-15T08:00:00.000Z';
const DATA = '2026-09-15';

// Fornada real: 50 pães de queijo, ficha rende 50.
const FICHA = {
  id: 'f1', nome: 'Pão de Queijo', porcoes: 50,
  insumos: [
    { mpId: 'm1', nome: 'Polvilho azedo', quantidade: 3, unidade: 'kg', custo: 14.7 },
    { mpId: 'm2', nome: 'Queijo meia cura', quantidade: 2.4, unidade: 'kg', custo: 62.4 },
    { mpId: 'm3', nome: 'Ovos', quantidade: 30, unidade: 'un', custo: 21 },
  ],
};
const db = () => ({
  materiasPrimas: [
    { id: 'p1', nome: 'Pão de Queijo', unidade: 'un', estoqueAtual: 0, ultimoValor: 0 },
    { id: 'm1', nome: 'Polvilho azedo', unidade: 'kg', estoqueAtual: 8, ultimoValor: 4.9 },
    { id: 'm2', nome: 'Queijo meia cura', unidade: 'kg', estoqueAtual: 6, ultimoValor: 26 },
    { id: 'm3', nome: 'Ovos', unidade: 'un', estoqueAtual: 60, ultimoValor: 0.7 },
  ],
  movEstoque: [],
});
const calc = (linhas, base = db()) =>
  calcularProducaoDia({ db: base, linhas, resolverFicha: (i) => (i.id === 'p1' ? FICHA : null) });

test('o custo da fornada é o que os insumos custaram', () => {
  // 3 kg × 4,90 + 2,4 kg × 26 + 30 un × 0,70 = 14,70 + 62,40 + 21,00
  const r = calc([{ itemId: 'p1', produzido: 50 }]);
  assert.equal(r.custoTotal, 98.10);
  assert.deepEqual(r.linhas[0].insumos.map((i) => i.qtd), [3, 2.4, 30]);
});

test('o custo unitário divide pelas BOAS, não pelo produzido', () => {
  // Assou 50, queimaram 3: os insumos de 50 saíram, mas só 47 entram. Dividir
  // por 50 daria um custo unitário que nenhuma unidade real tem.
  const r = calc([{ itemId: 'p1', produzido: 50, perda: 3 }]);
  const l = r.linhas[0];
  assert.equal(l.boas, 47);
  assert.equal(l.custoTotal, 98.10);
  assert.equal(l.custoUnitario.toFixed(4), '2.0872');   // 98,10 ÷ 47
  assert.ok(l.custoUnitario > 98.10 / 50, 'a perda encarece a unidade boa');
});

test('os insumos saem pelo produzido, não pelas boas', () => {
  // A farinha das 3 que queimaram saiu do estoque do mesmo jeito.
  const semPerda = calc([{ itemId: 'p1', produzido: 50 }]);
  const comPerda = calc([{ itemId: 'p1', produzido: 50, perda: 3 }]);
  assert.deepEqual(comPerda.insumos.map((i) => i.qtd), semPerda.insumos.map((i) => i.qtd));
});

test('sem ficha o custo é NULL, não zero', () => {
  // Zero diria "este bolo não custou nada" — a mentira que já existe hoje.
  const base = db();
  base.materiasPrimas.push({ id: 'p9', nome: 'Bolo Bombom de Uva', unidade: 'un', estoqueAtual: -2 });
  const r = calc([{ itemId: 'p9', produzido: 10 }], base);
  assert.equal(r.linhas[0].custoUnitario, null);
  assert.equal(r.linhas[0].custoTotal, 0);
  assert.ok(r.avisos.some((a) => a.aviso.includes('não tem ficha')));
});

test('linha em branco não é zero — fica de fora', () => {
  const r = calc([{ itemId: 'p1', produzido: '' }, { itemId: 'p1', produzido: 0 }]);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.custoTotal, 0);
});

test('perda maior que o produzido trava o registro', () => {
  const r = calc([{ itemId: 'p1', produzido: 10, perda: 12 }]);
  assert.equal(r.bloqueado, true);
  assert.ok(r.avisos.some((a) => a.aviso.includes('maior que o produzido')));
});

test('dois produtos que usam o mesmo insumo somam antes de mostrar o saldo', () => {
  // Cada um sozinho caberia no estoque; juntos, não. Mostrar o saldo depois de
  // cada linha prometeria estoque que não vai existir.
  const base = db();
  base.materiasPrimas.push({ id: 'p2', nome: 'Pão de Queijo Grande', unidade: 'un', estoqueAtual: 0 });
  const r = calcularProducaoDia({ db: base,
    linhas: [{ itemId: 'p1', produzido: 50 }, { itemId: 'p2', produzido: 50 }],
    resolverFicha: () => FICHA });
  const polvilho = r.insumos.find((i) => i.mp.id === 'm1');
  assert.equal(polvilho.qtd, 6);          // 3 + 3
  assert.equal(polvilho.antes, 8);
  assert.equal(polvilho.depois, 2);
});

test('insumo que não cobre a fornada aparece como negativo, não bloqueia', () => {
  // Mostrar a inconsistência é melhor que travar o registro do que já aconteceu.
  const base = db();
  base.materiasPrimas[1].estoqueAtual = 1;   // 1 kg de polvilho para 3 kg
  const r = calc([{ itemId: 'p1', produzido: 50 }], base);
  const polvilho = r.insumos.find((i) => i.mp.id === 'm1');
  assert.equal(polvilho.negativo, true);
  assert.equal(polvilho.depois, -2);
  assert.equal(r.bloqueado, false);
});

// ── Aplicação ──────────────────────────────────────────────────────────────
test('aplicar move produto, insumo e perda no MESMO grupo', () => {
  const base = db();
  const r = calc([{ itemId: 'p1', produzido: 50, perda: 3 }], base);
  const { materiasPrimas, movEstoque, grupoId } = aplicarProducaoDia({ db: base, calculo: r, data: DATA, agora: AGORA, uid });

  assert.equal(materiasPrimas.find((m) => m.id === 'p1').estoqueAtual, 47);
  assert.equal(materiasPrimas.find((m) => m.id === 'm1').estoqueAtual, 5);   // 8 − 3
  assert.equal(materiasPrimas.find((m) => m.id === 'm3').estoqueAtual, 30);  // 60 − 30

  const tipos = movEstoque.filter((m) => m.grupoId === grupoId).map((m) => m.tipo).sort();
  assert.deepEqual(tipos, ['entrada', 'perda', 'saida', 'saida', 'saida']);
  assert.equal(movEstoque.length, 5, 'tudo no mesmo lançamento');
});

test('o custo unitário passa a valer para o produto', () => {
  // É o que enche o valor do estoque de produzidos, hoje R$ 0,00.
  const base = db();
  const r = calc([{ itemId: 'p1', produzido: 50, perda: 3 }], base);
  const { materiasPrimas } = aplicarProducaoDia({ db: base, calculo: r, data: DATA, agora: AGORA, uid });
  assert.equal(materiasPrimas.find((m) => m.id === 'p1').ultimoValor, 2.09);  // 2,0872 arredondado
});

test('sem custo calculado, o valor antigo do produto é preservado', () => {
  // Zerar o custo que alguém pôs à mão seria pior que não ter calculado.
  const base = db();
  base.materiasPrimas.push({ id: 'p9', nome: 'Bolo', unidade: 'un', estoqueAtual: 0, ultimoValor: 12.5 });
  const r = calc([{ itemId: 'p9', produzido: 5 }], base);
  const { materiasPrimas } = aplicarProducaoDia({ db: base, calculo: r, data: DATA, agora: AGORA, uid });
  assert.equal(materiasPrimas.find((m) => m.id === 'p9').ultimoValor, 12.5);
  assert.equal(materiasPrimas.find((m) => m.id === 'p9').estoqueAtual, 5);
});

test('a perda vira movimento próprio, para dar pra medir a quebra do mês', () => {
  const base = db();
  const r = calc([{ itemId: 'p1', produzido: 50, perda: 3 }], base);
  const { movEstoque } = aplicarProducaoDia({ db: base, calculo: r, data: DATA, agora: AGORA, uid });
  const perda = movEstoque.find((m) => m.tipo === 'perda');
  assert.equal(perda.quantidade, 3);
  assert.equal(perda.mpId, 'p1');
  assert.ok(perda.descricao.includes('Perda'));
});

test('saldo negativo do produto é corrigido pela produção', () => {
  // O caso real: Bolo de Chocolate em −3 por venda sem produção registrada.
  const base = db();
  base.materiasPrimas.push({ id: 'p8', nome: 'Bolo de Chocolate', unidade: 'un', estoqueAtual: -3 });
  const r = calc([{ itemId: 'p8', produzido: 25, perda: 2 }], base);
  const { materiasPrimas } = aplicarProducaoDia({ db: base, calculo: r, data: DATA, agora: AGORA, uid });
  assert.equal(materiasPrimas.find((m) => m.id === 'p8').estoqueAtual, 20);   // −3 + 23
});

// ── Pedido da cozinha ──────────────────────────────────────────────────────
test('pedido fecha quando a quantidade bate', () => {
  const pedidos = [{ id: 'ped1', itens: [{ produtoId: 'p1', nome: 'Pão de Queijo', quantidade: 50 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: { p1: 50 } });
  assert.equal(r[0].status, 'atendido');
  assert.equal(r[0].itens[0].produzido, 50);
});

test('produziu menos: fica PARCIAL, o que falta não some', () => {
  // Fechar assim mesmo sumiria com a parte não feita, e ninguém lembraria dela.
  const pedidos = [{ id: 'ped1', itens: [{ produtoId: 'p1', nome: 'Pão de Queijo', quantidade: 50 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: { p1: 30 } });
  assert.equal(r[0].status, 'parcial');
  assert.equal(r[0].itens[0].produzido, 30);
  assert.equal(r[0].itens[0].atendido, false);
});

test('duas produções somam no mesmo pedido até fechar', () => {
  const pedidos = [{ id: 'ped1', itens: [{ produtoId: 'p1', quantidade: 50 }] }];
  const meio = baixarPedidos({ pedidos, produzidoPorItem: { p1: 30 } });
  const fim = baixarPedidos({ pedidos: meio, produzidoPorItem: { p1: 20 } });
  assert.equal(fim[0].status, 'atendido');
  assert.equal(fim[0].itens[0].produzido, 50);
});

test('pedido já atendido não é mexido de novo', () => {
  const pedidos = [{ id: 'ped1', status: 'atendido', itens: [{ produtoId: 'p1', quantidade: 50, produzido: 50 }] }];
  assert.deepEqual(baixarPedidos({ pedidos, produzidoPorItem: { p1: 10 } }), pedidos);
});

test('pedido de outro produto não é tocado', () => {
  const pedidos = [{ id: 'ped1', itens: [{ produtoId: 'pX', quantidade: 20 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: { p1: 50 } });
  assert.equal(r[0].status, undefined);
  assert.equal(r[0].itens[0].produzido, undefined);
});

// ── A ponte pedido ↔ produção ────────────────────────────────────────────
// Os testes acima usam `produtoId`, que NENHUM pedido real tem — foi por isso
// que o bug passou. Estes usam o formato que o Novo Pedido grava de verdade.
test('pedido do catálogo (só nome) fecha pelo nome — o formato real', () => {
  const pedidos = [{ id: 'ped1', itens: [{ nome: 'Bolo de chocolate', quantidade: 12, unidade: 'un' }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: { 'mp-bolo': 12 }, produzidoPorNome: { 'Bolo de chocolate': 12 } });
  assert.equal(r[0].status, 'atendido');
  assert.equal(r[0].itens[0].produzido, 12);
});

test('pedido manual (id próprio do item) também fecha pelo nome', () => {
  const pedidos = [{ id: 'ped1', itens: [{ id: 'uid-abc', nome: 'Esfirra de Frango', quantidade: 3 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: { 'mp-esf': 3 }, produzidoPorNome: { 'Esfirra de Frango': 3 } });
  assert.equal(r[0].status, 'atendido');
});

test('nome casa sem acento e sem diferença de caixa', () => {
  const pedidos = [{ id: 'ped1', itens: [{ nome: 'PÃO DE QUEIJO', quantidade: 50 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { 'pao de queijo': 50 } });
  assert.equal(r[0].status, 'atendido');
});

test('mesmo nome em duas categorias: o produzido é repartido em cascata', () => {
  // O catálogo cria um item por produto+categoria de propósito. Dar o total
  // cheio aos dois fecharia 15 tendo produzido 10.
  const pedidos = [{ id: 'ped1', itens: [
    { nome: 'Bolo de laranja', quantidade: 10, categoria: 'SEAMA' },
    { nome: 'Bolo de laranja', quantidade: 5, categoria: 'BARTOLOMEIA' },
  ] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { 'Bolo de laranja': 12 } });
  assert.equal(r[0].itens[0].produzido, 10);
  assert.equal(r[0].itens[0].atendido, true);
  assert.equal(r[0].itens[1].produzido, 2);      // sobrou 2 do orçamento
  assert.equal(r[0].itens[1].atendido, false);
  assert.equal(r[0].status, 'parcial');
});

test('produzir a MAIS não fecha mais do que foi pedido', () => {
  const pedidos = [{ id: 'ped1', itens: [{ nome: 'Bolo de milho', quantidade: 1 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { 'Bolo de milho': 24 } });
  assert.equal(r[0].itens[0].produzido, 1);
  assert.equal(r[0].status, 'atendido');
});

test('item já atendido não consome o orçamento de outro do mesmo nome', () => {
  const pedidos = [{ id: 'ped1', status: 'parcial', itens: [
    { nome: 'Empada de frango', quantidade: 4, produzido: 4, atendido: true },
    { nome: 'Empada de frango', quantidade: 3 },
  ] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { 'Empada de frango': 3 } });
  assert.equal(r[0].itens[1].produzido, 3);
  assert.equal(r[0].status, 'atendido');
});

test('dois pedidos em aberto do mesmo produto: o primeiro consome, o outro espera', () => {
  const pedidos = [
    { id: 'pedA', itens: [{ nome: 'Torta holandesa', quantidade: 1 }] },
    { id: 'pedB', itens: [{ nome: 'Torta holandesa', quantidade: 1 }] },
  ];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { 'Torta holandesa': 1 } });
  assert.equal(r[0].status, 'atendido');
  assert.equal(r[1].status, undefined);
});

test('sem produzidoPorNome, o comportamento antigo por produtoId continua valendo', () => {
  const pedidos = [{ id: 'ped1', itens: [{ produtoId: 'p1', nome: 'Pão de Queijo', quantidade: 50 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: { p1: 50 } });
  assert.equal(r[0].status, 'atendido');
});

test('apelido fecha o pedido quando o nome do estoque é outro (vínculo)', () => {
  // Pedido diz "Coxinha de frango"; a produção entrou em "SALG COXINHA FRANGO".
  const pedidos = [{ id: 'ped1', itens: [{ nome: 'Coxinha de frango', quantidade: 30 }] }];
  const r = baixarPedidos({
    pedidos, produzidoPorItem: { 'e1': 30 },
    produzidoPorNome: { 'SALG COXINHA FRANGO': 30 },
    apelidos: { 'Coxinha de frango': 'SALG COXINHA FRANGO' },
  });
  assert.equal(r[0].status, 'atendido');
  assert.equal(r[0].itens[0].produzido, 30);
});

test('⚠️ apelido é TRADUÇÃO: uma fornada não fecha os dois nomes', () => {
  // Os dois itens apontam para o mesmo produzido; só cabe 30 no total.
  const pedidos = [{ id: 'ped1', itens: [
    { nome: 'Coxinha de frango', quantidade: 30 },
    { nome: 'SALG COXINHA FRANGO', quantidade: 30 },
  ] }];
  const r = baixarPedidos({
    pedidos, produzidoPorItem: {},
    produzidoPorNome: { 'SALG COXINHA FRANGO': 30 },
    apelidos: { 'Coxinha de frango': 'SALG COXINHA FRANGO' },
  });
  assert.equal(r[0].itens[0].produzido, 30);
  assert.equal(r[0].itens[1].produzido, undefined, 'o segundo não pode fechar com a mesma fornada');
  assert.equal(r[0].status, 'parcial');
});

test('⚠️ o pedido alterado é CARIMBADO — sem isso a fusão descarta o fechamento', () => {
  // O merge do servidor desempata por atualizadoEm. Com a cópia do arquivo mais
  // nova, a versão ABERTA vencia e o fechamento sumia em silêncio.
  const pedidos = [{ id: 'ped1', atualizadoEm: '2026-09-13T20:11:56.696Z', itens: [{ nome: 'Bolo', quantidade: 10 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { Bolo: 10 }, agora: '2026-09-16T12:00:00.000Z' });
  assert.equal(r[0].atualizadoEm, '2026-09-16T12:00:00.000Z');
});

test('pedido não tocado não recebe carimbo novo', () => {
  const pedidos = [{ id: 'ped1', atualizadoEm: 'antes', itens: [{ nome: 'Outro', quantidade: 5 }] }];
  const r = baixarPedidos({ pedidos, produzidoPorItem: {}, produzidoPorNome: { Bolo: 10 }, agora: 'agora' });
  assert.equal(r[0].atualizadoEm, 'antes');
});
