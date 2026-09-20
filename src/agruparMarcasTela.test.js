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

test('dá pra converter na própria linha "sem conversão"', () => {
  // Antes, resolver uma marca pendente exigia achá-la de novo pela busca lá em
  // cima e marcá-la — com sete marcas de açúcar na mesma lista, é rolagem e
  // troca de contexto a cada uma.
  const bloco = CARD.slice(CARD.indexOf('Grupos que já existem'));
  assert.ok(bloco.includes('salvarConversoes(p)'), 'falta o salvar da conversão no grupo');
  assert.ok(/value=\{conv\[m\.id\]\?\?""\}/.test(bloco), 'falta o campo por marca');
});

test('o campo da conversão NÃO depende do que se digita nele', () => {
  // ⚠️ Mesma armadilha de 20/09: campo cuja existência sai do próprio valor
  // some no meio da digitação e grava o primeiro dígito.
  const bloco = CARD.slice(CARD.indexOf('Grupos que já existem'));
  assert.ok(/const pend=!!l\?\.pendente;/.test(bloco),
    'a pendência tem que sair do que está GRAVADO na marca');
  assert.ok(!/pendente[^\n]*conv\[/.test(bloco), 'a pendência voltou a olhar o que está sendo digitado');
});

test('o palpite do nome não grava sozinho — só preenche o campo', () => {
  // "200X5G" pode ser a caixa de 200 sachês ou o sachê avulso. Gravando calado,
  // o grupo somaria 1.000 g onde havia 5, e o saldo continuaria plausível.
  const bloco = CARD.slice(CARD.indexOf('Grupos que já existem'));
  assert.ok(/onClick=\{\(\)=>setConv\(x=>\(\{\.\.\.x,\[m\.id\]:String\(sug\.valor\)\}\)\)\}/.test(bloco),
    'o botão do palpite tem que só preencher o campo');
  // A frase é montada em `palpiteDaMarca`, fora do bloco — o botão imprime ela.
  assert.ok(bloco.includes('{sug.de}'), 'a conta lida tem que ficar escrita ao lado do botão');
  assert.ok(CARD.includes('o nome diz '), 'o palpite tem que dizer o que leu no nome');
  assert.ok(!/sugerirRendimento[^\n]*setDbAndSave/.test(CARD), 'o palpite não pode ir direto pra gravação');
});

test('a conversão grava SÓ materiasPrimas', () => {
  // `porUnidadeBase` é campo da marca, que é por empresa. Passar por
  // applyBothProdutos gravaria a matéria-prima de uma empresa dentro da outra.
  const bloco = CARD.slice(CARD.indexOf('const salvarConversoes='), CARD.indexOf('const desagrupar='));
  assert.ok(bloco.includes('materiasPrimas:r.materiasPrimas'), 'falta a gravação da marca');
  assert.ok(!bloco.includes('applyBothProdutos'), 'produtosLista não muda numa conversão');
  assert.ok(bloco.includes('gravarRendimentos(d,vals)'), 'tem que ler o db da GRAVAÇÃO, não o do render');
});

test('a marca já conciliada sai da lista de trabalho', () => {
  // ⚠️ Marcar uma marca que já tem grupo é o gesto que a TIRA do grupo atual
  // (agruparMarcas). Ao lado das outras, com a mesma caixinha, isso acontece de
  // raspão no meio de uma seleção de oito.
  assert.ok(CARD.includes('separarAchados(achados,foldNome,db.produtosLista||[])'),
    'a busca tem que separar o que falta do que já está');
  assert.ok(CARD.includes('{achadosPendentes.map('), 'a lista de cima é só a dos pendentes');
  assert.ok(!/\{achados\.map\(/.test(CARD), 'a lista voltou a misturar conciliado com pendente');
});

test('a pasta agrupa pelo DESTINO e acusa nome repetido', () => {
  // Três produtos da lista chamados "Creme de leite caixa", "Creme de Leite em
  // Caixa" e "creme de leite caixa" existem no cadastro real. Em fila ninguém
  // liga um ao outro; a ficha lê UM deles e o resto fica fora do custo.
  const pasta = CARD.slice(CARD.indexOf('A pasta dos que já foram conciliados'), CARD.indexOf('{!!sel.size&&'));
  assert.ok(pasta.includes('achadosGrupos.map('), 'a pasta tem que ser por produto de destino');
  assert.ok(pasta.includes('g.iguais>1'), 'falta o aviso de nome repetido');
  assert.ok(pasta.includes('>trocar de grupo<'), 'o gesto precisa ter nome escrito aqui');
});

test('a pasta não some com a marca — o ✕ e a troca continuam alcançáveis', () => {
  const pasta = CARD.slice(CARD.indexOf('A pasta dos que já foram conciliados'), CARD.indexOf('{!!sel.size&&'));
  assert.ok(pasta.includes('desagrupar(g.prod.id,m.id,m.nome)'), 'o ✕ tem que continuar existindo na pasta');
  assert.ok(/setSel\(x=>new Set\(\[\.\.\.x,m\.id\]\)\)/.test(pasta),
    '"trocar de grupo" tem que marcar a marca, não gravar nada');
});

test('dá pra editar a conversão de QUALQUER linha do grupo, não só da pendente', () => {
  // O pack de 6 em "un" num grupo em "un" nunca foi pendência — a conversão
  // existia e dava 1. Sem editar linha que já converte, não havia como
  // corrigir pela tela onde o problema aparece.
  const bloco = CARD.slice(CARD.indexOf('Grupos que já existem'));
  assert.ok(bloco.includes('convAberto.has(m.id)'), 'falta o "editar" por linha');
  assert.ok(bloco.includes('>editar<'), 'falta o botão de editar na linha que já converte');
  assert.ok(bloco.includes('origem==="embalagem"'), 'a linha precisa dizer de ONDE veio o número');
});

test('a abertura do campo não depende do que se digita nele', () => {
  // ⚠️ Terceira vez que esta regra aparece: campo cuja existência sai do
  // próprio valor some no meio da digitação e grava o primeiro dígito.
  const bloco = CARD.slice(CARD.indexOf('Grupos que já existem'));
  assert.ok(/const aberto=pend\|\|!!avisoPack\|\|convAberto\.has\(m\.id\);/.test(bloco),
    'a abertura tem que sair só de pendência, aviso ou pedido explícito');
  assert.ok(!/aberto=[^\n;]*conv\[m\.id\]/.test(bloco), 'a abertura voltou a olhar o valor digitado');
});

test('o pack contado como 1 vira aviso na linha e no rodapé', () => {
  const bloco = CARD.slice(CARD.indexOf('Grupos que já existem'));
  assert.ok(bloco.includes('avisoDePack(m,base,foldNome)'), 'falta o aviso por marca');
  assert.ok(bloco.includes('pack de '), 'o aviso tem que dizer quantas unidades o nome declara');
  assert.ok(bloco.includes('avisosPack.length'), 'falta o total no rodapé do grupo');
});
