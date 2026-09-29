// Trava a sincronização da Lista de Compras LENDO o App.tsx.
// ============================================================================
// Nada disto o build ou o TypeScript acusam: é JSX/TS válido fazendo a coisa
// errada. O sintoma no campo é sempre o mesmo — "o item que eu insiro não
// aparece para os outros" — e a causa nunca foi perda de dado: era a gravação
// não terminar de subir, e o aparelho ficar cego enquanto ela não termina.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const SAVE_ITEM = (() => {
  const i = APP.indexOf('const saveItem=()=>{');
  assert.ok(i > 0, 'saveItem sumiu');
  const j = APP.indexOf('const startEdit=', i);
  return APP.slice(i, j > 0 ? j : i + 8000);
})();

test('inserir um item é UMA gravação, não três', () => {
  // ⚠️ A lista é da empresa ativa; `produtosLista` é compartilhado entre as duas
  // (§1). Eram duas chamadas seguidas — `setDbAndSave` e `applyBothProd` — e a
  // segunda gravava nas DUAS empresas por conta própria: três GET + três POST do
  // documento inteiro por item digitado, no 4G da loja.
  assert.ok(APP.includes('const setDbAndSave=(fn:(d:any)=>any,fnAmbas?:(d:any)=>any)=>{'),
    'setDbAndSave perdeu o updater do catálogo compartilhado');
  assert.ok(SAVE_ITEM.includes('salvarListaECatalogo('),
    'saveItem voltou a gravar por fora do caminho único');
  assert.ok(!/applyBothProd\(/.test(SAVE_ITEM) && !/syncProdByName\(/.test(SAVE_ITEM),
    'saveItem voltou a disparar uma segunda pipeline de gravação');
});

test('a gravação do catálogo liga o directSaveRef junto com a da lista', () => {
  // ⚠️ `applyBothProdutos` NÃO liga `directSaveRef`, então o poll caía no meio
  // dela. Passando pelo segundo parâmetro de `setDbAndSave`, as duas mudanças
  // vivem dentro da MESMA janela — e a empresa ativa sai num POST só.
  const i = APP.indexOf('const setDbAndSave=(fn:(d:any)=>any,fnAmbas?:(d:any)=>any)=>{');
  const corpo = APP.slice(i, i + 3000);
  assert.ok(corpo.includes('directSaveRef.current=true;'), 'o save direto parou de se anunciar');
  assert.ok(corpo.includes('next[e]=fnAmbas(next[e]);'), 'o catálogo saiu do save único');
  assert.ok(corpo.includes('for(const emp of outras)await postar(emp);'),
    'as empresas voltaram a ser gravadas em paralelo — as duas fundem sobre o mesmo state');
  assert.ok(corpo.includes("if(next[e].produtosLista!==antes&&e!==empresa)outras.push(e)"),
    'a outra empresa parou de entrar só quando o catálogo realmente mudou');
});

test('o id do produto novo nasce FORA do updater das duas empresas', () => {
  // ⚠️ `fnAmbas` roda uma vez POR EMPRESA (como o `applyBothProdutos` sempre
  // rodou), então `uid()` dentro dele dá um id DIFERENTE para o mesmo produto em
  // cada arquivo: dois cadastros do mesmo item, cada um plausível, que só a
  // fusão por nome disfarçava.
  assert.ok(SAVE_ITEM.includes('const idNovoProd=uid();'), 'o id do produto voltou para dentro do updater');
  const fnCat = SAVE_ITEM.slice(SAVE_ITEM.indexOf('const fnCat=(d:any)=>{'));
  assert.ok(fnCat.length > 100, 'o updater do catálogo sumiu');
  assert.ok(!/id:uid\(\)/.test(fnCat), 'o updater do catálogo voltou a cunhar id por empresa');
});

test('toda escrita da lista persiste — nunca setDb puro', () => {
  // A armadilha nº 0 do §3: setDb puro depende do auto-save genérico, que pode
  // coincidir com outro save e deixar a mudança pendente.
  const i = APP.indexOf('function ListaComprasPanel(');
  const j = APP.indexOf('\nfunction ', i + 30);
  const PANEL = APP.slice(i, j > 0 ? j : i + 90000);
  for (const fn of ['const toggle=', 'const del=', 'const limparComprados=', 'const setQtd=']) {
    const k = PANEL.indexOf(fn);
    assert.ok(k > 0, `${fn} sumiu`);
    const corpo = PANEL.slice(k, k + 700);
    assert.ok(corpo.includes('(setDbAndSave||setDb)') || corpo.includes('salvarListaECatalogo'),
      `${fn} voltou a gravar com setDb puro`);
  }
});
