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

test('o destino busca em TODA a lista de compras, não só nos sugeridos', () => {
  // ⚠️ Antes o destino era um <select> alimentado só pelos grupos que casavam
  // com a busca das MARCAS. Mandar um creme de leite para um produto chamado
  // "Laticínios" era impossível: ele nunca aparecia na lista, e não havia como
  // descobrir isso pela tela — o item simplesmente não estava lá.
  assert.ok(CARD.includes('const todosProdutos=db.produtosLista||[]'),
    'o destino tem que poder ver a lista inteira');
  assert.ok(/destinosVisiveis/.test(CARD), 'falta a lista filtrada do destino');
  assert.ok(!/<select className="inp" value=\{destino\}/.test(CARD),
    'o <select> preso aos sugeridos voltou');
});

test('a sugestão continua sendo o atalho, sem virar a única opção', () => {
  const bloco = CARD.slice(CARD.indexOf('const destinosVisiveis'), CARD.indexOf('const prodDestino'));
  assert.ok(bloco.includes('gruposCandidatos'), 'com a busca vazia, os sugeridos abrem a lista');
  assert.ok(bloco.includes('todosProdutos.filter'), 'digitando, procura em tudo');
});

test('dá pra trocar o destino depois de escolher', () => {
  // Sem isso, errar o destino obrigava a limpar a seleção inteira e recomeçar.
  assert.ok(CARD.includes('>trocar<'), 'falta o botão de trocar o destino');
});

test('a pasta conta insumo COMPRADO, não "item com saldo"', () => {
  // ⚠️ `materiasPrimas` é "item com saldo": os produtos do cardápio do Eclética
  // e o que é feito na cozinha moram lá dentro (§6, "cinco tipos, uma
  // coleção"). Nenhum dos dois pode ir para um produto da lista de compras, e
  // contá-los faz a fila nunca chegar a zero — que é o estado em que uma fila
  // deixa de ser lida. O tipo precisa entrar na chamada.
  assert.ok(/insumosSemGrupo\(db,foldNome,\(m:any\)=>tipoDoInsumo\(/.test(CARD),
    'a pasta voltou a contar a coleção inteira, sem olhar o tipo do item');
  assert.ok(CARD.includes('pasta.fora.cardapio'),
    'o que fica de fora tem que aparecer na tela: número que encolhe sem explicação levanta dúvida');
});

test('"conciliar" prepara a ferramenta e NÃO grava nada', () => {
  // A pasta é um atalho para a busca de baixo. Se ela mesma agrupasse, o
  // palpite viraria vínculo sem ninguém olhar — e desfazer um grupo errado é
  // trabalho manual, marca por marca.
  const bloco = CARD.slice(CARD.indexOf('const conciliar='), CARD.indexOf('const aplicar='));
  assert.ok(bloco.includes('setBusca(termoDeBusca('), 'o conciliar tem que jogar o termo na busca');
  assert.ok(!bloco.includes('applyBothProdutos') && !bloco.includes('setDbAndSave'),
    'o botão da pasta não pode gravar: quem grava é o "Agrupar", depois de a pessoa conferir');
});

test('o palpite de destino é por LINHA, nunca em lote', () => {
  // ⚠️ Em lote, um produto chamado "Leite" engoliria "Leite condensado" e
  // "Creme de leite Piracanjuba" de uma vez: o custo sairia do produto errado e
  // só apareceria no CMV, meses depois.
  const pasta = CARD.slice(CARD.indexOf('{/* ── A pasta'), CARD.indexOf('placeholder="Buscar marca'));
  assert.ok(pasta.includes('sugerirGrupo(db,it.nome,foldNome)'), 'falta o palpite da linha');
  assert.ok(!/aplicar.{0,20}sugest/i.test(pasta), 'apareceu um "aplicar sugestões" em lote na pasta');
});

test('a pasta oferece as três ordens que o dono pediu', () => {
  for (const modo of ['compra', 'semelhanca', 'nome']) {
    assert.ok(CARD.includes(`"${modo}"`), `falta a ordem por ${modo}`);
  }
  // A compra recente é o padrão: é o que se está comprando agora e é o que vai
  // cair na próxima ficha.
  assert.ok(/useState<"compra"\|"nome"\|"semelhanca">\("compra"\)/.test(CARD),
    'a ordem padrão tem que ser a compra mais recente');
});
