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

// Onde procurar EVENTO DE CANCELAMENTO. O Eclética não grava o evento junto da
// nota: o diagnóstico de setembro mostrou 764 arquivos em XmlVenda/XmlVenda2 e
// ZERO descartados, ou seja, nenhum evento ali. Os documentos de transmissão
// ficam em ArquivosSistema\NFCe, então é lá que o cancelamento deve estar.
// Daqui só sai cancelamento — a fonte da verdade das VENDAS continua sendo
// XmlVenda*, pra uma cópia do destinatário não virar venda extra.
const RAIZES_EVENTOS = (process.env.ECLETICA_EVENTOS
  || Array.from(new Set(RAIZES_XML.map((r) => path.join(path.dirname(r), 'NFCe')))).join(';'))
  .split(';').map((t) => t.trim()).filter(Boolean);

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
const APLICAR_TPAG = () => (process.env.ECLETICA_TPAG || '').split(',').map((p) => p.trim()).filter(Boolean).forEach((par) => {
  const [cod, forma] = par.split('=').map((t) => t.trim());
  if (!cod || !forma) return;
  // Nome de forma inventado (ex.: "cartao") somaria em formas[forma], que não
  // existe: undefined + número = NaN, e o dia inteiro subiria como NaN sem
  // erro nenhum. Melhor recusar em voz alta do que aceitar e corromper.
  if (!FORMAS.includes(forma)) {
    console.error(`⚠️  ECLETICA_TPAG: "${forma}" não é uma forma válida. Use uma de: ${FORMAS.join(', ')}. Ignorando "${par}".`);
    return;
  }
  FORMA_POR_TPAG[cod] = forma;
});

// Pendura (fiado) fica FORA dos dois baldes: é venda faturada com recebimento
// adiado, não é dinheiro na gaveta nem valor a conferir no extrato do cartão.
// Entra no total do dia, que é o número que o caixa vê ao fechar. Essa é a
// mesma regra que o delivery-backend já aplica (FORA_DOS_BALDES lá) — as duas
// fontes precisam contar igual, senão a DRE soma maçã com laranja.
const FORMAS = ['dinheiro', 'credito', 'debito', 'pix', 'pendura', 'outros'];

const BALDE_POR_FORMA = {
  dinheiro: 'dinheiro',
  credito: 'maquininha',
  debito: 'maquininha',
  pix: 'maquininha',                                  // eletrônico: cai na conta, não na gaveta
  outros: 'maquininha',
  pendura: null,                                      // no total, fora dos baldes
};
APLICAR_TPAG();

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
  return lerTexto(fs.readFileSync(caminho, 'utf8'));
}

function lerTexto(texto) {
  const doc = new DOMParser({ errorHandler: {} }).parseFromString(texto, 'text/xml');
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

  // Itens vendidos. O <det> traz código, descrição, quantidade, unidade e valor
  // de cada produto — é o dado que os relatórios de Produtos, Curva ABC e
  // Margem do Gestão sempre souberam usar e nunca tiveram da venda do balcão.
  //
  // vProd é o valor do item ANTES de desconto e sem rateio de gorjeta, então a
  // soma dos itens não fecha exatamente com o total da venda. É de propósito:
  // para ranking e margem o que importa é o peso relativo de cada produto, e
  // distribuir gorjeta por item inventaria um número que não existe na nota.
  const itens = Array.from(doc.getElementsByTagName('det')).map((d) => {
    const prod = d.getElementsByTagName('prod')[0];
    if (!prod) return null;
    const nome = tag(prod, 'xProd');
    if (!nome) return null;
    return {
      cod: tag(prod, 'cProd'),
      nome,
      qtd: parseFloat(tag(prod, 'qCom')) || 0,
      un: tag(prod, 'uCom') || 'un',
      valor: parseFloat(tag(prod, 'vProd')) || 0,
    };
  }).filter(Boolean);

  // Divide entre os canais pelas formas de pagamento. Venda paga metade no
  // cartão e metade em dinheiro tem dois <detPag>; ratear pelo peso de cada um
  // mantém a soma exata mesmo quando a gorjeta entra no meio.
  const detPags = Array.from(doc.getElementsByTagName('detPag'));
  const pagos = detPags.map((d) => {
    const tPag = tag(d, 'tPag');
    // xPag é a descrição em texto que acompanha tPag 99 ("Outros"). É o único
    // lugar do XML que diz o que o caixa chamou aquela forma na tela.
    return { tPag, xPag: tag(d, 'xPag'), forma: FORMA_POR_TPAG[tPag] || 'outros', valor: parseFloat(tag(d, 'vPag')) || 0 };
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

  return { tipo: 'venda', empresa, data, total: totalVenda, canais, formas, itens, chave: tag(null, 'chNFe'),
    tPags: pagos.map((p) => ({ tPag: p.tPag, xPag: p.xPag, valor: p.valor })) };
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
        (r.tPags || []).forEach((p) => {
          const k = `${p.tPag} (${FORMA_POR_TPAG[p.tPag] || 'outros'})${p.xPag ? ` "${p.xPag}"` : ''}`;
          const acc = diag.tPags[k] || (diag.tPags[k] = { n: 0, valor: 0 });
          acc.n++; acc.valor += p.valor;
        });
      }
      if (r.data !== dataAlvo) continue;           // outro dia do mesmo mês
      vendas.push(r);
    }
  }
  if (diag) diag.repetidas = repetidas;

  // Eventos de cancelamento, numa árvore separada. Dois cuidados: só arquivos
  // com "tpEvento" no texto são parseados (a pasta de Log tem milhares de
  // envelopes de transmissão que não interessam), e só os recentes em relação
  // ao mês procurado — senão cada ciclo de 2 min releria o histórico inteiro.
  const limite = new Date(mes.getFullYear(), mes.getMonth(), 1).getTime() - 7 * 864e5;
  let eventos = 0;
  for (const dir of RAIZES_EVENTOS) {
    if (!fs.existsSync(dir)) continue;
    for (const caminho of xmlsDaArvore(dir)) {
      try {
        if (fs.statSync(caminho).mtimeMs < limite) continue;
        const texto = fs.readFileSync(caminho, 'utf8');
        if (texto.indexOf('tpEvento') < 0) continue;
        const r = lerTexto(texto);
        if (r && r.tipo === 'cancelamento') { cancelados.add(r.chave); eventos++; }
      } catch { /* arquivo em uso / ilegível: não pode derrubar a apuração */ }
    }
  }
  if (diag) { diag.eventosCancelamento = eventos; diag.raizesEventos = RAIZES_EVENTOS; }

  // O cancelamento só é conhecido depois de varrer tudo — por isso o filtro
  // vem aqui, e não dentro do laço: a nota costuma ser lida antes do evento.
  const porEmpresa = {};
  let cancelados_no_dia = 0;
  for (const v of vendas) {
    if (v.chave && cancelados.has(v.chave)) { cancelados_no_dia++; continue; }
    const acc = porEmpresa[v.empresa] || (porEmpresa[v.empresa] = {
      total: 0, dinheiro: 0, maquininha: 0, vendas: 0,
      formas: Object.fromEntries(FORMAS.map((f) => [f, 0])),
      // Agregado por PRODUTO, não item a item. O Gestão sincroniza o documento
      // inteiro entre os aparelhos a cada ~100ms; guardar cada linha de cada
      // cupom engordaria esse tráfego todo dia, pra sempre. Por dia e por
      // produto é o suficiente pra ranking, ABC e margem.
      itens: new Map(),
    });
    acc.total += v.total;
    acc.dinheiro += v.canais.dinheiro;
    acc.maquininha += v.canais.maquininha;
    FORMAS.forEach((f) => { acc.formas[f] += v.formas[f] || 0; });
    // Chave pelo CÓDIGO quando existe: o nome muda quando alguém reedita o
    // cadastro ("PAO DE QUEIJO" → "PÃO DE QUEIJO GD") e o produto viraria dois
    // no ranking. Sem código, o nome é o que há.
    (v.itens || []).forEach((it) => {
      const k = it.cod || it.nome.toUpperCase();
      const cur = acc.itens.get(k) || { cod: it.cod, nome: it.nome, un: it.un, qtd: 0, valor: 0 };
      cur.qtd += it.qtd; cur.valor += it.valor;
      cur.nome = it.nome;                            // o mais recente vence
      acc.itens.set(k, cur);
    });
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
    // Teto pra um cardápio gigante não virar um POST desproporcional. Ordenado
    // por valor, então o que for cortado é a cauda irrelevante do ranking.
    itens: Array.from(acc.itens.values())
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 300)
      .map((it) => ({ cod: it.cod, nome: it.nome, un: it.un, qtd: Math.round(it.qtd * 1000) / 1000, valor: r2(it.valor) })),
  };
  const r = await fetch(`${GESTAO_URL}/api/venda-pdv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-secret': SECRET },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`);
  const detalhe = FORMAS.filter((f) => body.formas[f] > 0).map((f) => `${f} ${body.formas[f].toFixed(2)}`).join(' | ');
  log(`✅ ${empresa} ${data}: ${acc.vendas} venda(s), ${body.itens.length} produto(s), total R$ ${body.total.toFixed(2)}  →  ${detalhe}`);
}

// Quais dias reenviar a cada ciclo. O agente só mandava o dia corrente e nunca
// voltava atrás: se o PC do caixa fosse desligado antes do último ciclo, as
// notas finais do dia ficavam no disco e não subiam NUNCA MAIS — em silêncio, e
// só apareceria como uma diferença inexplicável no fechamento do mês. Reenviar
// ontem junto fecha esse buraco, e é seguro porque /api/venda-pdv SUBSTITUI o
// registro do dia em vez de somar.
//
// Recebe a data de referência em vez de chamar new Date() lá dentro: é o que
// torna a virada de mês testável.
function diasParaEnviar(ref = new Date()) {
  // `parseInt('0') || 1` daria 1: zero é falsy, e ECLETICA_DIAS_ATRAS=0
  // (voltar ao comportamento antigo, só o dia corrente) seria ignorado.
  const bruto = parseInt(process.env.ECLETICA_DIAS_ATRAS, 10);
  const atras = Math.min(Math.max(Number.isFinite(bruto) ? bruto : 1, 0), 31);
  const dias = [];
  for (let i = atras; i >= 0; i--) {
    const d = new Date(ref);
    d.setDate(d.getDate() - i);                    // setDate vira o mês sozinho
    dias.push(d.toLocaleDateString('sv-SE'));
  }
  return dias;
}

// Último valor enviado por empresa+data, pra não repetir POST idêntico a cada 2
// minutos. É memória de processo: reiniciar o agente reenvia tudo uma vez, o
// que é inofensivo (o registro é substituído) e ainda serve de reconciliação.
const ultimoEnvio = new Map();

async function ciclo() {
  const dias = diasParaEnviar();
  const hoje = dias[dias.length - 1];
  let mexeu = false, totalHoje = null;

  for (const data of dias) {
    try {
      const diag = {};
      const porEmpresa = apurarDia(data, diag);
      if (!Object.keys(porEmpresa).length) {
        // Dia passado sem venda não vira aviso: a loja pode ter fechado. Só o
        // dia corrente merece explicação, e distinguir os casos aqui é o que
        // evita a tarde perdida — "a pasta nem existe" e "existe mas nada
        // passou nos filtros" parecem idênticos na tela e têm soluções opostas.
        if (data !== hoje) continue;
        if (!diag.pastaExiste) log(`⚠️  nenhuma pasta do mês existe (${diag.pasta}) — confira ECLETICA_XML no iniciar.bat`);
        else if (!diag.arquivos) log(`⚠️  ${diag.pastasExistentes.join(' ; ')} existe mas está vazia`);
        else log(`nenhuma venda em ${hoje} ainda (${diag.arquivos} XML no mês; rode "node agent.js --diagnostico" pra ver o porquê)`);
        continue;
      }
      for (const [empresa, acc] of Object.entries(porEmpresa)) {
        const chave = `${empresa}|${data}`;
        const assinatura = `${acc.total.toFixed(2)}|${acc.vendas}`;
        if (data === hoje) totalHoje = acc.total;
        if (ultimoEnvio.get(chave) === assinatura) continue;   // nada mudou
        try {
          await enviar(empresa, data, acc);
          ultimoEnvio.set(chave, assinatura);
          mexeu = true;
        } catch (e) { log(`❌ falha ao enviar ${empresa} ${data}: ${e.message}`); }
      }
    } catch (e) { log(`❌ erro no ciclo (${data}): ${e.message}`); }
  }

  // Batimento de vida: sem isso a janela fica parada por horas num dia movimentado
  // sem venda nova, e não dá pra distinguir "tudo certo" de "travou".
  if (!mexeu && totalHoje !== null) log(`· ${hoje}: sem venda nova (total R$ ${totalHoje.toFixed(2)})`);
}

// Envia um intervalo de dias de uma vez. Serve pra preencher o histórico que
// ficou no disco antes de a ponte existir, e pra refazer um período depois de
// corrigir o mapa de formas de pagamento.
//
// É seguro reexecutar: /api/venda-pdv SUBSTITUI o registro do dia. Mandar o
// mesmo período duas vezes dá o mesmo resultado, não o dobro.
async function enviarPeriodo(ini, fim, simular) {
  const valido = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!valido(ini) || !valido(fim)) { console.error('Datas devem estar no formato AAAA-MM-DD.'); return; }
  if (fim < ini) { console.error(`Data final (${fim}) é anterior à inicial (${ini}).`); return; }

  const dias = [];
  for (const d = new Date(ini + 'T12:00:00'); d.toLocaleDateString('sv-SE') <= fim; d.setDate(d.getDate() + 1)) {
    dias.push(d.toLocaleDateString('sv-SE'));
    if (dias.length > 400) break;                  // trava contra intervalo digitado errado
  }

  console.log(`\n=== ${simular ? 'SIMULAÇÃO' : 'Envio'} de ${ini} a ${fim} (${dias.length} dia(s)) ===`);
  if (simular) console.log('Nada será enviado ao servidor — só leitura.\n');

  const somas = {};
  let comVenda = 0;
  for (const data of dias) {
    const diag = {};
    let porEmpresa;
    try { porEmpresa = apurarDia(data, diag); }
    catch (e) { console.log(`  ${data}  ❌ ${e.message}`); continue; }
    const linhas = Object.entries(porEmpresa);
    if (!linhas.length) { console.log(`  ${data}  —`); continue; }
    comVenda++;
    for (const [empresa, acc] of linhas) {
      somas[empresa] = (somas[empresa] || 0) + acc.total;
      const detalhe = FORMAS.filter((f) => acc.formas[f] > 0.005).map((f) => `${f} ${acc.formas[f].toFixed(2)}`).join(' | ');
      if (simular) {
        console.log(`  ${data}  ${empresa}  R$ ${acc.total.toFixed(2).padStart(10)}  (${acc.vendas} vendas)  ${detalhe}`);
      } else {
        try { await enviar(empresa, data, acc); }
        catch (e) { console.log(`  ${data}  ❌ falha ao enviar ${empresa}: ${e.message}`); }
      }
    }
  }

  console.log(`\n${comVenda} dia(s) com venda.`);
  Object.entries(somas).forEach(([emp, t]) => console.log(`  ${emp}: R$ ${t.toFixed(2)} no período`));
  if (simular) console.log('\nConfira os números acima. Para enviar de verdade, rode de novo sem --simular.');
  console.log('');
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
  (diag.raizesEventos || []).forEach((d) => console.log(`Eventos em   : ${d}   ${fs.existsSync(d) ? '[existe]' : '[NÃO existe]'}`));
  console.log(`Cancelamentos encontrados: ${diag.eventosCancelamento || 0}`);
  if (diag.repetidas) console.log(`Notas repetidas entre as pastas, contadas uma vez só: ${diag.repetidas}`);
  const datas = Object.entries(diag.datas).sort();
  console.log(`\nVendas válidas por data (as 10 mais recentes):`);
  if (!datas.length) console.log('  nenhuma — todos os arquivos foram descartados, ver abaixo');
  datas.slice(-10).forEach(([d, n]) => console.log(`  ${d}: ${n} venda(s)${d === dataAlvo ? '   <-- o dia procurado' : ''}`));
  const tp = Object.entries(diag.tPags || {}).sort((a, b) => b[1].valor - a[1].valor);
  if (tp.length) {
    console.log(`\nCódigos de pagamento (tPag) encontrados no mês:`);
    tp.forEach(([c, a]) => console.log(`  ${String(a.n).padStart(4)}x  R$ ${a.valor.toFixed(2).padStart(10)}  tPag ${c}`));
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
    const top = Array.from(a.itens.values()).sort((x, y) => y.valor - x.valor);
    if (top.length) {
      console.log(`      ${top.length} produto(s) diferentes. Os 5 maiores:`);
      top.slice(0, 5).forEach((it) => console.log(`        ${it.qtd.toFixed(0).padStart(4)} ${String(it.un).padEnd(3)} R$ ${it.valor.toFixed(2).padStart(9)}  ${it.nome}`));
    }
  });
  console.log('');
}

export { lerArquivo, lerTexto, lerVenda, apurarDia, ciclo, diagnostico, diasParaEnviar, enviarPeriodo };

// Só sobe o laço quando executado direto (node agent.js). Importado pelos
// testes, apenas expõe as funções — senão a suíte ficaria postando de verdade.
const executadoDireto = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (executadoDireto) {
  if (process.argv.includes('--enviar')) {
    const datas = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    const simular = process.argv.includes('--simular');
    if (!datas.length) {
      console.error('Uso: node agent.js --enviar AAAA-MM-DD [AAAA-MM-DD] [--simular]');
      process.exit(1);
    }
    if (!simular && !SECRET) { console.error('SEAMA_SERVICE_SECRET não configurado — veja config.bat'); process.exit(1); }
    await enviarPeriodo(datas[0], datas[1] || datas[0], simular);
    process.exit(0);
  }
  if (process.argv.includes('--diagnostico')) {
    const arg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    diagnostico(arg || new Date().toLocaleDateString('sv-SE'));
    process.exit(0);
  }
  if (!SECRET) {
    console.error('SEAMA_SERVICE_SECRET não configurado — veja config.bat');
    process.exit(1);
  }
  const dias = diasParaEnviar();
  log(`Ponte Eclética → Gestão iniciada. Lendo ${RAIZES_XML.join(' e ')} a cada ${INTERVALO / 60000} min.`);
  log(`Mantendo atualizado${dias.length > 1 ? ` de ${dias[0]} até ${dias[dias.length - 1]}` : ` o dia ${dias[0]}`} (ECLETICA_DIAS_ATRAS=${dias.length - 1}).`);
  ciclo();
  setInterval(ciclo, INTERVALO);
}
