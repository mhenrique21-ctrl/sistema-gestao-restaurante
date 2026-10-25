// Trava a gravação item a item da Lista LENDO o App.tsx e o new_server.js.
// ============================================================================
// Nada disto o build ou o TypeScript acusam. As duas armadilhas que este
// arquivo existe para impedir são silenciosas:
//   - a operação cair no POST genérico de `/api/dados/` (que trata o corpo como
//     o documento inteiro e apaga o que ele não trouxer)
//   - a mudança da Lista ficar marcada como "já salva" sem ter subido (§3,
//     armadilha nº 0, pela porta nova)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(DIR, 'App.tsx'), 'utf8');
const SRV = fs.readFileSync(path.join(DIR, '..', 'new_server.js'), 'utf8');
const MD = fs.readFileSync(path.join(DIR, '..', 'mergeDocument.js'), 'utf8');
const MLC = fs.readFileSync(path.join(DIR, '..', 'mergeListaCompras.js'), 'utf8');

test('a rota da operação mora FORA de /api/dados/', () => {
  // Num servidor que ainda não a conhece, `/api/dados/<emp>/lista-op` cairia
  // no POST genérico — o corpo `{ops}` viraria o documento inteiro.
  assert.ok(SRV.includes("/^\\/api\\/lista-op\\/[^/]+$/.test(urlPath)"), 'a rota mudou de lugar');
  assert.ok(!/\/api\/dados\/[^'"`]*lista-op/.test(APP), 'o app voltou a chamar a operação dentro de /api/dados/');
  assert.ok(APP.includes('fetchSync(`/api/lista-op/${emp}`'), 'o app não chama a rota nova');
});

test('o app só aceita a resposta que traz a marca listaOp:1', () => {
  // O servidor antigo responde 200 com o index.html: sem a marca, a operação
  // seria dada como gravada sem ter sido.
  assert.ok(SRV.includes('{"ok":true,"listaOp":1,'), 'o servidor parou de marcar a resposta');
  assert.ok(APP.includes('if(r.ok&&resp?.listaOp===1){'), 'o app aceita resposta sem a marca');
  assert.ok(APP.includes('suporteOpsRef.current=false'), 'sem a marca, o app não volta ao caminho antigo');
});

test('o POST genérico recusa caminho com algo pendurado depois da empresa', () => {
  const i = SRV.indexOf("// Dados da empresa — POST (salvar)");
  assert.ok(i > 0);
  assert.ok(SRV.slice(i, i + 900).includes("urlPath.split('/').filter(Boolean).length !== 3"),
    'o POST de /api/dados/ voltou a aceitar qualquer sufixo como documento inteiro');
});

test('a rota passa pela porta dos dados e grava pelo mesmo backup do POST', () => {
  const i = SRV.indexOf("/^\\/api\\/lista-op\\/[^/]+$/.test(urlPath)");
  const rota = SRV.slice(i, i + 3000);
  assert.ok(rota.includes('if (barrouDados(req, res)) return;'), 'a rota ficou sem sessão');
  assert.ok(rota.includes('backupRotativo(emp, file);'), 'a rota grava sem backup');
  assert.ok(rota.includes('aplicarOpsLista('), 'a rota deixou de usar a regra testada');
  // E a rota fica ANTES do POST genérico, que casaria por startsWith.
  assert.ok(i < SRV.indexOf("// Dados da empresa — POST (salvar)"), 'a rota ficou depois do POST genérico');
});

test('a mudança da Lista só sai do auto-save quando a base já estava salva', () => {
  assert.ok(APP.includes('const changed=empresasComMudanca(state,antes).filter(e=>!listaLimpaRef.current.has(state[e]));'),
    'o auto-save deixou de reconhecer a mudança que já subiu item a item');
  assert.ok(APP.includes('const baseLimpa=(emp:string,obj:any)=>prevState.current?.[emp]===obj||listaLimpaRef.current.has(obj);'),
    'a regra da base limpa mudou — uma mudança pendente por baixo seria dada como salva');
  const i = APP.indexOf('const aplicarLocalLista=');
  assert.ok(APP.slice(i, i + 500).includes('baseLimpa(emp,antes)'), 'aplicarLocalLista marca sem conferir a base');
});

test('a fila sobrevive ao app fechar e tem três gatilhos de reenvio', () => {
  assert.ok(APP.includes('const FILA_OPS_KEY="_listaOpsPendentes";'), 'a fila saiu do localStorage');
  assert.ok(APP.includes('const t=setInterval(ir,10000);'), 'o reenvio de 10 s sumiu');
  assert.ok(APP.includes('window.addEventListener("online",ir);'), 'o reenvio ao voltar a rede sumiu');
  assert.ok(APP.includes('document.addEventListener("visibilitychange",vis);'), 'o reenvio ao voltar para o app sumiu');
  // Sem espaço para guardar, a operação não pode ficar só na memória.
  assert.ok(APP.includes('if(lerFilaOps().length!==f.length)return false;'), 'a fila aceita operação que não conseguiu guardar');
  assert.ok(APP.includes('idsListaPendentes?.has(item.id)&&'), 'o ⏳ do item pendente sumiu');
});

test('a operação de marcar leva o RESULTADO, não "inverta"', () => {
  // Reenviada da fila, "inverta" desfaria a si mesma.
  const i = APP.indexOf('const toggle=(id:string)=>{');
  const fn = APP.slice(i, i + 1600);
  assert.ok(fn.includes('[{tipo:"marcar",id,em:ts,campos:{comprado:nowComprado,'), 'a marcação virou relativa');
});

test('excluir passa pela lixeira e oferece desfazer; restaurar cunha id novo', () => {
  const i = APP.indexOf('const del=(id:string)=>{');
  const fn = APP.slice(i, i + 2000);
  assert.ok(fn.includes('[{tipo:"remove",id,por:quem,em:ts}]'), 'a exclusão não vai como operação');
  assert.ok(fn.includes('listaLixeira:'), 'o item excluído não vai para a lixeira');
  assert.ok(fn.includes('mostrarDesfazer('), 'o "Desfazer" sumiu');
  const r = APP.slice(APP.indexOf('const restaurarDaLixeira='), APP.indexOf('const restaurarDaLixeira=') + 1200);
  assert.ok(r.includes('id:uid()'), 'restaurar reaproveita o id morto — a fusão brigaria com a exclusão (§3)');
  assert.ok(r.includes('criadoEm:new Date(ts).toISOString()'),
    'restaurar manteve o criadoEm antigo — o relógio das 12h viraria a lista aberta inteira');
  assert.ok(APP.includes('{id:"lista-lixeira",label:"Lixeira",icon:"🗑️",sub:"lixeira"}'), 'a tela da lixeira saiu do menu');
});

test('listaLixeira está nas DUAS fusões e no recorte', () => {
  assert.ok(APP.includes('listaLixeira: lixeiraValida(mergeArrayById(s.listaLixeira||[],p.listaLixeira||[],'), 'falta no cliente');
  assert.ok(MD.includes("'listaLixeira',"), 'falta no servidor');
  const i = SRV.indexOf('const CAMPOS_LISTA = [');
  assert.ok(SRV.slice(i, SRV.indexOf('];', i)).includes("'listaLixeira'"), 'falta no recorte');
});

test('um teto só para o tombstone, e nenhum .slice(-5000) sobrando', () => {
  for (const [nome, txt] of [['App.tsx', APP], ['new_server.js', SRV], ['mergeDocument.js', MD], ['mergeListaCompras.js', MLC]]) {
    assert.ok(!txt.includes('.slice(-5000)'), `${nome} voltou a cortar o tombstone em 5000`);
  }
  assert.ok(MLC.includes('podarTombstones('), 'a fusão da lista deixou de podar sem perda');
});

test('a virada das 12h é do SERVIDOR, idempotente e com interruptor explícito', () => {
  assert.ok(SRV.includes("const LISTA_CICLO_LIGADO = String(process.env.LISTA_CICLO_12H || 'sim')"), 'o interruptor sumiu');
  // ⚠️ Com a config do .env (dias fechados e feriados): sem ela o servidor
  // cortaria no domingo enquanto a regra testada diz que domingo não tem corte.
  assert.ok(SRV.includes('virarListaNoCorte(doc, agora, CICLO)'), 'o servidor não usa a regra testada com a config do .env');
  assert.ok(SRV.includes('const CICLO = configDoCiclo(process.env);'), 'a config de dias fechados/feriados deixou de ser lida do .env');
  assert.ok(SRV.includes('proximoCorte(agora, CICLO)'), 'o "nada a fazer até o próximo corte" ignora os dias fechados');
  assert.ok(SRV.includes('setInterval(virarListasNoCorte, 60 * 1000)'), 'o relógio de 1 min sumiu');
});

test('órfão "de hoje" é o do DIA DA COMPRA, não do dia civil', () => {
  assert.ok(APP.includes('const orfaosDeHoje:any[]=orfaosTodos.filter((i:any)=>diaDaCompra(i.criadoEm)===compraDeHoje);'),
    'a separação dos órfãos voltou a usar today()');
});
