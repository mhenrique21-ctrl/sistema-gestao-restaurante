import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Trava, LENDO o `App.tsx`, as quatro telas da Fase 1 de Compras (21/09/2026).
// Nada aqui é pego pelo build nem pelo TypeScript: é JSX válido que faz a coisa
// errada — a mesma classe de bug do `agruparMarcasTela.test.js` e do
// `vinculoSombra.test.js`.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const bloco = (marcador) => {
  const i = APP.indexOf(marcador);
  assert.ok(i > 0, `${marcador} sumiu do App.tsx`);
  // Até o próximo `{subTab===` depois do início do bloco.
  const j = APP.indexOf('\n    {subTab===', i + marcador.length);
  return APP.slice(i, j > 0 ? j : i + 20000);
};

const FILA = bloco('{subTab==="classificar"');
const DUP = bloco('{subTab==="dupforn"');
const PRECO = bloco('{subTab==="auditpreco"');
const VS = bloco('{subTab==="vsconsumo"');

test('as quatro telas estão no menu de Compras', () => {
  // ⚠️ Sem a entrada no menu o bloco fica pendurado: renderiza para um `sub`
  // que nada seleciona, e nem o build nem o TypeScript acusam — é a armadilha
  // do `ABA_REL_ANTIGA` e a dos cinco `setSub("inventario")` de 20/09.
  for (const sub of ['classificar', 'dupforn', 'auditpreco', 'vsconsumo']) {
    assert.ok(APP.includes(`sub:"${sub}"`), `falta a entrada de menu de ${sub}`);
  }
});

test('a fila sem categoria ordena pelo DINHEIRO parado por padrão', () => {
  // ⚠️ A tela antiga mostrava só a contagem de compras, e a fila de centenas de
  // nomes só encolhe se as primeiras linhas forem as que mais pesam no CMV.
  assert.ok(FILA.includes('filaSemCategoria(db.compras||[]'), 'a fila tem que vir do módulo');
  assert.ok(/useState<"valor"\|"compras"\|"nome">\("valor"\)/.test(APP), 'a ordem padrão saiu do valor parado');
  assert.ok(FILA.includes('parados'), 'falta o total parado no cabeçalho');
});

test('o LOTE da fila só pega quem tem palpite', () => {
  // ⚠️ Aplicar em massa no "sem palpite" mandaria tudo para uma categoria que
  // ninguém conferiu — que é exatamente como "Outros" cresceu.
  assert.ok(FILA.includes('l.temPalpite&&filaMarcados.has(l.chave)'),
    'o lote parou de filtrar por palpite');
  // A caixinha existe SÓ na linha com palpite: com ela na linha sem palpite, o
  // gesto de marcar em lote passaria a existir onde não há o que aplicar.
  assert.ok(/\{l\.temPalpite\s*\?<label/.test(FILA),
    'a caixinha de lote saiu de dentro da condição do palpite');
  assert.ok(FILA.includes('sem palpite'), 'falta a tag de quem não tem palpite');
});

test('classificar em lote é UMA gravação, não uma por linha', () => {
  // ⚠️ `setDbAndSave` liga o save direto por até 5s (§3): dez chamadas em
  // sequência é exatamente a janela em que a armadilha nº 0 mordia.
  const fn = APP.slice(APP.indexOf('const aplicarCategorias='), APP.indexOf('const aplicarCategorias=') + 1400);
  assert.equal((fn.match(/setDbAndSave\|\|setDb/g) || []).length, 1, 'virou uma gravação por linha');
  assert.ok(fn.includes('categoriaOriginal:c.categoriaOriginal||"Outros"'),
    'o histórico deixou de ser reescrito — o item continuaria fora do CMV');
});

test('mesclar fornecedor põe o TOMBSTONE antes da gravação', () => {
  // ⚠️ `fornecedores` é fundido por id (§3): sem marcar os removidos, o poll
  // seguinte devolve os três cadastros.
  const iTomb = DUP.indexOf('_listaDeletados.add');
  const iSave = DUP.indexOf('setDbAndSave||setDb');
  assert.ok(iTomb > 0, 'o tombstone dos fornecedores removidos sumiu');
  assert.ok(iTomb < iSave, 'o tombstone ficou DEPOIS da gravação — a fusão ressuscita os removidos');
});

test('a mescla grava a partir do `d`, não da prévia do render', () => {
  // A prévia (do `db` do render) existe só para o texto do confirm; a conta que
  // vale é refeita sobre o estado do momento do save (§3).
  assert.ok(DUP.includes('mesclarFornecedores(d,{canonicoId,idsRemovidos})'),
    'a gravação passou a reusar o resultado calculado no render');
  assert.ok(DUP.includes('compra(s) passam a apontar para ele'),
    'o confirm parou de dizer quantas linhas mudam antes de confirmar');
  assert.ok(DUP.includes('Não tem desfazer em um clique'), 'o aviso de que não há desfazer saiu');
});

test('a auditoria de preço não recalcula O(n²) a cada render', () => {
  assert.ok(/const auditoriaPreco=useMemo\(\(\)=>subTab==="auditpreco"\?auditarPrecos\(/.test(APP),
    'a auditoria saiu do useMemo ou deixou de ser condicionada ao subTab');
  // ⚠️ E o valor entra já numérico: compra antiga gravada como "1.234,56" seria
  // lida como zero pelo módulo e sairia da auditoria calada.
  assert.ok(APP.includes('valor:parseMoney(c.valor),quantidade:Number(c.quantidade)||0'),
    'as compras voltaram a entrar no módulo com o valor cru');
  // ⚠️ A régua é a mediana, e a tela precisa dizer isso: com a média, a própria
  // linha errada puxaria a referência e passaria a ABSOLVER o erro seguinte.
  assert.ok(PRECO.includes('mediana'), 'a tela parou de nomear a régua');
  assert.ok(PRECO.includes('não corrige nada'), 'falta dizer onde o lançamento se conserta');
});

test('a régua do painel de conciliação é ANTERIOR ao período medido', () => {
  // ⚠️ Incluindo o período, a compra exagerada entraria no próprio percentual
  // histórico e suavizaria o alerta sobre ela mesma: quanto mais fora da curva
  // o mês, menos ele apareceria.
  assert.ok(VS.includes('janelaAnterior(per.de,180)'), 'a régua voltou a incluir o período medido');
  assert.ok(VS.includes('de:jan.de,ate:jan.ate})'),
    'a régua parou de sair da janela anterior');
  assert.ok(VS.includes('Sem histórico antes deste período'), 'falta o caso de não haver régua');
});

test('o painel diz que mede DESCOMPASSO, não perda', () => {
  // Sem essa frase a pessoa lê "+24,6%" como desperdício — e num recorte curto
  // a diferença é calendário. É a mesma armadilha do CMV vazio da DRE.
  assert.ok(VS.includes('não é medida de perda'), 'o aviso de descompasso saiu da tela');
  assert.ok(VS.includes('sem referência'), 'categoria sem histórico precisa aparecer sem alerta');
});
