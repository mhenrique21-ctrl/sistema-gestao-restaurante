// Ponte de impressão 99Food → App Gestão — FASE 1: CAPTURA
// ============================================================================
// O 99Food não tem API aberta pra quem só quer ler o próprio pedido. O que ele
// tem é a comanda que já sai impressa na cozinha. Este agente se coloca ENTRE o
// aplicativo e a impressora: recebe o trabalho de impressão, GUARDA uma cópia e
// REPASSA os mesmos bytes pra impressora de verdade.
//
// POR QUE INTERMEDIÁRIO E NÃO SUBSTITUTO: a cozinha depende daquele papel. Um
// agente que só captura deixaria o pedido sem comanda, e o primeiro pedido
// perdido acabaria com a confiança na ponte inteira. Se o repasse falhar, a
// captura continua e o .bin fica guardado — dá pra reimprimir com "--imprimir".
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
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extrairEscPos, linhasUteis } from './escpos.js';
import { pngMono } from './png.js';
import { lerPedido99, conferirPedido99 } from './pedido99.js';
import { resolverOrigem, rotuloPlataforma, temLeitor } from './plataforma.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// ── Configuração ────────────────────────────────────────────────────────────
// Dois modos de CAPTURA, porque como o 99Food manda imprimir varia por loja:
//   rede  → o app imprime num IP. O agente escuta na porta 9100, que é a porta
//           padrão de impressão crua (RAW/JetDirect).
//   pasta → o app imprime por uma impressora do Windows apontada pra um
//           arquivo. O agente só vigia a pasta.
const MODO      = (process.env.CAPTURA_MODO || 'rede').toLowerCase();
const PORTA     = parseInt(process.env.CAPTURA_PORTA, 10) || 9100;
const PASTA_IN  = (process.env.CAPTURA_PASTA || '').trim();
const SAIDA     = (process.env.CAPTURA_SAIDA || path.join(AQUI, 'capturas')).trim();

// ── De onde cada aplicativo imprime ─────────────────────────────────────────
// 99Food e iFood imprimem do mesmo jeito e podem chegar no MESMO computador.
// Cada um ganha a própria fonte de captura — uma impressora do Windows por
// aplicativo, gravando na própria pasta — e é o rótulo da fonte que diz de
// quem é a comanda.
//
// ⚠️ Uma pasta só para os dois seria mais simples de instalar e é justamente o
// que não serve: a porta do Windows grava SEMPRE no mesmo nome, então dois
// pedidos quase juntos se sobrescrevem, e a cozinha perde uma comanda. Pastas
// separadas transformam essa corrida em duas filas independentes.
//
// ⚠️ O rótulo é só a suspeita inicial: quem manda é o TEXTO da comanda
// (`resolverOrigem`). Pasta trocada na instalação é erro silencioso, e seguir o
// rótulo jogaria o pedido no canal errado de Vendas, com outra taxa.
function fontesConfiguradas() {
  const fs_ = [];
  const pasta = (v) => (v || '').trim();
  const porta = (v) => parseInt(v, 10) || 0;
  const add = (f) => { if (f) fs_.push(f); };

  for (const [plat, env] of [['99food', '99'], ['ifood', 'IFOOD']]) {
    const dir = pasta(process.env[`CAPTURA_PASTA_${env}`]);
    if (dir) add({ tipo: 'pasta', plataforma: plat, pasta: dir });
    const pt = porta(process.env[`CAPTURA_PORTA_${env}`]);
    if (pt) add({ tipo: 'rede', plataforma: plat, porta: pt });
  }

  // Configuração antiga (uma fonte só, sem rótulo) continua valendo: quem já
  // instalou o agente não pode ser obrigado a reconfigurar pra continuar
  // capturando o 99Food. Sem rótulo, a origem sai do texto da comanda.
  if (!fs_.length) {
    if (MODO === 'pasta') add(PASTA_IN ? { tipo: 'pasta', plataforma: '', pasta: PASTA_IN } : null);
    else add({ tipo: 'rede', plataforma: '', porta: PORTA });
  }
  return fs_;
}
const FONTES = fontesConfiguradas();

// E dois destinos de REPASSE, porque a impressora desta loja é USB:
//   IMPRESSORA_WINDOWS → nome do COMPARTILHAMENTO da impressora no Windows.
//                        É o único jeito de mandar bytes crus pra uma térmica
//                        USB: a porta USB não se abre como arquivo (ao
//                        contrário da LPT antiga), mas o spooler aceita uma
//                        cópia binária pro caminho de rede local e repassa sem
//                        reinterpretar nada.
//   IMPRESSORA_IP      → impressora de rede, repasse direto por socket.
const IMPRESSORA_WIN = (process.env.IMPRESSORA_WINDOWS || '').trim();
const DESTINO        = (process.env.IMPRESSORA_IP || '').trim();
const DESTINO_P      = parseInt(process.env.IMPRESSORA_PORTA, 10) || 9100;

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

function gravar(bytes, etiqueta = 'trabalho', rotulo = '') {
  if (!bytes || !bytes.length) return null;
  fs.mkdirSync(SAIDA, { recursive: true });
  const { texto, imagem, faixas } = extrairEscPos(bytes);
  // A origem entra no NOME do arquivo, não só no log: quando alguém for
  // procurar a comanda de um pedido semanas depois, é pela pasta que procura.
  const { origem, avisos } = resolverOrigem(rotulo, texto);
  const base = path.join(SAIDA, carimbo() + (origem ? `_${origem}` : ''));
  fs.writeFileSync(`${base}.bin`, bytes);
  fs.writeFileSync(`${base}.txt`, texto, 'utf8');
  log(`📥 ${etiqueta}: ${bytes.length} bytes → ${path.basename(base)}.bin/.txt`
    + (origem ? `  [${rotuloPlataforma(origem)}]` : ''));
  for (const a of avisos) log(`   ⚠️  ${a}`);

  // A comanda pode vir DESENHADA em vez de escrita. Montar o PNG é o que
  // permite ver o que chegou no papel quando o .txt sai vazio — sem ele, um
  // trabalho todo gráfico não deixaria rastro nenhum de conteúdo.
  if (imagem) {
    try {
      fs.writeFileSync(`${base}.png`, pngMono(imagem));
      log(`   🖼️  ${faixas} faixa(s) de imagem → ${path.basename(base)}.png`
        + ` (${imagem.bytesLinha * 8}×${imagem.altura})`);
    } catch (e) {
      log(`   ⚠️  não consegui montar o PNG: ${e.message}`);
    }
  }

  const linhas = linhasUteis(texto);
  if (!linhas.length) {
    if (imagem) {
      log('   ℹ️  a comanda veio como IMAGEM, não como texto. Abra o .png.');
    } else {
      log('   ⚠️  nenhuma linha de texto e nenhuma imagem — a impressora pode');
      log('      usar outra tabela de caracteres. O .bin guarda tudo.');
    }
  } else {
    console.log('   ┌─────────────────────────────────────────────');
    for (const l of linhas) console.log('   │ ' + l);
    console.log('   └─────────────────────────────────────────────');
    interpretar(texto, base, origem);
  }
  return base;
}

// Lê o pedido e GRAVA o .json ao lado da captura, mas ainda não manda pro
// Gestão: para onde o valor entra em Vendas depende de decisão do dono (o que a
// plataforma repassa e o que o entregador cobra na porta são dinheiros
// diferentes). Mostrar aqui é o que permite conferir contra o papel antes.
function interpretar(texto, base, origem) {
  // ⚠️ O leitor é POR PLATAFORMA. Rodar o do 99Food numa comanda do iFood não
  // daria erro: daria um pedido pela metade, com número e itens plausíveis e
  // os dois dinheiros vazios. Errado em silêncio é pior que não lido — e o
  // .bin guardado deixa escrever o leitor do iFood em cima de uma comanda de
  // VERDADE, sem esperar pedido novo.
  if (!temLeitor(origem)) {
    if (origem) {
      log(`   ℹ️  comanda do ${rotuloPlataforma(origem)} capturada, mas o leitor dela`);
      log('      ainda não existe. O papel saiu normal; me mande este .bin.');
    }
    return;
  }
  let pedido;
  try { pedido = lerPedido99(texto); }
  catch (e) { log(`   ⚠️  não consegui ler o pedido: ${e.message}`); return; }

  const avisos = conferirPedido99(pedido);
  const itens = pedido.itens.map((i) => `${i.qtd}x ${i.nome}`).join(', ');
  log(`   🧾 pedido #${pedido.numero || '?'} · ${pedido.cliente || 'sem nome'}`
    + ` · ${pedido.itens.length} item(ns)${itens ? ': ' + itens : ''}`);
  log(`      total R$ ${(pedido.total ?? 0).toFixed(2)}`
    + ` · plataforma repassa R$ ${(pedido.pagoPeloApp ?? 0).toFixed(2)}`
    + ` · cobrar do cliente R$ ${(pedido.cobrarDoCliente ?? 0).toFixed(2)}`
    + (pedido.formaPagamento ? ` · ${pedido.formaPagamento}` : ''));
  for (const a of avisos) log(`   ⚠️  ${a}`);
  for (const l of pedido.naoEntendido) log(`      não entendi: ${l}`);

  try { fs.writeFileSync(`${base}.json`, JSON.stringify({ origem, ...pedido }, null, 2), 'utf8'); }
  catch (e) { log(`   ⚠️  não consegui gravar o .json: ${e.message}`); }
}

// ── Repasse: a comanda tem que sair no papel ────────────────────────────────
// Impressora USB não tem endereço, mas compartilhada ela tem CAMINHO. Aceita o
// nome curto do compartilhamento ("TERMICA"), o caminho inteiro, ou uma porta
// paralela — normalizar aqui evita a pergunta "tenho que digitar as barras?".
export function destinoWindows(nome) {
  const n = String(nome || '').trim();
  if (!n) return '';
  if (/^(LPT|COM)\d+:?$/i.test(n)) return n.replace(/:?$/, ':');
  if (n.startsWith('\\\\')) return n;
  return `\\\\localhost\\${n}`;
}

// ⚠️ NOME COM ESPAÇO É O NORMAL, não a exceção: as impressoras desta loja se
// chamam "EPSON COZINHA", "EPSON BALCAO", "ELGIN i8". Sem as aspas, o `copy`
// lê "EPSON" como destino e "COZINHA" como um segundo arquivo de origem — erro
// que só aparece na hora do pedido, com a cozinha esperando papel.
//
// O comando vai INTEIRO num argumento só, e começando por `copy`: com `cmd /c`,
// uma linha que COMEÇA com aspas cai na regra de remoção de aspas do cmd e se
// desmonta. Começando por `copy`, a regra não se aplica e as aspas chegam ao
// destino como escritas.
export function comandoCopia(caminhoBin, dest) {
  return `copy /b "${caminhoBin}" "${dest}"`;
}

function repassarWindows(caminhoBin) {
  return new Promise((resolve) => {
    const dest = destinoWindows(IMPRESSORA_WIN);
    // "copy /b" é do cmd, não é programa — daí o cmd /c. E o /b é o que impede
    // o Windows de tratar 0x1A como fim de arquivo: esse byte aparece no meio
    // de ESC/POS e cortaria a comanda no meio sem erro nenhum.
    execFile('cmd', ['/c', comandoCopia(caminhoBin, dest)], { windowsVerbatimArguments: true }, (err, _o, stderr) => {
      if (err) {
        log(`   ⚠️  repasse para ${dest} falhou — a comanda NÃO saiu no papel.`);
        log(`      ${String(stderr || err.message).trim()}`);
        log('      Confira o nome do compartilhamento: node agent.js --impressoras');
        return resolve(false);
      }
      log(`   🖨️  repassado para ${dest}`);
      resolve(true);
    });
  });
}

function repassarRede(bytes) {
  return new Promise((resolve) => {
    const s = net.connect({ host: DESTINO, port: DESTINO_P });
    let ok = false;
    s.setTimeout(15000);
    s.on('connect', () => { s.end(bytes); ok = true; });
    s.on('timeout', () => s.destroy());
    s.on('error', (e) => log(`   ⚠️  impressora ${DESTINO}:${DESTINO_P} — ${e.code || e.message}`));
    s.on('close', () => resolve(ok));
  });
}

// Grava primeiro, repassa depois — e nesta ordem de propósito: se o repasse
// travar ou a impressora estiver sem papel, o pedido já está guardado em disco.
async function capturar(bytes, etiqueta, rotulo = '') {
  const base = gravar(bytes, etiqueta, rotulo);
  if (!base) return null;
  if (IMPRESSORA_WIN) await repassarWindows(`${base}.bin`);
  else if (DESTINO) await repassarRede(bytes);
  else log('   ⚠️  nenhum repasse configurado: a comanda NÃO sai no papel.');
  return base;
}

// ── Modo rede: fica no meio do fio ──────────────────────────────────────────
function modoRede(fonte) {
  const PORTA = fonte.porta;
  const servidor = net.createServer((sock) => {
    const origem = sock.remoteAddress || '?';
    let pedacos = [];
    let repasse = null;
    let timer = null;

    // Com impressora de REDE o repasse sai em fluxo, byte a byte, porque a
    // térmica imprime enquanto recebe e segurar o trabalho atrasaria a cozinha.
    // Com impressora USB isso não existe: o spooler só aceita o trabalho
    // inteiro, então ali o repasse espera o fim (uns 1,5s a mais no papel).
    if (DESTINO && !IMPRESSORA_WIN) {
      repasse = net.connect({ host: DESTINO, port: DESTINO_P });
      repasse.on('error', (e) => {
        log(`   ⚠️  repasse falhou (${e.code || e.message}) — a comanda NÃO saiu no papel.`);
        log('      A captura continua; reimprima com: node agent.js --imprimir <arquivo.bin>');
        repasse = null;
      });
    }

    const fechar = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pedacos.length) return;
      const bytes = Buffer.concat(pedacos);
      pedacos = [];
      if (repasse) gravar(bytes, `trabalho de ${origem}`, fonte.plataforma);   // já foi em fluxo
      else capturar(bytes, `trabalho de ${origem}`, fonte.plataforma);
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
    log(`escutando impressão na porta ${PORTA}`
      + (fonte.plataforma ? `  [${rotuloPlataforma(fonte.plataforma)}]` : ''));
    for (const [nome, ifs] of Object.entries(os.networkInterfaces())) {
      for (const i of ifs || []) {
        if (i.family === 'IPv4' && !i.internal) log(`   endereço deste PC: ${i.address}  (${nome})`);
      }
    }
    // O destino do repasse é um só e já foi anunciado na subida — repetir a
    // cada fonte encheria a tela de linha igual e esconderia o que importa.
    log(`   no ${rotuloPlataforma(fonte.plataforma) === 'origem desconhecida' ? 'aplicativo' : rotuloPlataforma(fonte.plataforma)}`
      + ', aponte a impressora para o endereço deste PC na porta acima.');
  });
}

function avisarDestino() {
  if (IMPRESSORA_WIN) log(`   repassando para a impressora do Windows ${destinoWindows(IMPRESSORA_WIN)}`);
  else if (DESTINO) log(`   repassando para a impressora ${DESTINO}:${DESTINO_P}`);
  else log('   ⚠️  nenhum repasse configurado: a cozinha ficará SEM PAPEL.');
}

// ── Modo pasta: o Windows grava, o agente lê e devolve pro papel ────────────
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

function modoPasta(fonte) {
  const PASTA_IN = fonte.pasta;
  fs.mkdirSync(PASTA_IN, { recursive: true });
  fs.mkdirSync(SAIDA, { recursive: true });
  log(`vigiando a pasta ${PASTA_IN}`
    + (fonte.plataforma ? `  [${rotuloPlataforma(fonte.plataforma)}]` : ''));

  const emAndamento = new Set();
  // A porta do Windows grava SEMPRE no mesmo nome, então o arquivo processado
  // precisa sair da frente. Quando o spooler ainda o segura e o apagar falha, a
  // assinatura (tamanho+mtime) impede que a varredura seguinte o capture de
  // novo — sem isso o mesmo pedido viraria duas comandas.
  const jaVistos = new Set();
  const assinatura = (st) => `${st.size}:${st.mtimeMs}`;

  const processar = async (nome) => {
    const arq = path.join(PASTA_IN, nome);
    if (emAndamento.has(arq)) return;
    emAndamento.add(arq);
    try {
      if (!fs.existsSync(arq) || fs.statSync(arq).isDirectory()) return;
      if (!(await esperarEstabilizar(arq))) return;
      const marca = `${nome}|${assinatura(fs.statSync(arq))}`;
      if (jaVistos.has(marca)) return;

      // O spooler mantém o arquivo aberto até terminar de escrever; ler nessa
      // hora dá erro de acesso no Windows. Tentar de novo é mais barato que
      // perder o pedido — e se falhar sempre, a varredura pega no ciclo seguinte.
      let bytes = null;
      for (let i = 0; i < 5 && !bytes; i++) {
        try { bytes = fs.readFileSync(arq); }
        catch { await new Promise((r) => setTimeout(r, 400)); }
      }
      if (!bytes) { log(`   ⚠️  ${nome} ainda em uso; tento de novo no próximo ciclo.`); return; }

      jaVistos.add(marca);
      if (jaVistos.size > 200) jaVistos.delete(jaVistos.values().next().value);
      await capturar(bytes, `arquivo ${nome}`, fonte.plataforma);
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
function comandaDeTeste(plataforma = '99food') {
  const CABECALHO = plataforma === 'ifood' ? 'IFOOD - TESTE' : '99FOOD - TESTE';
  const ESC = 0x1B, GS = 0x1D;
  const t = (s) => Buffer.from(s, 'latin1');
  return Buffer.concat([
    Buffer.from([ESC, 0x40]), Buffer.from([ESC, 0x61, 0x01]), Buffer.from([ESC, 0x21, 0x30]),
    t(CABECALHO + '\n'), Buffer.from([ESC, 0x21, 0x00]), Buffer.from([ESC, 0x61, 0x00]),
    t('--------------------------------\n'),
    t('Pedido #TESTE   '), t(new Date().toLocaleString('pt-BR')), t('\n'),
    t('1x Pao de Queijo         8,00\n'),
    t('2x Cafe Expresso        12,00\n'),
    t('--------------------------------\n'), t('TOTAL                   20,00\n'),
    Buffer.from([0x0A, 0x0A, 0x0A, 0x0A, GS, 0x56, 0x00]),
  ]);
}

// Descobrir o nome da impressora PERGUNTANDO AO WINDOWS, não adivinhando. Na
// ponte do Eclética eu li o caminho de uma captura de tela e errei uma letra;
// custou três idas e vindas. Aqui a máquina escreve o nome.
function listarImpressoras() {
  const ps = 'Get-Printer | Select-Object Name,ShareName,Shared,PortName | Format-Table -AutoSize';
  execFile('powershell', ['-NoProfile', '-Command', ps], (err, out) => {
    if (!err && String(out).trim()) {
      console.log(out);
    } else {
      execFile('wmic', ['printer', 'get', 'Name,ShareName,Shared,PortName'], (e2, o2) => {
        console.log(e2 ? `não consegui listar as impressoras: ${e2.message}` : o2);
      });
    }
    console.log('No config.bat, IMPRESSORA_WINDOWS recebe o ShareName (a coluna do meio).');
    console.log('Se Shared estiver False, compartilhe a impressora primeiro — é o que');
    console.log('dá a ela um caminho para o agente devolver a comanda ao papel.');
  });
}

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// Só age quando é ELE que foi chamado. Sem esta trava, importar o arquivo num
// teste subiria um servidor na 9100 e o teste passaria a depender da rede.
const chamadoDireto = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (!chamadoDireto) {
  // nada a fazer: quem importou quer só as funções
} else if (args.includes('--impressoras')) {
  listarImpressoras();
} else if (args.includes('--ler')) {
  // Relê uma captura guardada. É o que permite refazer a leitura de um pedido
  // antigo depois que o parser melhorar, sem esperar um pedido novo.
  const arq = arg('--ler');
  if (!arq) { console.error('uso: node agent.js --ler <arquivo.bin>'); process.exit(1); }
  const { texto, imagem, faixas } = extrairEscPos(fs.readFileSync(arq));
  if (texto) console.log(texto);
  if (imagem) {
    const png = arq.replace(/\.[^.]+$/, '') + '.png';
    fs.writeFileSync(png, pngMono(imagem));
    console.log(`\n[${faixas} faixa(s) de imagem → ${png}, ${imagem.bytesLinha * 8}×${imagem.altura}]`);
  }
  if (!texto && !imagem) console.log('(nenhum texto legível e nenhuma imagem — veja o .bin)');
} else if (args.includes('--papel')) {
  // Conferir o REPASSE sozinho, antes de existir captura nenhuma.
  //
  // ⚠️ Isto existe porque o README mandava `reimprimir.bat capturas\exemplo.bin`
  // e esse arquivo NUNCA existiu: `capturas/` está no .gitignore, então numa
  // instalação nova a pasta nem é criada. O primeiro passo da instalação — o
  // único que dá pra testar isolado — falhava com "arquivo não encontrado", e
  // quem estava instalando não tinha como saber se o problema era o
  // compartilhamento da impressora ou o comando.
  const bytes = comandaDeTeste();
  const tmp = path.join(os.tmpdir(), `papel-${Date.now()}.bin`);
  fs.writeFileSync(tmp, bytes);
  const fim = (ok) => {
    try { fs.unlinkSync(tmp); } catch {}
    console.log(ok
      ? '✅ enviado. Saiu papel na impressora? Então o repasse está certo.'
      : '❌ não consegui enviar — confira IMPRESSORA_WINDOWS no config.bat (node agent.js --impressoras).');
  };
  if (IMPRESSORA_WIN) repassarWindows(tmp).then(fim);
  else if (DESTINO) repassarRede(bytes).then(fim);
  else {
    try { fs.unlinkSync(tmp); } catch {}
    console.error('Configure IMPRESSORA_WINDOWS ou IMPRESSORA_IP no config.bat.');
    process.exit(1);
  }
} else if (args.includes('--imprimir')) {
  const arq = arg('--imprimir');
  if (!arq) { console.error('uso: node agent.js --imprimir <arquivo.bin>'); process.exit(1); }
  if (IMPRESSORA_WIN) repassarWindows(path.resolve(arq));
  else if (DESTINO) repassarRede(fs.readFileSync(arq))
    .then((ok) => console.log(ok ? '✅ enviado para a impressora' : '❌ não consegui enviar'));
  else console.error('Configure IMPRESSORA_WINDOWS ou IMPRESSORA_IP no config.bat.');
} else if (args.includes('--teste')) {
  // Confere a ponte inteira sem depender de um pedido real chegar: manda uma
  // comanda de mentira pelo MESMO caminho que o aplicativo usaria. Com duas
  // fontes configuradas, `--teste ifood` escolhe qual delas testar — testar só
  // a primeira deixaria a segunda instalação sem conferência nenhuma.
  const qual = (arg('--teste') || '').toLowerCase();
  const alvos = qual ? FONTES.filter((f) => f.plataforma === qual) : FONTES;
  if (!alvos.length) {
    console.error(`❌ nenhuma captura configurada${qual ? ` para "${qual}"` : ''} no config.bat.`);
    process.exit(1);
  }
  for (const fonte of alvos) {
    const marca = fonte.plataforma ? `[${rotuloPlataforma(fonte.plataforma)}] ` : '';
    if (fonte.tipo === 'pasta') {
      const arq = path.join(fonte.pasta, `teste-${Date.now()}.prn`);
      fs.mkdirSync(fonte.pasta, { recursive: true });
      fs.writeFileSync(arq, comandaDeTeste(fonte.plataforma));
      console.log(`${marca}comanda de teste gravada em ${arq} — veja a outra janela.`);
    } else {
      const s = net.connect({ host: '127.0.0.1', port: fonte.porta });
      s.on('connect', () => s.end(comandaDeTeste(fonte.plataforma)));
      s.on('error', (e) => console.error(`❌ ${marca}o agente não está escutando na porta ${fonte.porta} (${e.code})`));
      s.on('close', () => console.log(`${marca}comanda de teste enviada — veja a outra janela.`));
    }
  }
} else {
  // Todas as fontes sobem juntas: 99Food e iFood chegam pelo mesmo computador
  // e não há razão pra pedir duas janelas abertas — uma fecharia sem ninguém
  // perceber, e só se descobriria no pedido perdido.
  if (!FONTES.length) {
    console.error('\n❌ Nenhuma captura configurada. Veja CAPTURA_PASTA_99 / CAPTURA_PASTA_IFOOD no config.bat.\n');
    process.exit(1);
  }
  avisarDestino();
  for (const fonte of FONTES) (fonte.tipo === 'pasta' ? modoPasta : modoRede)(fonte);
}

export { gravar, comandaDeTeste, fontesConfiguradas };
