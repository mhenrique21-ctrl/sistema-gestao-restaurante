// Abre o app DE VERDADE num navegador e reprova se a tela ficar em branco.
// ============================================================================
//   node abreTela.js
//
// ⚠️ EXISTE PORQUE NEM O BUILD NEM O `npm test` PEGAM TELA BRANCA. Identificador
// que não existe naquele escopo é JavaScript válido: o bundler emite a
// referência e o erro só acontece quando o React renderiza aquele trecho.
//
// Aconteceu em 04/10/2026: a barra da lista aberta usava `MONO`, que é um
// `const` declarado DENTRO de outro componente. Build limpo, 944 testes
// passando, e o app abria em branco em produção — `ReferenceError: MONO is not
// defined`. Os testes de tela que leem o `App.tsx` também não pegam: eles
// conferem que o texto está lá, não que ele renderiza.
//
// É da mesma família do `ABA_REL_ANTIGA` e do `sub` sem bloco (§6): tela em
// branco, sem erro nenhum, sem o build acusar.
//
// ⚠️ PULA, NUNCA REPROVA, quando falta o playwright ou o Chromium — é a regra
// das amostras do §6: uma conferência que não pode rodar não pode virar um
// "falhou" que todo mundo aprende a ignorar. Para rodar:
//     npm i -D playwright     (o Chromium do ambiente é reaproveitado)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORTA = Number(process.env.ABRE_TELA_PORTA || 3199);
const SENHA = '999999';
const pulou = (motivo) => { console.log(`· pulado: ${motivo}`); process.exit(0); };

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { pulou('playwright não instalado (npm i -D playwright)'); }

const BROWSERS = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
const acharChrome = () => {
  if (!BROWSERS || !fs.existsSync(BROWSERS)) return undefined;   // deixa o playwright resolver
  for (const d of fs.readdirSync(BROWSERS)) {
    const p = path.join(BROWSERS, d, 'chrome-linux', 'chrome');
    if (d.startsWith('chromium-') && fs.existsSync(p)) return p;
  }
  return undefined;
};

if (!fs.existsSync('dist/index.html')) pulou('sem build — rode `npm run build` antes');

// ⚠️ NÃO RODA EM CIMA DE DADO REAL. `DADOS_DIR` do servidor é fixo em
// `./dados`, então isto sobe um SEGUNDO servidor lendo a mesma pasta — numa VPS
// seria o banco da loja, numa porta a mais, com uma senha de admin de teste.
// Isto é conferência de máquina de desenvolvimento, antes do deploy.
const ARQ_DADOS = ['confraria', 'seama'].map((e) => path.join('dados', `${e}.json`));
for (const f of ARQ_DADOS) {
  if (fs.existsSync(f) && fs.statSync(f).size > 10 * 1024) {
    pulou(`${f} tem dado de verdade — rode numa cópia do projeto, nunca na VPS`);
  }
}
fs.mkdirSync('dados', { recursive: true });
for (const f of ARQ_DADOS) {
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, JSON.stringify({ vendas: [], listaCompras: [], produtosLista: [], usuarios: [] }));
  }
}

const srv = spawn(process.execPath, ['new_server.js'], {
  env: { ...process.env, PORT: String(PORTA), APP_SESSION_SECRET: 'abretela', APP_ADMIN_SENHA: SENHA },
  stdio: 'ignore',
});
const encerrar = () => { try { srv.kill('SIGKILL'); } catch {} };
process.on('exit', encerrar);

const esperar = async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORTA}/`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
if (!await esperar()) { encerrar(); pulou('o servidor não subiu na porta de teste'); }

let navegador;
try { navegador = await chromium.launch({ executablePath: acharChrome() }); }
catch (e) { encerrar(); pulou(`Chromium indisponível (${e.message.split('\n')[0]})`); }

const page = await navegador.newPage();
const graves = [];
// Recurso externo que não carrega (fonte do Google) não é defeito do app.
page.on('pageerror', (e) => graves.push(`CRASH: ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/401|Unauthorized|ERR_FAILED|ERR_INTERNET|net::/.test(t)) graves.push(t);
});

const abas = ['Lista', 'Vendas', 'Compras', 'Estoque', 'Financeiro'];
let vistas = 0;
try {
  await page.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'networkidle' });
  const campo = await page.$('input');
  if (campo) { await campo.fill(SENHA); await campo.press('Enter'); await page.waitForTimeout(2500); }

  // ⚠️ VISITA AS ABAS, não só a inicial. O defeito que deu origem a isto estava
  // na Lista: abrir só o Dashboard teria passado.
  for (const aba of abas) {
    const el = await page.$(`text=/^${aba}$/`);
    if (!el) continue;
    await el.click();
    await page.waitForTimeout(1200);
    const corpo = (await page.textContent('body')) || '';
    if (!corpo.trim()) graves.push(`a aba ${aba} abriu EM BRANCO`);
    vistas++;
  }
} catch (e) {
  graves.push(`navegação falhou: ${e.message}`);
} finally {
  await navegador.close().catch(() => {});
  encerrar();
}

if (!vistas) pulou('não cheguei a abrir aba nenhuma (login mudou?)');
if (graves.length) {
  console.error(`✗ ${graves.length} erro(s) ao abrir o app (${vistas} aba(s) visitadas):`);
  graves.slice(0, 10).forEach((g) => console.error(`  ! ${g.split('\n')[0].slice(0, 200)}`));
  process.exit(1);
}
console.log(`✓ o app abre: ${vistas} aba(s) visitadas, nenhum erro de execução`);
