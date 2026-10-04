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

const SRV = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'new_server.js'), 'utf8');

test('o aviso de mudança nasce de UM lugar: o disco', () => {
  // ⚠️ Chamar `avisarMudanca()` em cada rota que grava é a receita de "cinco
  // cópias da mesma regra, e uma fica para trás": além do POST de dados gravam
  // o `/api/venda-pdv`, a migração de senha na subida, e o que vier depois.
  // Vigiando mtime+tamanho, QUALQUER escritor entra — inclusive um futuro.
  assert.ok(SRV.includes('const sseClientes = new Set();'), 'a lista de ouvintes sumiu');
  assert.ok(/const _vigia = setInterval\(/.test(SRV), 'o vigia do disco sumiu');
  assert.ok(SRV.includes('if (!sseClientes.size) return;'),
    'o vigia parou de desistir quando ninguém escuta — statSync a cada 250ms por nada');
  // Uma chamada só de avisarMudanca: a do vigia.
  assert.equal((SRV.match(/avisarMudanca\(/g) || []).length, 2,
    'apareceu um segundo ponto que avisa mudança — é por aí que uma rota fica para trás');
});

test('a rota do SSE passa pelo MESMO portão das rotas de dados', () => {
  const i = SRV.indexOf("urlPath === '/api/eventos'");
  assert.ok(i > 0, 'a rota do SSE sumiu');
  const rota = SRV.slice(i, i + 2200);
  assert.ok(rota.includes('if (barrouDados(req, res)) return;'),
    'o SSE ficou aberto sem sessão — o aviso diz quando a empresa mudou, e isso é informação');
  assert.ok(rota.includes("'text/event-stream'"), 'o content-type saiu');
  // ⚠️ Sem isto o Nginx segura o fluxo no buffer e nada chega até a conexão
  // fechar: "o SSE não funciona em produção e funciona local".
  assert.ok(rota.includes("'X-Accel-Buffering': 'no'"), 'o anti-buffer do Nginx saiu');
  // ⚠️ Proxy e operadora fecham conexão parada.
  assert.ok(/setInterval\(\(\) => \{ try \{ res\.write\(': ping/.test(rota), 'o batimento sumiu');
  assert.ok(rota.includes("req.on('close', encerrar)"), 'o cliente morto deixou de ser removido');
});

test('o poll continua existindo, de rede de segurança', () => {
  // ⚠️ O SSE depende de uma conexão aberta atravessar proxy, operadora e o
  // Wi-Fi da loja — e quando ela cai o silêncio é IDÊNTICO a "nada mudou".
  // Sem o poll por baixo, a lista congelaria sem nada denunciando.
  assert.ok(APP.includes('const t=setInterval(poll,interval);'), 'o poll foi removido');
  assert.ok(APP.includes('sseVivoRef.current\n      ?((tab==="lista"||tab==="producao")?5000:15000)'),
    'o poll parou de afrouxar/apertar conforme o SSE estar de pé');
  assert.ok(APP.includes('es?.close();'), 'o EventSource deixou de ser fechado na limpeza do efeito');
  // ⚠️ A MESMA versaoRef do poll: duas contas do "já vi esta versão" fariam o
  // aparelho baixar 3 MB a cada aviso, inclusive o da gravação dele mesmo.
  const i = APP.indexOf('es.addEventListener("dados"');
  assert.ok(i > 0, 'o ouvinte do aviso sumiu');
  assert.ok(APP.slice(i, i + 900).includes('versaoRef.current[emp]===v'),
    'o aviso parou de comparar com a versão que o poll já conhece');
});

test('o recorte da Lista NÃO entra cru na fusão', () => {
  // ⚠️ É A ARMADILHA QUE JÁ MORDEU SEIS VEZES (§3): `mergeFromServer` monta
  // `next[emp]={...servidor,...campos fundidos}`, com o SERVIDOR de base. Um
  // documento parcial como base apagaria vendas, compras e folha no primeiro
  // poll. Deitado sobre o estado local, todo campo fora do recorte funde
  // local-contra-local e não muda nada.
  assert.ok(APP.includes('const buscarRecorteDaLista=async(emp:string)=>{'), 'o recorte sumiu do cliente');
  const i = APP.indexOf('const buscarRecorteDaLista=async');
  const fn = APP.slice(i, i + 1200);
  assert.ok(fn.includes('mergeFromServer(prev,{[emp]:{...prev[emp],...parcial}})'),
    'o recorte deixou de entrar deitado sobre o estado local — ou ganhou uma segunda fusão');
  // ⚠️ Uma segunda fusão só para a Lista divergiria da primeira no dia em que
  // uma mudasse: "na aba Lista atualiza certo, no resto do app não".
  assert.ok(!/fundirLista|mergeLista\(/.test(fn), 'apareceu uma fusão própria para o recorte');
  // ⚠️ Quem carimba "já vi esta versão" é o ciclo do documento inteiro. Marcando
  // no recorte, uma venda do PDV seria dada como vista sem ser baixada.
  assert.ok(!fn.includes('versaoRef'), 'o recorte passou a carimbar a versão do documento inteiro');
});

test('o recorte não leva usuários — logo, não leva senha', () => {
  // A Fase 4 tirou a senha do documento que vai ao navegador pelo
  // `semUsuariosComSenha`. O recorte não passa por ele: ele vai inteiro. A
  // proteção aqui é a lista de campos não incluir `usuarios`.
  const i = SRV.indexOf('const CAMPOS_LISTA = [');
  assert.ok(i > 0, 'a lista de campos do recorte sumiu');
  const campos = SRV.slice(i, SRV.indexOf('];', i));
  assert.ok(!campos.includes('usuarios'), 'usuarios entrou no recorte, e com ele a senha em hash');
  for (const c of ['listaCompras', 'produtosLista', 'listaDeletedIds', 'listaAtualId']) {
    assert.ok(campos.includes(`'${c}'`), `${c} saiu do recorte`);
  }
});

test('o recorte é cacheado por mtime, não relido a cada pedido', () => {
  // ⚠️ Sem o cache, o parse de alguns MB aconteceria a cada pedido — é
  // exatamente o defeito que a rota `/versao` existe para não cometer.
  const i = SRV.indexOf('function recorteDaLista(emp) {');
  assert.ok(i > 0, 'recorteDaLista sumiu');
  const fn = SRV.slice(i, i + 900);
  assert.ok(fn.includes('if (cache && cache.marca === marca) return cache.texto;'),
    'o recorte voltou a reler e reparsear o arquivo a cada pedido');
  assert.ok(fn.includes('marcaDoArquivo(emp)'), 'o recorte deixou de usar a marca do arquivo');
});

test('a lista NOVA do fechamento tem id determinístico', () => {
  // ⚠️ Com `uid()` cada aparelho que disparava o fechamento automático criava a
  // SUA lista nova; a fusão ficava com a do último a gravar, e todo item
  // inserido nesse meio nascia com o `listaId` perdedor — órfão, invisível, sem
  // nada avisando. É a mesma lição do `arq-<id>` três linhas acima, que já era
  // determinístico pelo mesmo motivo.
  const i = APP.indexOf('const arquivarLista=(auto:boolean,alvoId?:string)=>{');
  assert.ok(i > 0, 'arquivarLista sumiu');
  const fn = APP.slice(i, i + 5000);
  // Com várias listas abertas, arquivar a ativa primeiro tenta HERDAR outra
  // lista já aberta; só quando não sobra nenhuma é que nasce uma — e aí o id
  // dela tem que ser derivado, nunca inventado por aparelho.
  assert.ok(fn.includes('listaAtualId:herdeira||proximaListaId(alvo),'),
    'o id da lista nova voltou a ser por aparelho');
  assert.ok(fn.includes('const herdeira=proximaAtiva(derivada,alvo);'),
    'arquivar a lista aberta parou de herdar outra lista já aberta');
  assert.ok(!/listaAtualId:uid\(\)/.test(APP), 'alguém reintroduziu uid() como id de lista');
  assert.ok(fn.includes('id:"arq-"+alvo'), 'o id do pedido do arquivo deixou de ser determinístico');
});

test('o fallback de quem não tem lista é CONSTANTE', () => {
  // ⚠️ O carimbo do fallback é época ZERO de propósito, e no empate a fusão fica
  // com o servidor: um id por aparelho sempre perderia, e os itens que ele
  // carimbasse nasceriam órfãos.
  assert.ok(APP.includes('const idNovo=ID_LISTA_INICIAL;'),
    'o fallback voltou a inventar um id por aparelho');
  assert.ok(APP.includes('m[e].listaAtualAbertaEm=new Date(0).toISOString();'),
    'o fallback deixou de carimbar época zero — passaria a vencer um fechamento de verdade');
});

test('órfão de HOJE aparece para todo mundo e volta para a lista', () => {
  // ⚠️ Arquivar uma lista APAGA os itens dela: órfão é anomalia. O de um dia
  // anterior vai para o histórico; o de hoje é o item que a pessoa acabou de
  // digitar, e enterrá-lo no Arquivo é o pior desfecho.
  const i = APP.indexOf('const orfaosDeHoje:any[]=');
  assert.ok(i > 0, 'a separação dos órfãos de hoje sumiu');
  assert.ok(APP.includes('const trazerOrfaosDeHoje=()=>{'), 'a recuperação sumiu');
  const fn = APP.slice(APP.indexOf('const trazerOrfaosDeHoje=()=>{'), APP.indexOf('const recuperarOrfaos=()=>{'));
  // §3: do `d` da gravação, nunca do render — e com carimbo, senão o poll desfaz.
  assert.ok(fn.includes('const alvo=d.listaAtualId||listaAtualId;'),
    'passou a ler o listaAtualId do render em vez do `d` da gravação');
  assert.ok(fn.includes('updatedAt:ts'), 'parou de carimbar — a fusão devolveria o listaId perdedor');
  assert.ok(fn.includes('(setDbAndSave||setDb)'), 'voltou a gravar com setDb puro');
  // O aviso NÃO pode ser só do admin: quem está comprando é quem precisa ver.
  const banner = APP.indexOf('{orfaosDeHoje.length>0&&<div');
  assert.ok(banner > 0, 'o aviso dos órfãos de hoje sumiu');
  assert.ok(!APP.includes('{isAdmin&&orfaosDeHoje.length>0'),
    'o aviso dos órfãos de hoje virou só do admin — o operador voltaria a ficar sem saber');
});

test('listasCompra está nas DUAS fusões', () => {
  // A armadilha que já mordeu seis vezes (§3): campo novo fora de uma das duas
  // e o poll reverte a gravação antes do POST confirmar.
  assert.ok(APP.includes('listasCompra: mergeArrayById(s.listasCompra||[],p.listasCompra||[],_listaDeletados)'),
    'falta no cliente');
  const MD = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mergeDocument.js'), 'utf8');
  assert.ok(MD.includes("'listasCompra',"), 'falta no servidor');
});

test('arquivar uma lista tira o cadastro dela COM tombstone', () => {
  // ⚠️ `listasCompra` é fundido por id: sem tombstone o poll devolve a lista
  // arquivada para o trocador, e ela reaparece sozinha.
  const i = APP.indexOf('const arquivarLista=(auto:boolean,alvoId?:string)=>{');
  const fn = APP.slice(i, i + 5000);
  assert.ok(fn.includes('_listaDeletados.add(alvo);'), 'o cadastro da lista sai sem tombstone');
  assert.ok(fn.includes('listasCompra:(d.listasCompra||[]).filter((l:any)=>l.id!==alvo)'),
    'o cadastro da lista arquivada ficou no trocador');
  // O nome e o autor vão PARA DENTRO do arquivo, senão o histórico continua
  // identificando a compra só pela data.
  assert.ok(/nome:cad\?\.nome/.test(fn) && /criadaPor:cad\?\.criadaPor/.test(fn),
    'o arquivo parou de guardar nome e autor');
});

test('o fechamento das 48 h arquiva UMA por ciclo e nunca a aberta', () => {
  // ⚠️ `arquivarLista` é um setDbAndSave, que liga o save direto por até 5 s
  // (§3, armadilha nº 0): duas chamadas seguidas caem na janela uma da outra.
  const i = APP.indexOf('const ociosaRef=useRef<string|null>(null);');
  assert.ok(i > 0, 'a varredura das 48h sumiu');
  const fn = APP.slice(i, i + 1200);
  assert.ok(fn.includes('const ids=listasOciosas(listasDoDb,Date.now());'), 'a varredura mudou de fonte');
  assert.ok(!/ids\.forEach|for\s*\(const .* of ids\)/.test(fn),
    'voltou a arquivar várias de uma vez — cai na janela de 5s do save direto');
  assert.ok(fn.includes('arquivarRef.current(true,alvo);'), 'a varredura parou de arquivar o alvo');
  // Que a ativa e a vazia nunca saem é regra do módulo, com teste próprio lá.
  const MOD = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'listasAbertas.js'), 'utf8');
  assert.ok(MOD.includes('!l.ativa && l.itens > 0 && l.movimento > 0'),
    'a lista ativa, a vazia ou a sem data voltaram a poder ser arquivadas sozinhas');
});

test('a barra mostra o nome da lista aberta, para todo mundo', () => {
  // ⚠️ Com várias listas abertas, é o nome no topo que impede alguém de comprar
  // da lista A olhando para a B. É o preço da mudança, e a barra é o que paga.
  assert.ok(APP.includes('>LISTA ABERTA</div>'), 'a barra da lista aberta sumiu');
  assert.ok(APP.includes('{listaAberta?.nome||"Lista"}'), 'o nome saiu da barra');
  assert.ok(!APP.includes('{isAdmin&&subTab==="nova"&&<div className="card" style={{marginBottom:12,padding:"11px 13px"'),
    'a barra virou só do admin — quem compra é quem precisa dela');
  // Trocar de lista não pode ser adminOnly: quem compra é quem alterna.
  const menu = APP.slice(APP.indexOf('{id:"lista-abertas"'), APP.indexOf('{id:"lista-abertas"') + 120);
  assert.ok(!menu.includes('adminOnly'), 'o trocador de listas virou só do admin');
});

test('o nome em branco volta ao automático, e a prévia não congela', () => {
  const i = APP.indexOf('const criarLista=(nomeDigitado:string)=>{');
  assert.ok(i > 0, 'criarLista sumiu');
  assert.ok(APP.slice(i, i + 900).includes('nomeDaLista(nomeDigitado,agora,login?.label||"")'),
    'o nome parou de cair no automático quando vem em branco');
  // ⚠️ A prévia é calculada na hora de mostrar: congelada ao abrir a tela, quem
  // ficasse dois minutos decidindo criaria a lista com a hora errada no nome.
  assert.ok(APP.includes('placeholder={nomeAutomatico(new Date(),login?.label||"")}'),
    'a prévia do nome congelou');
});
