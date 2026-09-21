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

// ── A revisão no ato da entrada, e a tela de normalizar texto ───────────────
const REVISAO = (() => {
  const i = APP.indexOf('function RevisarEntradaModal');
  assert.ok(i > 0, 'RevisarEntradaModal sumiu do App.tsx');
  const j = APP.indexOf('\nfunction ', i + 10);
  return APP.slice(i, j > 0 ? j : APP.length);
})();
const MANUT = bloco('{subTab==="manutencao"');

test('os CINCO caminhos de entrada passam pelo mesmo portão', () => {
  // ⚠️ Cinco cópias da mesma conferência é como uma fica para trás — foi o que
  // aconteceu com a regra do fornecedor (quatro cópias, e a do Cupom IA
  // descartava o CNPJ).
  assert.equal((APP.match(/comRevisao\(/g) || []).length, 5,
    'algum caminho de entrada deixou de passar pela revisão (ou surgiu um sexto)');
});

test('a revisão só abre se houver o que revisar', () => {
  // Uma tela a mais em todo import, quase sempre vazia, é a tela que a pessoa
  // aprende a fechar sem ler — e aí a vez em que ela tinha algo passa igual.
  assert.ok(APP.includes('const precisa=linhas.filter((l:any)=>l.precisaCategoria||l.precoFora);'),
    'o filtro do que precisa de revisão saiu');
  assert.ok(/if\(!precisa\.length\)\{seguir\(\);return;\}/.test(APP),
    'a revisão passou a abrir mesmo sem pendência');
});

test('a correção vai por REF, não por estado', () => {
  // ⚠️ A gravação acontece no mesmo tique em que a revisão fecha: um useState
  // ainda não aplicado faria a compra entrar com o número velho — corrigido na
  // tela, errado no banco.
  assert.ok(APP.includes('const correcoesRef=useRef<Record<string,any>>({});'), 'a ref da correção saiu');
  assert.ok(APP.includes('correcoesRef.current=correcoesDaRevisao(revisao.linhas,escolhas);'),
    'a confirmação da revisão parou de gravar na ref');
  // E é limpa a cada import, senão a correção de uma nota vaza para a seguinte.
  assert.ok(APP.includes('correcoesRef.current={};\n    const linhas=linhasDaRevisao('),
    'a ref deixou de ser limpa no início de cada entrada');
});

test('os três imports aplicam a correção no item antes de virar compra', () => {
  assert.equal((APP.match(/\.map\(itemRevisado\)/g) || []).length, 3,
    'algum builder de compra deixou de aplicar a correção');
  // ⚠️ O nome NÃO é sobrescrito: é a chave, e renomear aqui desligaria o item
  // do produto que a conciliação acabou de escolher.
  assert.ok(APP.includes('const {nome,...campos}=c;'), 'o nome voltou a ser sobrescrito pela correção');
});

test('a entrada manual recebe o carrinho corrigido POR PARÂMETRO', () => {
  // `setCarrinho` só vale no render seguinte, e o corpo leria o carrinho antigo
  // do fechamento — gravando o número que a pessoa acabou de corrigir.
  assert.ok(APP.includes('const finalizarCompraJa=(carrinho:any[])=>{'),
    'o corpo da entrada manual voltou a ler o carrinho do estado');
  assert.ok(APP.includes('()=>finalizarCompraJa(carrinho.map('), 'o carrinho corrigido deixou de ser passado');
  assert.ok(!/comRevisao\(paraRevisar,\(\)=>\{[\s\S]{0,200}setCarrinho/.test(APP),
    'a correção do carrinho voltou a passar pelo estado');
});

test('a escolha da revisão é aprendida na MESMA gravação da compra', () => {
  // ⚠️ Dois `setDbAndSave` seguidos caem na janela de 5s da armadilha nº 0, e o
  // que se perderia é justamente o aprendizado.
  assert.equal((APP.match(/d=aprenderRevisao\(d\);/g) || []).length, 4,
    'algum caminho deixou de aprender a categoria escolhida');
  assert.ok(APP.includes('const aprenderRevisao=(d:any)=>Object.values(correcoesRef.current)'),
    'aprenderRevisao saiu');
});

test('a categoria BLOQUEIA e o preço tem escape explícito', () => {
  assert.ok(REVISAO.includes('pendenciasDaRevisao(linhas,escolhas'), 'a decisão saiu do módulo');
  assert.ok(REVISAO.includes('disabled={!pend.podeConfirmar'), 'o botão deixou de travar');
  assert.ok(REVISAO.includes('está certo, gravar assim'), 'o escape do preço saiu');
  // ⚠️ O preço mostrado nos campos é RECALCULADO: mostrar o antigo faria a
  // pessoa corrigir sem ver o efeito.
  assert.ok(REVISAO.includes('precoPorUnidadeBase({'), 'o preço deixou de ser recalculado na tela');
});

test('a normalização de texto mostra o que muda e NÃO conserta o caractere perdido', () => {
  assert.ok(MANUT.includes('resumoDoEncoding(db,foldNome)'), 'a prévia saiu do módulo');
  assert.ok(MANUT.includes('NÃO são consertados'), 'o aviso do caractere perdido saiu');
  assert.ok(MANUT.includes('Categorias que passam a ser UMA'),
    'a parte que muda relatório, não só texto, saiu da tela');
  // ⚠️ Os campos de texto são chaves de vínculo por nome: sem o carimbo a fusão
  // devolve a versão antiga no poll seguinte (§3).
  assert.ok(MANUT.includes('atualizadoEm:agora'), 'a gravação parou de carimbar');
  assert.ok(MANUT.includes('normalizarEncoding(d)'), 'a gravação parou de recalcular sobre o `d` do save');
});
