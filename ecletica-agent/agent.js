// Ponte Eclética Food → App Gestão
// ============================================================================
// Roda no computador do caixa (Windows), lê os XML de NFC-e que o Eclética já
// grava em disco e manda o faturamento do dia pro Gestão. Sem API, sem tocar no
// banco do Eclética — só leitura de arquivo.
//
// POR QUE LER XML E NÃO O CUPOM IMPRESSO: o XML é o documento fiscal oficial,
// com estrutura estável definida pela SEFAZ. Parsear texto de cupom quebra
// quando o layout muda, e muda sem avisar.
//
// POR QUE NÃO PRECISA CONTROLAR "ARQUIVO JÁ PROCESSADO": /api/venda-pdv
// SUBSTITUI o registro do dia (chaveado por data + origem), não soma. O agente
// relê todos os XML do dia e manda o total; reprocessar manda o mesmo número.
// Contagem dupla é impossível por construção — bem mais robusto que manter uma
// lista de arquivos vistos, que se perde quando o PC reinicia.

import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

// ── Configuração ────────────────────────────────────────────────────────────
// A instalação real tem DUAS árvores de XML lado a lado — "XmlVenda" e
// "XmlVenda2" — e as duas têm ano/mês. Qual recebe a nota do dia não é
// previsível de fora, então o agente lê as duas e deduplica por chave da NFC-e.
// Apontar pra uma só faz a venda sumir em silêncio quando o Eclética escreve na
// outra. Aceita vários caminhos separados por ";".
const RAIZES_XML = (process.env.ECLETICA_XML
  || 'C:\\Wineclt\\ArquivosSistema\\XmlVenda;C:\\Wineclt\\ArquivosSistema\\XmlVenda2')
  .split(';').map((t) => t.trim()).filter(Boolean);
const GESTAO_URL = (process.env.GESTAO_URL || 'https://gestao.confrariacafe.com').replace(/\/$/, '');
const SECRET     = process.env.SEAMA_SERVICE_SECRET || '';
const INTERVALO  = (parseInt(process.env.INTERVALO_MIN, 10) || 2) * 60 * 1000;

// Etiqueta da fonte. O Gestão guarda UM registro por dia POR ORIGEM e SUBSTITUI
// o registro inteiro a cada envio. O delivery-backend da Confraria já manda o
// dia dele como origem "pdv" (delivery-backend/src/services/gestaoSync.js); se
// o Eclética mandasse com a mesma etiqueta, os dois sobrescreveriam um ao outro
// a cada ciclo e o faturamento do dia ficaria piscando entre um valor e outro,
// sem erro nenhum aparecendo em lugar algum. Com fonte própria, cada um tem sua
// linha e o dia soma as duas.
const FONTE = process.env.ECLETICA_FONTE || 'ecletica';

// De qual empresa do Gestão é cada CNPJ emitente. Um PC pode emitir por mais de
// um CNPJ; sem esse mapa, venda de uma empresa entraria na outra.
const CNPJ_EMPRESA = {
  '58564214000170': 'CONFRARIA',
  ...(process.env.CNPJ_SEAMA ? { [process.env.CNPJ_SEAMA]: 'SEAMA' } : {}),
};

// tPag da NFC-e → forma de pagamento, e forma → balde do Gestão.
//
// Duas camadas de propósito. A FORMA é o detalhe que o dono quer ver (dinheiro,
// crédito, débito, PIX, pendura); o BALDE é o que a Gestão usa nos cálculos que
// já existem (dinheiro na gaveta × valor eletrônico a conferir com o extrato).
// Misturar as duas coisas numa tabela só foi o que fez o mapa antigo jogar
// "crédito da loja" na maquininha.
const FORMA_POR_TPAG = {
  '01': 'dinheiro',
  '02': 'dinheiro',                                   // cheque: entra em caixa
  '03': 'credito',
  '04': 'debito',
  '05': 'pendura',                                    // "crédito da loja" — é a conta do cliente
  '10': 'outros', '11': 'outros',                     // vale alimentação/refeição
  '12': 'outros', '13': 'outros',                     // vale presente/combustível
  '15': 'outros',                                     // boleto
  '16': 'pix', '17': 'pix', '18': 'pix', '20': 'pix', // depósito, PIX, transferência
  '19': 'outros',                                     // fidelidade
  '90': 'pendura',                                    // sem pagamento
  '99': 'outros',
};

// Ajuste sem mexer no código, para quando o Eclética usar um código fora do
// óbvio: ECLETICA_TPAG="05=credito,99=pendura".
(process.env.ECLETICA_TPAG || '').split(',').map((p) => p.trim()).filter(Boolean).forEach((par) => {
  const [cod, forma] = par.split('=').map((t) => t.trim());
  if (cod && forma) FORMA_POR_TPAG[cod] = forma;
});

// Pendura (fiado) fica FORA dos dois baldes: é venda faturada com recebimento
// adiado, não é dinheiro na gaveta nem valor a conferir no extrato do cartão.
// Entra no total do dia, que é o número que o caixa vê ao fechar. Essa é a
// mesma regra que o delivery-backend já aplica (FORA_DOS_BALDES lá) — as duas
// fontes precisam contar igual, senão a DRE soma maçã com laranja.
const BALDE_POR_FORMA = {
  dinheiro: 'dinheiro',
  credito: 'maquininha',
  debito: 'maquininha',
  pix: 'maquininha',                                  // eletrônico: cai na conta, não na gaveta
  outros: 'maquininha',
  pendura: null,                                      // no total, fora dos baldes
};
const FORMAS = ['dinheiro', 'credito', 'debito', 'pix', 'pendura', 'outros'];

const TP_EVENTO_CANCELAMENTO = '110111';
const CSTAT_EVENTO_OK = ['135', '155'];

// Pastas cujo conteúdo NUNCA é venda válida. Alguns emissores, em vez de gravar
// o evento de cancelamento, simplesmente MOVEM a nota pra uma pasta. Sem isso,
// uma nota cancelada dessa forma continuaria sendo lida como venda boa.
const PASTAS_IGNORADAS = /^(cancelad|inutiliz|denegad|rejeitad|contingenc|backup|lixeira)/i;

const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a);

// ── Leitura de um XML ───────────────────────────────────────────────────────
// Devolve { tipo: 'venda', ... } | { tipo: 'cancelamento', chave } | null.
function lerArquivo(caminho) {
  const doc = new DOMParser({ errorHandler: {} }).parseFromString(fs.readFileSync(caminho, 'utf8'), 'text/xml');
  const tag = (pai, nome) => {
    const e = (pai || doc).getElementsByTagName(nome)[0];
    return e && e.textContent ? e.textContent.trim() : '';
  };

  // Cancelamento vem ANTES da checagem de modelo: arquivo de evento não tem
  // <mod>, e cair no filtro de modelo faria o cancelamento ser ignorado — a
  // venda cancelada seguiria contando no faturamento.
  const tpEvento = tag(null, 'tpEvento');
  if (tpEvento) {
    if (tpEvento !== TP_EVENTO_CANCELAMENTO) return null;   // ex.: carta de correção
    const ret = doc.getElementsByTagName('retEvento')[0];
    const cStat = ret ? tag(ret, 'cStat') : '';
    // Sem cStat o arquivo é o pedido de cancelamento, não o protocolo. Ainda
    // assim vale como cancelamento: contar como venda um pedido que o caixa
    // emitiu de propósito infla o faturamento, e inflar é o erro caro aqui.
    if (cStat && !CSTAT_EVENTO_OK.includes(cStat)) return null;
    const chave = tag(null, 'chNFe');
    return chave ? { tipo: 'cancelamento', chave } : null;
  }

  // Só NFC-e (modelo 65) autorizada (cStat 100). Nota rejeitada ou em
  // contingência fica no disco igual, e entraria como venda se não filtrasse.
  if (tag(null, 'mod') !== '65') return null;
  if (tag(null, 'cStat') !== '100') return null;

  const cnpj = tag(doc.getElementsByTagName('emit')[0], 'CNPJ');
  const empresa = CNPJ_EMPRESA[cnpj];
  if (!empresa) return null;                       // CNPJ desconhecido: ignora

  // dhEmi vem com fuso ("2026-09-11T19:34:01-03:00"). Os 10 primeiros
  // caracteres já são a data local da emissão — usar new Date() aqui jogaria a
  // venda pro dia anterior/seguinte dependendo do fuso do PC.
  const data = tag(null, 'dhEmi').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;

  // O total TEM que ser buscado dentro de <total><ICMSTot>: existe um <vProd>
  // em cada item também, e pegar "o primeiro do documento" traz o valor do
  // primeiro produto em vez do total da venda.
  const icmsTot = doc.getElementsByTagName('ICMSTot')[0];
  const vNF = parseFloat(tag(icmsTot, 'vNF')) || 0;

  // Gorjeta: o Eclética declara em texto no infCpl ("GORJETA CONCEDIDA R$8,40")
  // e a espelha em <vTroco>. Não dá pra usar vTroco: numa venda em DINHEIRO ele
  // é o troco de verdade, e somá-lo contaria como faturamento o dinheiro que
  // voltou pro cliente. O texto é inequívoco.
  const infCpl = tag(null, 'infCpl');
  const mg = infCpl.match(/GORJETA[^R]*R\$\s*([\d.,]+)/i);
  const gorjeta = mg ? (parseFloat(mg[1].replace(/\./g, '').replace(',', '.')) || 0) : 0;

  // Divide entre os canais pelas formas de pagamento. Venda paga metade no
  // cartão e metade em dinheiro tem dois <detPag>; ratear pelo peso de cada um
  // mantém a soma exata mesmo quando a gorjeta entra no meio.
  const detPags = Array.from(doc.getElementsByTagName('detPag'));
  const pagos = detPags.map((d) => {
    const tPag = tag(d, 'tPag');
    return { tPag, forma: FORMA_POR_TPAG[tPag] || 'outros', valor: parseFloat(tag(d, 'vPag')) || 0 };
  }).filter((p) => p.valor > 0);

  const totalVenda = vNF + gorjeta;
  const somaPagos = pagos.reduce((s, p) => s + p.valor, 0);
  const formas = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  const canais = { dinheiro: 0, maquininha: 0 };
  if (!pagos.length || somaPagos <= 0) {
    formas.dinheiro = totalVenda;                  // sem forma declarada
    canais.dinheiro = totalVenda;
  } else {
    pagos.forEach((p) => {
      const parte = totalVenda * (p.valor / somaPagos);
      formas[p.forma] += parte;
      const balde = BALDE_POR_FORMA[p.forma];
      if (balde) canais[balde] += parte;           // pendura não entra em balde
    });
  }

  return { tipo: 'venda', empresa, data, total: totalVenda, canais, formas, chave: tag(null, 'chNFe'), tPags: pagos.map((p) => p.tPag) };
}

// Compatibilidade com quem só quer a venda (e com os testes).
function lerVenda(caminho) {
  const r = lerArquivo(caminho);
  return r && r.tipo === 'venda' ? r : null;
}

// ── Varredura do mês ────────────────────────────────────────────────────────
function pastaDoMes(raiz, d) {
  return path.join(raiz, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
}

// Percorre o mês INTEIRO, não só "Emitidos". O layout de pastas do Eclética
// muda com a versão e com a configuração da loja, e o evento de cancelamento
// não fica junto da nota. Varrer a árvore toda é a única forma de garantir que
// o cancelamento seja visto — e é barato: um mês cheio tem ~1.500 arquivos.
function* xmlsDaArvore(dir) {
  let entradas;
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (PASTAS_IGNORADAS.test(e.name)) continue;
      yield* xmlsDaArvore(p);
    } else if (/\.xml$/i.test(e.name)) {
      yield p;
    }
  }
}

// Por que cada arquivo foi descartado. Sem isso, "nenhuma venda hoje" é
// indistinguível de "a pasta do mês nem existe" e de "li 300 notas e recusei
// todas por CNPJ" — três problemas com soluções completamente diferentes, e o
// mesmo silêncio na tela. Perder uma tarde nisso é o padrão.
function motivoDescarte(caminho) {
  let texto = '';
  try { texto = fs.readFileSync(caminho, 'utf8'); } catch (e) { return `ilegível (${e.code || e.message})`; }
  const doc = new DOMParser({ errorHandler: {} }).parseFromString(texto, 'text/xml');
  const t = (n) => { const e = doc.getElementsByTagName(n)[0]; return e && e.textContent ? e.textContent.trim() : ''; };
  if (t('tpEvento')) return `evento ${t('tpEvento')} (não é venda)`;
  const mod = t('mod');
  if (!mod) return 'sem <mod> — não parece uma NF';
  if (mod !== '65') return `modelo ${mod} (só modelo 65 é venda do caixa)`;
  const cStat = t('cStat');
  if (cStat !== '100') return `cStat ${cStat || '(ausente)'} — nota não autorizada`;
  const cnpj = (() => { const e = doc.getElementsByTagName('emit')[0]; return e ? (e.getElementsByTagName('CNPJ')[0]?.textContent || '').trim() : ''; })();
  if (!CNPJ_EMPRESA[cnpj]) return `CNPJ ${cnpj || '(ausente)'} não está no mapa de empresas`;
  return 'motivo desconhecido';
}

function apurarDia(dataAlvo, diag) {
  const mes = new Date(dataAlvo + 'T12:00:00');
  const dirs = RAIZES_XML.map((raiz) => pastaDoMes(raiz, mes));
  const existentes = dirs.filter((d) => fs.existsSync(d));
  if (diag) {
    diag.pastas = dirs; diag.pasta = dirs.join(' ; ');
    diag.pastaExiste = existentes.length > 0; diag.pastasExistentes = existentes;
    diag.motivos = {}; diag.datas = {}; diag.arquivos = 0; diag.repetidas = 0;
  }
  if (!existentes.length) return {};

  const vendas = [];
  const cancelados = new Set();
  // A MESMA nota aparece em mais de um lugar: nas duas árvores de XML, e ainda
  // numa cópia do destinatário. Sem deduplicar por chave da NFC-e, ler as duas
  // pastas dobraria o faturamento — o erro exato que ler uma só evitava.
  const vistas = new Set();
  let ignorados = 0, repetidas = 0;
  for (const dir of existentes) {
    for (const caminho of xmlsDaArvore(dir)) {
      if (diag) diag.arquivos++;
      let r = null;
      try { r = lerArquivo(caminho); } catch (e) {
        ignorados++;
        if (diag) diag.motivos[`erro de leitura: ${e.message}`] = (diag.motivos[`erro de leitura: ${e.message}`] || 0) + 1;
        continue;
      }
      if (!r) {
        ignorados++;
        if (diag) { const m = motivoDescarte(caminho); diag.motivos[m] = (diag.motivos[m] || 0) + 1; }
        continue;
      }
      if (r.tipo === 'cancelamento') { cancelados.add(r.chave); continue; }
      if (r.chave && vistas.has(r.chave)) { repetidas++; continue; }
      if (r.chave) vistas.add(r.chave);
      if (diag) {
        diag.datas[r.data] = (diag.datas[r.data] || 0) + 1;
        // Censo dos códigos de pagamento realmente usados: é a única forma de
        // saber qual tPag o Eclética escreve pra cada forma da tela do caixa,
        // em vez de supor pela tabela da SEFAZ.
        diag.tPags = diag.tPags || {};
        (r.tPags || []).forEach((c) => {
          const k = `${c} (${FORMA_POR_TPAG[c] || 'outros'})`;
          diag.tPags[k] = (diag.tPags[k] || 0) + 1;
        });
      }
      if (r.data !== dataAlvo) continue;           // outro dia do mesmo mês
      vendas.push(r);
    }
  }
  if (diag) diag.repetidas = repetidas;

  // O cancelamento só é conhecido depois de varrer tudo — por isso o filtro
  // vem aqui, e não dentro do laço: a nota costuma ser lida antes do evento.
  const porEmpresa = {};
  let cancelados_no_dia = 0;
  for (const v of vendas) {
    if (v.chave && cancelados.has(v.chave)) { cancelados_no_dia++; continue; }
    const acc = porEmpresa[v.empresa] || (porEmpresa[v.empresa] = {
      total: 0, dinheiro: 0, maquininha: 0, vendas: 0,
      formas: Object.fromEntries(FORMAS.map((f) => [f, 0])),
    });
    acc.total += v.total;
    acc.dinheiro += v.canais.dinheiro;
    acc.maquininha += v.canais.maquininha;
    FORMAS.forEach((f) => { acc.formas[f] += v.formas[f] || 0; });
    acc.vendas++;
  }
  if (cancelados_no_dia) log(`  (${cancelados_no_dia} venda(s) cancelada(s) fora do faturamento)`);
  if (ignorados) log(`  (${ignorados} arquivo(s) ignorados: não autorizados, outro modelo ou CNPJ desconhecido)`);
  return porEmpresa;
}

async function enviar(empresa, data, acc) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const body = {
    empresa, data,
    fonte: FONTE,
    dinheiro: r2(acc.dinheiro),
    maquininha: r2(acc.maquininha),
    total: r2(acc.total),
    formas: Object.fromEntries(FORMAS.map((f) => [f, r2(acc.formas[f])])),
  };
  const r = await fetch(`${GESTAO_URL}/api/venda-pdv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`);
  const detalhe = FORMAS.filter((f) => body.formas[f] > 0).map((f) => `${f} ${body.formas[f].toFixed(2)}`).join(' | ');
  log(`✅ ${empresa} ${data}: ${acc.vendas} venda(s), total R$ ${body.total.toFixed(2)}  →  ${detalhe}`);
}

async function ciclo() {
  const hoje = new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD local
  try {
    const diag = {};
    const porEmpresa = apurarDia(hoje, diag);
    if (!Object.keys(porEmpresa).length) {
      // Distinguir os dois casos aqui é o que evita a tarde perdida: "a pasta
      // nem existe" e "existe mas nada passou nos filtros" parecem idênticos
      // na tela e têm soluções opostas.
      if (!diag.pastaExiste) log(`⚠️  nenhuma pasta do mês existe (${diag.pasta}) — confira ECLETICA_XML no iniciar.bat`);
      else if (!diag.arquivos) log(`⚠️  ${diag.pastasExistentes.join(' ; ')} existe mas está vazia`);
      else log(`nenhuma venda em ${hoje} ainda (${diag.arquivos} XML no mês; rode "node agent.js --diagnostico" pra ver o porquê)`);
      return;
    }
    for (const [empresa, acc] of Object.entries(porEmpresa)) {
      try { await enviar(empresa, hoje, acc); }
      catch (e) { log(`❌ falha ao enviar ${empresa}: ${e.message}`); }
    }
  } catch (e) { log(`❌ erro no ciclo: ${e.message}`); }
}

// Responde "por que não apareceu nada" sem precisar de mais nenhuma ferramenta
// no computador do caixa: node agent.js --diagnostico [AAAA-MM-DD]
function diagnostico(dataAlvo) {
  const diag = {};
  const porEmpresa = apurarDia(dataAlvo, diag);
  console.log(`\n=== Diagnóstico do dia ${dataAlvo} ===`);
  diag.pastas.forEach((d) => console.log(`Pasta do mês : ${d}   ${fs.existsSync(d) ? '[existe]' : '[NÃO existe]'}`));
  console.log(`Alguma existe: ${diag.pastaExiste ? 'SIM' : 'NÃO — é por isso que não aparece venda nenhuma'}`);
  if (!diag.pastaExiste) {
    console.log('\nAbra o Explorador de Arquivos nesse caminho. Se ele não existir, o');
    console.log('Eclética grava os XML em outro lugar — ache a pasta certa e ajuste a');
    console.log('linha "set ECLETICA_XML=" dentro do iniciar.bat.');
    return;
  }
  console.log(`XML na árvore: ${diag.arquivos}`);
  if (diag.repetidas) console.log(`Notas repetidas entre as pastas, contadas uma vez só: ${diag.repetidas}`);
  const datas = Object.entries(diag.datas).sort();
  console.log(`\nVendas válidas por data (as 10 mais recentes):`);
  if (!datas.length) console.log('  nenhuma — todos os arquivos foram descartados, ver abaixo');
  datas.slice(-10).forEach(([d, n]) => console.log(`  ${d}: ${n} venda(s)${d === dataAlvo ? '   <-- o dia procurado' : ''}`));
  const tp = Object.entries(diag.tPags || {}).sort((a, b) => b[1] - a[1]);
  if (tp.length) {
    console.log(`\nCódigos de pagamento (tPag) encontrados no mês:`);
    tp.forEach(([c, n]) => console.log(`  ${n}x  tPag ${c}`));
    console.log('  Se alguma forma da tela do caixa estiver caindo no lugar errado,');
    console.log('  ajuste com ECLETICA_TPAG no iniciar.bat (ex.: ECLETICA_TPAG=05=credito).');
  }
  const motivos = Object.entries(diag.motivos).sort((a, b) => b[1] - a[1]);
  if (motivos.length) {
    console.log(`\nArquivos descartados, por motivo:`);
    motivos.forEach(([m, n]) => console.log(`  ${n}x  ${m}`));
  }
  console.log(`\nTotal que seria enviado:`);
  const linhas = Object.entries(porEmpresa);
  if (!linhas.length) console.log('  nada');
  linhas.forEach(([emp, a]) => {
    console.log(`  ${emp}: R$ ${a.total.toFixed(2)} em ${a.vendas} venda(s)`);
    FORMAS.filter((f) => a.formas[f] > 0.005).forEach((f) => console.log(`      ${f.padEnd(9)} R$ ${a.formas[f].toFixed(2)}`));
    if (a.formas.pendura > 0.005) console.log('      (pendura entra no total, mas fora de dinheiro e maquininha)');
  });
  console.log('');
}

export { lerArquivo, lerVenda, apurarDia, ciclo, diagnostico };

// Só sobe o laço quando executado direto (node agent.js). Importado pelos
// testes, apenas expõe as funções — senão a suíte ficaria postando de verdade.
const executadoDireto = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (executadoDireto) {
  if (process.argv.includes('--diagnostico')) {
    const arg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    diagnostico(arg || new Date().toLocaleDateString('sv-SE'));
    process.exit(0);
  }
  if (!SECRET) {
    console.error('SEAMA_SERVICE_SECRET não configurado — veja iniciar.bat');
    process.exit(1);
  }
  log(`Ponte Eclética → Gestão iniciada. Lendo ${RAIZES_XML.join(' e ')} a cada ${INTERVALO / 60000} min.`);
  ciclo();
  setInterval(ciclo, INTERVALO);
}
