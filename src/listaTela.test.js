import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const FORM = (() => {
  const i = APP.indexOf('function InlineEditItem(');
  assert.ok(i > 0, 'InlineEditItem sumiu');
  const j = APP.indexOf('\nfunction ', i + 30);
  return APP.slice(i, j > 0 ? j : i + 20000);
})();

const LISTA = (() => {
  const i = APP.indexOf('function ListaComprasPanel(');
  assert.ok(i > 0, 'ListaComprasPanel sumiu');
  const j = APP.indexOf('\nfunction ', i + 30);
  return APP.slice(i, j > 0 ? j : i + 90000);
})();

test('criar categoria na Lista deixou de existir', () => {
  // ⚠️ Não era conveniência: era a CAUSA. O campo livre era o único jeito de
  // marcar "onde eu compro isso", e foi assim que "queijo minas" e "cia do
  // sorveteiro" viraram categoria.
  assert.ok(!/const addCat=/.test(LISTA), 'a criação de categoria voltou à Lista');
  assert.ok(!/const renameCat=/.test(LISTA), 'renomear categoria voltou — e renomear quebra vínculo por nome (§5)');
  assert.ok(!LISTA.includes('Nova categoria...'), 'o campo livre de categoria voltou');
});

test('a categoria do item é FECHADA e obrigatória', () => {
  assert.ok(FORM.includes('{CATS_LISTA.map(c=><option'), 'o select parou de usar a taxonomia fechada');
  assert.ok(!FORM.includes('<option value="">Sem categoria</option>'),
    '"Sem categoria" voltou — era ela que deixava o item cair em lugar nenhum');
});

test('a tela de Ruas e suas funções foram apagadas', () => {
  // Bloco pendurado num `sub` que nada seleciona é tela em branco sem erro
  // nenhum — a armadilha do ABA_REL_ANTIGA.
  assert.ok(!APP.includes('{id:"lista-rua"'), 'a entrada de menu "Ruas" voltou');
  assert.ok(!/const showRuaMgmt=/.test(APP), 'a tela de Ruas voltou');
  for (const f of ['const delRua=', 'const renameRua=', 'const moverRua=']) {
    assert.ok(!APP.includes(f), `a edição livre de rua voltou: ${f}`);
  }
  assert.ok(APP.includes('sub:"locais"'), 'a tela de Locais sumiu do menu');
});

test('local é INATIVADO, nunca excluído', () => {
  // ⚠️ Item antigo aponta pelo id: apagando o cadastro, a lista arquivada deixa
  // de dizer onde aquilo foi comprado.
  assert.ok(LISTA.includes('const alternarLocalAtivo='), 'o inativar sumiu');
  assert.ok(!/locaisCompra:\(d\.locaisCompra\|\|\[\]\)\.filter/.test(LISTA),
    'alguém pôs um excluir de local');
});

test('o corredor só aparece quando o local TEM corredor', () => {
  // Num mercadinho sem corredor numerado, o campo seria uma pergunta sem
  // resposta — e "Rua 7" existe em mais de uma loja, então ele nunca fica solto.
  assert.ok(FORM.includes('if(!loc?.corredores?.length)return null;'),
    'o corredor voltou a aparecer sempre');
  assert.ok(FORM.includes('setF("localId",e.target.value);setF("corredor","")'),
    'trocar de local parou de limpar o corredor — ficaria a Rua 7 de outra loja');
});

test('a migração NÃO converte nada sozinha', () => {
  // ⚠️ "Rua 7" não diz de qual loja é; adivinhar mandaria o item para o mercado
  // errado e a lista sairia impossível de seguir sem ninguém entender por quê.
  assert.ok(LISTA.includes('planoDeMigracao({listaCompras'), 'o plano saiu do módulo');
  assert.ok(LISTA.includes('criarLocalDaRua'), 'a criação local-a-local sumiu');
  assert.ok(LISTA.includes('não mexe'), 'o aviso de que criar não altera item nenhum saiu');
});

test('"Tem na Loja" digitado à mão deu lugar ao saldo real', () => {
  // ⚠️ O número que aparecia podia ter sido escrito três semanas antes.
  assert.ok(!LISTA.includes('setF("estoqueQtd"'), 'o campo digitado à mão voltou');
  assert.equal((LISTA.match(/saldoDoItem\(\{/g) || []).length, 3,
    'o saldo real sumiu de algum lugar (form + duas listas)');
});

test('o elo com Compras enche o CARRINHO, não lança a compra', () => {
  // ⚠️ A lista não sabe preço, e preço é o que a compra existe para registrar.
  // Lançar sozinho criaria entrada com valor zero, que estraga o CMV calado.
  assert.ok(LISTA.includes('const lancarEmCompras='), 'o elo sumiu');
  assert.ok(LISTA.includes('contabilDaLista(categoriaFechada('),
    'a categoria parou de ser traduzida para a contábil na ponte');
  assert.ok(APP.includes('valorUnit:"",valorTotal:"",'), 'o preço deixou de ir em branco');
  // ⚠️ E a entrega esvazia ao ser lida, senão voltar à aba enche o carrinho de novo.
  assert.ok(APP.includes('export const tomarRascunhoCompras=()=>{const r=_rascunhoCompras;_rascunhoCompras=[];return r;};'),
    'o rascunho parou de esvaziar na leitura');
  assert.ok(!/\brascunhoCompras:\[\]/.test(APP) && !APP.includes('d.rascunhoCompras'),
    'o rascunho virou campo no db — é estado de navegação, não dado do negócio');
});

test('locaisCompra está nas DUAS fusões', () => {
  // A armadilha que já mordeu seis vezes (§3).
  assert.ok(APP.includes("next[emp].locaisCompra=mergeArrayById(s.locaisCompra||[]"), 'falta no cliente');
  const SRV = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mergeDocument.js'), 'utf8');
  assert.ok(SRV.includes("'locaisCompra',"), 'falta no servidor');
});
