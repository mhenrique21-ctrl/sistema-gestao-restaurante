// Ponte de impressão 99Food → App Gestão — FASE 1: CAPTURA
// ============================================================================
// O 99Food não tem API aberta pra quem só quer ler o próprio pedido. O que ele
// tem é a comanda que já sai impressa na cozinha. Este agente se coloca ENTRE o
// aplicativo e a impressora: recebe o trabalho de impressão, GUARDA uma cópia e
// REPASSA os mesmos bytes pra impressora de verdade.
//
// POR QUE INTERMEDIÁRIO E NÃO SUBSTITUTO: a cozinha depende daquele papel. Um
// agente que só captura deixaria o pedido sem comanda, e o primeiro pedido
// perdido acabaria com a confiança na ponte inteira. Se a impressora estiver
// desligada ou fora da rede, a captura continua e o .bin fica guardado — dá pra
// reimprimir depois com "--imprimir".
//
// POR QUE ESTA FASE NÃO INTERPRETA NADA: no Eclética eu supus o formato do
// arquivo antes de ver um de verdade e errei o caminho duas vezes. Aqui o
// layout da comanda do 99Food é desconhecido, então o agente primeiro GRAVA
// (.bin cru + .txt legível) e o parser nasce depois, escrito em cima de uma
// comanda real. O .bin cru é guardado justamente porque o .txt pode ser
// regerado — se a impressora usar outra tabela de caracteres, é o .bin que
// permite refazer a leitura sem esperar um pedido novo.

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { textoDeEscPos, linhasUteis } from './escpos.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// ── Configuração ────────────────────────────────────────────────────────────
// Dois modos porque ainda não se sabe COMO o 99Food manda imprimir nesta loja,
// e descobrir isso custou três idas e vindas na ponte do Eclética:
//   rede  → o tablet imprime num IP (impressora de rede). O agente escuta na
//           porta 9100, que é a porta padrão de impressão crua (RAW/JetDirect).
//   pasta → o app imprime pelo Windows. Aí a captura vem de uma porta "FILE" ou
//           de um redirecionador que grava o trabalho num arquivo, e o agente
//           só vigia a pasta.
const MODO      = (process.env.CAPTURA_MODO || 'rede').toLowerCase();
const PORTA     = parseInt(process.env.CAPTURA_PORTA, 10) || 9100;
const DESTINO   = (process.env.IMPRESSORA_IP || '').trim();
const DESTINO_P = parseInt(process.env.IMPRESSORA_PORTA, 10) || 9100;
const PASTA_IN  = (process.env.CAPTURA_PASTA || '').trim();
const SAIDA     = (process.env.CAPTURA_SAIDA || path.join(AQUI, 'capturas')).trim();
// Um trabalho de impressão não tem marcador de fim: o cliente às vezes mantém a
// conexão aberta pro pedido seguinte. Sem este silêncio, dois pedidos viram um
// arquivo só; curto demais, um pedido vira dois. 1,5s é o meio termo.
const SILENCIO  = parseInt(process.env.CAPTURA_SILENCIO_MS, 10) || 1500;

const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a);

// ── Gravação ────────────────────────────────────────────────────────────────
function carimbo(d = new Date()) {
  const p = (n, c = 2) => String(n).padStart(c, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_`
       + `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

function gravar(bytes, etiqueta = 'trabalho') {
  if (!bytes || !bytes.length) return null;
  fs.mkdirSync(SAIDA, { recursive: true });
  const base = path.join(SAIDA, carimbo());
  const texto = textoDeEscPos(bytes);
  fs.writeFileSync(`${base}.bin`, bytes);
  fs.writeFileSync(`${base}.txt`, texto, 'utf8');
  log(`📥 ${etiqueta}: ${bytes.length} bytes → ${path.basename(base)}.bin/.txt`);
  const linhas = linhasUteis(texto);
  if (!linhas.length) {
    log('   ⚠️  nenhuma linha de texto — a impressora pode usar outra tabela de');
    log('      caracteres, ou o trabalho ser só imagem. O .bin guarda tudo.');
  } else {
    console.log('   ┌─────────────────────────────────────────────');
    for (const l of linhas) console.log('   │ ' + l);
    console.log('   └─────────────────────────────────────────────');
  }
  return base;
}

// ── Modo rede: fica no meio do fio ──────────────────────────────────────────
function enviarPraImpressora(bytes) {
  return new Promise((resolve) => {
    if (!DESTINO) return resolve(false);
    const s = net.connect({ host: DESTINO, port: DESTINO_P });
    let ok = false;
    s.setTimeout(15000);
    s.on('connect', () => { s.end(bytes); ok = true; });
    s.on('timeout', () => s.destroy());
    s.on('error', (e) => { log(`   ⚠️  impressora ${DESTINO}:${DESTINO_P} — ${e.code || e.message}`); });
    s.on('close', () => resolve(ok));
  });
}

function modoRede() {
  const servidor = net.createServer((sock) => {
    const origem = sock.remoteAddress || '?';
    let pedacos = [];
    let repasse = null;
    let timer = null;

    // O repasse é aberto junto com a conexão e os bytes seguem na hora, não no
    // fim: a impressora térmica imprime em fluxo, e segurar o trabalho até o
    // final atrasaria a comanda da cozinha sem motivo.
    if (DESTINO) {
      repasse = net.connect({ host: DESTINO, port: DESTINO_P });
      repasse.on('error', (e) => {
        log(`   ⚠️  repasse falhou (${e.code || e.message}) — a comanda NÃO saiu no papel.`);
        log('      A captura continua; reimprima depois com: node agent.js --imprimir <arquivo.bin>');
        repasse = null;
      });
    }

    const fechar = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pedacos.length) return;
      const bytes = Buffer.concat(pedacos);
      pedacos = [];
      gravar(bytes, `trabalho de ${origem}`);
    };

    sock.on('data', (d) => {
      pedacos.push(d);
      if (repasse && !repasse.destroyed) repasse.write(d);
      if (timer) clearTimeout(timer);
      timer = setTimeout(fechar, SILENCIO);
    });
    sock.on('error', (e) => log(`conexão de ${origem}: ${e.code || e.message}`));
    sock.on('close', () => { fechar(); if (repasse && !repasse.destroyed) repasse.end(); });
  });

  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n❌ A porta ${PORTA} já está em uso neste computador.`);
      console.error('   Costuma ser outro agente aberto, ou o próprio spooler do Windows.');
      console.error('   Feche a outra janela, ou mude CAPTURA_PORTA no config.bat.\n');
      process.exit(1);
    }
    throw e;
  });

  servidor.listen(PORTA, '0.0.0.0', () => {
    log(`escutando impressão na porta ${PORTA}`);
    for (const [nome, ifs] of Object.entries(os.networkInterfaces())) {
      for (const i of ifs || []) {
        if (i.family === 'IPv4' && !i.internal) log(`   endereço deste PC: ${i.address}  (${nome})`);
      }
    }
    log(DESTINO
      ? `   repassando para a impressora ${DESTINO}:${DESTINO_P}`
      : '   ⚠️  IMPRESSORA_IP vazio: NADA será repassado e a cozinha fica sem papel.');
    log('   no 99Food, aponte a impressora para o endereço deste PC na porta acima.');
  });
}

// ── Modo pasta: o Windows grava, o agente lê ────────────────────────────────
// Arquivo recém-criado costuma estar sendo escrito ainda. Ler cedo demais pega
// meia comanda, e meia comanda é pior que nenhuma: parece um pedido válido.
async function esperarEstabilizar(arq) {
  let anterior = -1;
  for (let i = 0; i < 40; i++) {
    let tam;
    try { tam = fs.statSync(arq).size; } catch { return false; }
    if (tam > 0 && tam === anterior) return true;
    anterior = tam;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function modoPasta() {
  if (!PASTA_IN) {
    console.error('\n❌ CAPTURA_MODO=pasta exige CAPTURA_PASTA no config.bat.\n');
    process.exit(1);
  }
  fs.mkdirSync(PASTA_IN, { recursive: true });
  fs.mkdirSync(SAIDA, { recursive: true });
  log(`vigiando a pasta ${PASTA_IN}`);

  const emAndamento = new Set();
  const processar = async (nome) => {
    const arq = path.join(PASTA_IN, nome);
    if (emAndamento.has(arq)) return;
    emAndamento.add(arq);
    try {
      if (!fs.existsSync(arq) || fs.statSync(arq).isDirectory()) return;
      if (!(await esperarEstabilizar(arq))) return;
      const bytes = fs.readFileSync(arq);
      gravar(bytes, `arquivo ${nome}`);
      // Sai da pasta de entrada pra não ser lido de novo na próxima varredura.
      try { fs.unlinkSync(arq); } catch (e) { log(`   ⚠️  não consegui remover ${nome}: ${e.message}`); }
    } finally {
      emAndamento.delete(arq);
    }
  };

  // fs.watch perde evento em pasta de rede e em alguns drivers de impressão.
  // A varredura periódica é o que garante que nenhum pedido fique parado.
  try {
    fs.watch(PASTA_IN, (_ev, nome) => { if (nome) processar(String(nome)); });
  } catch (e) {
    log(`   aviso: fs.watch indisponível (${e.message}); só a varredura vale.`);
  }
  const varrer = () => { for (const n of fs.readdirSync(PASTA_IN)) processar(n); };
  varrer();
  setInterval(varrer, 3000);
}

// ── Ferramentas de linha de comando ─────────────────────────────────────────
function comandaDeTeste() {
  const ESC = 0x1B, GS = 0x1D;
  const t = (s) => Buffer.from(s, 'latin1');
  return Buffer.concat([
    Buffer.from([ESC, 0x40]), Buffer.from([ESC, 0x61, 0x01]), Buffer.from([ESC, 0x21, 0x30]),
    t('99FOOD - TESTE\n'), Buffer.from([ESC, 0x21, 0x00]), Buffer.from([ESC, 0x61, 0x00]),
    t('--------------------------------\n'),
    t('Pedido #TESTE   '), t(new Date().toLocaleString('pt-BR')), t('\n'),
    t('1x Pao de Queijo         8,00\n'),
    t('2x Cafe Expresso        12,00\n'),
    t('--------------------------------\n'), t('TOTAL                   20,00\n'),
    Buffer.from([0x0A, 0x0A, 0x0A, 0x0A, GS, 0x56, 0x00]),
  ]);
}

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// Só age quando é ELE que foi chamado. Sem esta trava, importar o arquivo num
// teste subiria um servidor na 9100 e o teste passaria a depender da rede.
const chamadoDireto = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (!chamadoDireto) {
  // nada a fazer: quem importou quer só as funções
} else if (args.includes('--ler')) {
  // Relê uma captura guardada. É o que permite refazer a leitura de um pedido
  // antigo depois que o parser melhorar, sem esperar um pedido novo.
  const arq = arg('--ler');
  if (!arq) { console.error('uso: node agent.js --ler <arquivo.bin>'); process.exit(1); }
  const texto = textoDeEscPos(fs.readFileSync(arq));
  console.log(texto || '(nenhum texto legível — veja o .bin)');
} else if (args.includes('--imprimir')) {
  const arq = arg('--imprimir');
  if (!arq) { console.error('uso: node agent.js --imprimir <arquivo.bin>'); process.exit(1); }
  if (!DESTINO) { console.error('IMPRESSORA_IP vazio no config.bat.'); process.exit(1); }
  enviarPraImpressora(fs.readFileSync(arq))
    .then((ok) => console.log(ok ? '✅ enviado para a impressora' : '❌ não consegui enviar'));
} else if (args.includes('--teste')) {
  // Confere a ponte inteira sem depender de um pedido real chegar: manda uma
  // comanda de mentira pro próprio agente. Se sair papel E aparecer arquivo em
  // capturas/, a instalação está certa.
  const s = net.connect({ host: '127.0.0.1', port: PORTA });
  s.on('connect', () => s.end(comandaDeTeste()));
  s.on('error', (e) => console.error(`❌ o agente não está escutando na porta ${PORTA} (${e.code})`));
  s.on('close', () => console.log('comanda de teste enviada — veja a outra janela.'));
} else if (MODO === 'pasta') {
  modoPasta();
} else {
  modoRede();
}

export { gravar, comandaDeTeste };
