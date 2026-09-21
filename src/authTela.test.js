import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(raiz, 'src', 'App.tsx'), 'utf8');
const SRV = fs.readFileSync(path.join(raiz, 'new_server.js'), 'utf8');

// Trava, LENDO o código, a Fase 3 (21/09/2026). Nada disto o build acusa: é
// código válido que devolve o banco a quem pedir.

test('NENHUMA senha volta a ser escrita no código do cliente', () => {
  // ⚠️ `src/App.tsx` VIRA O BUNDLE que o navegador baixa: senha escrita aqui é
  // senha pública, e tornar o repositório privado não muda isso. Havia DUAS
  // portas — a lista `LOGINS` e o seed de usuários do `migrateDb` — e tirar só a
  // primeira deixou as senhas no bundle pela segunda.
  assert.ok(!/const LOGINS/.test(APP), 'a lista de senhas voltou ao cliente');
  assert.ok(!/senha:\s*["'][^"']+["']/.test(APP), 'alguém escreveu uma senha literal no cliente');
  for (const antiga of ['172839', '"1234"', '"4321"']) {
    assert.ok(!APP.includes(antiga), `a senha ${antiga} voltou ao cliente`);
  }
});

test('o login é conferido no SERVIDOR, não no navegador', () => {
  assert.ok(APP.includes('fetch("/api/login"'), 'o login parou de passar pelo servidor');
  // ⚠️ A comparação client-side era o bug: a lista de senhas inteira estava no
  // aparelho, dentro do JSON que qualquer um baixava.
  assert.ok(!/usuarios_\.find\(\(u:any\)=>u\.senha===p\)/.test(APP), 'a comparação de senha voltou para o cliente');
  assert.ok(SRV.includes('acharUsuario(senha, { usuarios, adminSenha: APP_ADMIN_SENHA'),
    'o servidor parou de conferir a senha');
});

test('as TRÊS rotas de dados exigem sessão', () => {
  // GET do documento, POST do documento e a marca de versão — a última também é
  // informação: diz que a empresa existe e quando mexeram nela.
  assert.equal((SRV.match(/if \(barrouDados\(req, res\)\) return;/g) || []).length, 3,
    'alguma rota de dados voltou a responder sem sessão');
  assert.ok(SRV.includes('function barrouDados(req, res)'), 'a porta única dos dados sumiu');
});

test('o agente do caixa continua entrando pelo segredo de serviço', () => {
  // ⚠️ Os agentes não têm navegador para guardar cookie: exigir sessão deles
  // cortaria a ponte do Eclética e a de impressão sem ninguém ligar as coisas.
  assert.ok(SRV.includes("serviceSecret: process.env.SEAMA_SERVICE_SECRET || ''"),
    'o segredo de serviço deixou de valer como alternativa à sessão');
});

test('o carimbo de revogação é lido com cache por mtime', () => {
  // ⚠️ O gate roda em TODA chamada de `/api/dados/*`, que o app consulta a cada
  // ~100ms em cada aparelho. `readFileSync` de 3 MB ali travaria o event loop —
  // é o defeito que a rota `/versao` já documenta.
  assert.ok(SRV.includes('function contaDeAcesso()'), 'o leitor de acesso sumiu');
  assert.ok(/_cacheAcesso[\s\S]{0,600}statSync/.test(SRV), 'o cache por mtime saiu do leitor de acesso');
});

test('sem segredo configurado o servidor GERA e AVISA, nunca libera', () => {
  // Falhar fechado bricaria a loja num deploy que esqueceu o `.env`; falhar
  // aberto deixaria a porta como estava.
  assert.ok(SRV.includes('APP_SESSION_SECRET_GERADO'), 'o aviso do segredo gerado saiu');
  assert.ok(SRV.includes("crypto.randomBytes(32).toString('hex')"), 'o segredo deixou de ser gerado');
  assert.ok(SRV.includes('NINGUÉM consegue entrar'), 'o aviso de sistema sem entrada possível saiu');
});

test('401 derruba a sessão no cliente em vez de virar erro de rede', () => {
  // ⚠️ Sem isso, o app seguiria mostrando o estado local, aceitando lançamento e
  // não gravando nada — a armadilha nº 0 (§3) pela porta da autenticação.
  assert.ok(APP.includes('if(r.status===401&&_aoPerderSessao)_aoPerderSessao();'),
    'o 401 voltou a ser tratado como erro de rede');
  assert.ok(APP.includes('registrarQuedaDeSessao'), 'o gancho de queda de sessão sumiu');
});

test('o servidor é a autoridade na subida, e o logout apaga o cookie', () => {
  assert.ok(APP.includes('fetch("/api/sessao"'), 'o app parou de perguntar quem ele é');
  assert.ok(APP.includes('fetch("/api/logout",{method:"POST"})'),
    'o logout voltou a apagar só o localStorage, deixando o cookie vivo');
});

test('o "desconectar todos" passou a ser conferido no servidor', () => {
  assert.ok(SRV.includes('sessoesValidasApos: contaDeAcesso().sessoesValidasApos'),
    'a revogação virou de novo um pedido gentil ao cliente');
});
