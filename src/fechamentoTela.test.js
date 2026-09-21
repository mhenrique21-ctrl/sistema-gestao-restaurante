import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Trava, LENDO o `App.tsx`, a Fase 2 de Vendas (21/09/2026). Nada aqui o build
// ou o TypeScript acusam: é JSX válido fazendo a coisa errada.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const VENDAS = (() => {
  const i = APP.indexOf('function Vendas({db,setDb,setDbAndSave,state,aj,login,empresa}');
  assert.ok(i > 0, 'o componente Vendas sumiu do App.tsx');
  const j = APP.indexOf('\n// ===================== VENDAS → EMISSÃO DE RECIBOS', i);
  return APP.slice(i, j > 0 ? j : i + 60000);
})();

test('"Vendas Extras" não é criado de novo em lugar nenhum', () => {
  // ⚠️ Era o MESMO campo do delivery, com rótulo configurável. Criar um campo
  // novo partiria o histórico em dois e deixaria o recibo órfão.
  assert.ok(!/legVendasExtras:aj\.legVendasExtras/.test(VENDAS), 'o rótulo antigo voltou ao componente');
  assert.ok(VENDAS.includes('const legDelivery=rotuloDelivery(aj);'),
    'o rótulo parou de passar pela tradução do legado');
  // O campo gravado continua sendo `delivery` — o rename é de NOME, não de campo.
  assert.ok(VENDAS.includes('delivery:deliveryValorSalvar'), 'o campo gravado deixou de ser `delivery`');
});

test('o recibo de balcão tem bucket próprio e CARIMBA onde somou', () => {
  assert.ok(APP.includes('[BUCKET_RECIBO_BALCAO]:totalVenda'), 'o recibo voltou a somar em outro campo');
  assert.ok(APP.includes('bucket:BUCKET_RECIBO_BALCAO}'), 'o recibo parou de carimbar o bucket');
  // ⚠️ Sem o carimbo, desfazer um recibo antigo pelo bucket novo deixaria o
  // valor preso em `delivery` para sempre. Data de corte seria palpite.
  assert.ok(APP.includes("(r.bucket||\"delivery\")"), 'o fallback do recibo antigo saiu');
});

test('o "Total do dia" soma TODA linha que não foi digitada aqui', () => {
  // ⚠️ Filtrava só `ehOrigemPdv`: a linha do iFood importado (`relatorio_ifood`)
  // e a do recibo (`recibo_venda`) somavam no Dashboard e na DRE e sumiam
  // justamente do número que a pessoa usa para conferir o fechamento.
  assert.ok(VENDAS.includes('origemVenda(v)!=="manual"&&v.id!==editId'),
    'o total do dia voltou a ignorar origens que não são "pdv"');
});

test('manual x automático é decidido pelo DIA, não pelo canal', () => {
  // ⚠️ Fixar o grupo por canal deixaria a pessoa SEM CAMPO justamente no dia em
  // que o automático não veio — o único dia em que ela precisa digitar.
  assert.ok(VENDAS.includes('grupo:ehAuto?"auto":"manual"'), 'o grupo do card virou fixo por canal');
  assert.ok(VENDAS.includes('const cardsManuais=cardsAtivos.filter'), 'a seção manual saiu');
  assert.ok(VENDAS.includes('const cardsAuto=cardsAtivos.filter'), 'a seção automática saiu');
});

test('o progresso e as pendências saem do MESMO objeto', () => {
  // Duas contas do que falta divergiriam no dia em que uma mudasse, e a barra
  // diria 4/5 ao lado de uma lista de duas.
  assert.ok(VENDAS.includes('const progresso=progressoDoDia(cardsAtivos);'), 'o progresso saiu do módulo');
  assert.ok(VENDAS.includes('const pendencias:string[]=progresso.faltando;'),
    'as pendências voltaram a ser contadas por conta própria');
  assert.ok(!VENDAS.includes('pendencias.push('), 'a lista manual de pendências voltou');
});

test('o card com input é FUNÇÃO, não componente inline', () => {
  // ⚠️ Componente declarado dentro do render é recriado a cada render e o React
  // desmonta a árvore dele: o input perderia o foco a cada tecla. É a lição do
  // `linhaJsx` da Produção do Dia.
  assert.ok(VENDAS.includes('const cardFechamentoJsx=(c:any)=>{'), 'o card deixou de ser função');
  assert.ok(!/function CardFechamento|const CardFechamento=\(/.test(VENDAS),
    'o card virou componente — o input desmonta a cada tecla');
});

test('o marcador de loja fechada grava null ao desmarcar', () => {
  // ⚠️ `fechamentos[dia]` funde por união rasa: chave removida volta do outro
  // aparelho no POST seguinte. É a lição do `marcados`.
  assert.ok(VENDAS.includes('semMovimento:semMovimento?null:{por:'),
    'desmarcar voltou a apagar a chave em vez de gravar null');
  assert.ok(VENDAS.includes('Sem movimento / loja fechada neste dia'), 'o marcador saiu da tela');
});

test('a Supervisão do PDV separa fechado de pendente', () => {
  // A tela dizia, com todas as letras, "loja fechada ou falha no envio do PDV".
  assert.ok(!APP.includes('loja fechada ou falha no envio do PDV'), 'o texto que admitia não saber voltou');
  assert.ok(APP.includes('const diasFechadosMarcados=diasZerados.filter'), 'a separação saiu do Dashboard');
  assert.ok(APP.includes('const diasAguardando=diasZerados.filter'), 'o "dentro do horário" saiu');
});

test('a IA de comprovantes saiu de Vendas por inteiro', () => {
  for (const resto of ['iaComb', 'PROMPT_COMBINADO', 'iaAberta', 'Ler comprovantes com IA', 'aplicarResultadoCombinado']) {
    assert.ok(!APP.includes(resto), `sobrou resíduo da IA de Vendas: ${resto}`);
  }
  // E o aviso de não recriar por engano fica no lugar dela.
  assert.ok(VENDAS.includes('Não recrie por engano'), 'o aviso de não recriar saiu');
});

test('o histórico é accordion e o status é ESCRITO, não só a bolinha', () => {
  assert.ok(VENDAS.includes('const [diasAbertos,setDiasAbertos]'), 'o accordion saiu');
  assert.ok(VENDAS.includes('{aberto&&<div style={{overflowX:"auto"'), 'a tabela voltou a ficar sempre aberta');
  // ⚠️ A paleta Tinta é monocromática: a regra "status nunca só por cor" (§8)
  // vale na tela também, não só no papel.
  assert.ok(VENDAS.includes('{stDia.rotulo}</div>}'), 'o rótulo do status virou só cor');
  // A bolinha e o card usam o MESMO statusDoDia.
  assert.equal((VENDAS.match(/statusDoDia\(\{/g) || []).length, 2, 'o status do dia virou duas regras');
});

test('uma lista de modalidades, e ela inclui os dois recibos', () => {
  // Eram TRÊS cópias e as três esqueceram `entregasClientes`: o dinheiro do
  // recibo de encomenda somava no total e sumia do gráfico e dos dois papéis.
  assert.ok(APP.includes('const MODAIS_VENDA=["maquininha","dinheiro","ifood","99food","delivery","recibosBalcao","entregasClientes"]'),
    'a lista de modalidades mudou de forma');
  assert.equal((APP.match(/const modais=MODAIS_VENDA;/g) || []).length, 3,
    'algum leitor voltou a ter a própria cópia da lista');
  assert.ok(!APP.includes('(v.nfood||0)'), 'o campo inexistente `v.nfood` voltou ao denominador');
});

test('a taxa das plataformas vem da função testada', () => {
  assert.ok(APP.includes('const taxasPlat=taxasDePlataforma(vendas);'), 'a DRE voltou a calcular a taxa no JSX');
  assert.ok(APP.includes('const despVendas=taxasPlat.total;'), 'despVendas mudou de fonte');
  // ⚠️ E o bruto é escrito em função dela, senão as duas linhas divergem.
  assert.ok(APP.includes('const vendasBrutas=vendas.reduce((s,v)=>s+(v.total||0),0)+despVendas;'),
    'a relação entre bruto e taxa deixou de ser explícita');
});
