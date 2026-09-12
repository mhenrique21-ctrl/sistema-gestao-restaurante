import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.SEAMA_SERVICE_SECRET = 'teste';
const { lerVenda, lerArquivo, apurarDia } = await import('./agent.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecletica-'));
const escrever = (nome, xml) => { const p = path.join(tmp, nome); fs.writeFileSync(p, xml); return p; };
const CHAVE = '1626095856421400017065001000020118107103832';

// Monta uma NFC-e com as partes que importam. Mantém a estrutura real: <vProd>
// aparece nos itens E no total, que é justamente a pegadinha.
const nfce = ({ cnpj = '58564214000170', mod = '65', cStat = '100', dhEmi = '2026-09-11T19:34:01-03:00',
  vNF = '84.00', pags = [{ tPag: '03', vPag: '92.40' }], vTroco = '8.40', infCpl = 'SUBTOTAL R$84,00+GORJETA CONCEDIDA R$8,40|TOTAL GERAL R$92,40' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe>
<ide><mod>${mod}</mod><dhEmi>${dhEmi}</dhEmi></ide>
<emit><CNPJ>${cnpj}</CNPJ></emit>
<det nItem="1"><prod><xProd>ITEM A</xProd><vProd>20.00</vProd></prod></det>
<det nItem="2"><prod><xProd>ITEM B</xProd><vProd>64.00</vProd></prod></det>
<total><ICMSTot><vProd>84.00</vProd><vNF>${vNF}</vNF></ICMSTot></total>
<pag>${pags.map((p) => `<detPag><tPag>${p.tPag}</tPag><vPag>${p.vPag}</vPag></detPag>`).join('')}<vTroco>${vTroco}</vTroco></pag>
<infAdic><infCpl>${infCpl}</infCpl></infAdic>
</infNFe></NFe><protNFe><infProt><chNFe>${CHAVE}</chNFe><cStat>${cStat}</cStat></infProt></protNFe></nfeProc>`;

test('ponte Eclética → Gestão', async (t) => {
  await t.test('lê o total do ICMSTot, não o vProd do primeiro item', () => {
    const v = lerVenda(escrever('a.xml', nfce()));
    // Sem escopar em ICMSTot, o primeiro <vProd> do documento é 20.00 — uma
    // venda de R$ 84 viraria R$ 20 e ninguém notaria de imediato.
    assert.equal(v.total, 92.40, 'vNF 84,00 + gorjeta 8,40');
  });

  await t.test('gorjeta sai do texto do infCpl, não do vTroco', () => {
    // O mesmo vTroco de 8,40, mas numa venda em DINHEIRO ele é troco de verdade.
    // Se a gorjeta viesse de vTroco, esta venda seria contada como 92,40 quando
    // o cliente pagou 100 e levou 16 de volta numa conta de 84.
    const v = lerVenda(escrever('b.xml', nfce({
      pags: [{ tPag: '01', vPag: '100.00' }], vTroco: '16.00',
      infCpl: 'Trib aprox R$0,12 est',                 // sem gorjeta declarada
    })));
    assert.equal(v.total, 84.00, 'troco não pode virar faturamento');
    assert.equal(v.canais.dinheiro, 84.00);
    assert.equal(v.canais.maquininha, 0);
  });

  await t.test('cartão vai pra maquininha e PIX também', () => {
    assert.equal(lerVenda(escrever('c.xml', nfce())).canais.maquininha, 92.40);
    const pix = lerVenda(escrever('d.xml', nfce({ pags: [{ tPag: '17', vPag: '92.40' }] })));
    assert.equal(pix.canais.maquininha, 92.40, 'PIX é eletrônico: cai na conta, não na gaveta');
  });

  await t.test('venda dividida entre cartão e dinheiro rateia sem perder centavo', () => {
    const v = lerVenda(escrever('e.xml', nfce({
      vNF: '100.00', infCpl: 'sem gorjeta',
      pags: [{ tPag: '03', vPag: '60.00' }, { tPag: '01', vPag: '40.00' }],
      vTroco: '0.00',
    })));
    assert.equal(v.canais.maquininha, 60);
    assert.equal(v.canais.dinheiro, 40);
    assert.equal(v.canais.maquininha + v.canais.dinheiro, v.total, 'a soma dos canais tem que fechar com o total');
  });

  await t.test('nota não autorizada é descartada', () => {
    assert.equal(lerVenda(escrever('f.xml', nfce({ cStat: '539' }))), null, 'rejeitada não é venda');
  });

  await t.test('modelo diferente de 65 é descartado', () => {
    assert.equal(lerVenda(escrever('g.xml', nfce({ mod: '55' }))), null, 'NF-e de compra não é venda do caixa');
  });

  await t.test('CNPJ desconhecido é descartado', () => {
    assert.equal(lerVenda(escrever('h.xml', nfce({ cnpj: '00000000000000' }))), null,
      'venda de outra empresa não pode entrar no faturamento desta');
  });

  await t.test('cada forma de pagamento cai na sua coluna', () => {
    const caso = (tPag) => lerVenda(escrever(`f-${tPag}.xml`, nfce({
      vNF: '100.00', infCpl: 'sem gorjeta', vTroco: '0.00', pags: [{ tPag, vPag: '100.00' }],
    })));
    assert.equal(caso('01').formas.dinheiro, 100, 'dinheiro');
    assert.equal(caso('03').formas.credito, 100, 'cartão de crédito');
    assert.equal(caso('04').formas.debito, 100, 'cartão de débito');
    assert.equal(caso('17').formas.pix, 100, 'PIX dinâmico');
    assert.equal(caso('20').formas.pix, 100, 'PIX estático');
  });

  await t.test('pendura entra no total mas fica fora de dinheiro e maquininha', () => {
    // Regra herdada do delivery-backend: fiado é venda faturada com recebimento
    // adiado. Está no número que o caixa vê ao fechar, mas não é dinheiro na
    // gaveta nem valor a conferir no extrato do cartão — jogá-lo na maquininha
    // estouraria a conferência contra a operadora todo mês.
    const v = lerVenda(escrever('pendura.xml', nfce({
      vNF: '30.00', infCpl: 'sem gorjeta', vTroco: '0.00', pags: [{ tPag: '05', vPag: '30.00' }],
    })));
    assert.equal(v.total, 30, 'a venda aconteceu: entra no total do dia');
    assert.equal(v.formas.pendura, 30);
    assert.equal(v.canais.dinheiro, 0, 'não entrou na gaveta');
    assert.equal(v.canais.maquininha, 0, 'não vai aparecer no extrato do cartão');
  });

  await t.test('venda parte no cartão e parte na pendura divide certo', () => {
    const v = lerVenda(escrever('misto.xml', nfce({
      vNF: '100.00', infCpl: 'sem gorjeta', vTroco: '0.00',
      pags: [{ tPag: '04', vPag: '60.00' }, { tPag: '05', vPag: '40.00' }],
    })));
    assert.equal(v.formas.debito, 60);
    assert.equal(v.formas.pendura, 40);
    assert.equal(v.canais.maquininha, 60, 'só os 60 do débito vão pro extrato');
    assert.equal(v.canais.dinheiro, 0);
    assert.equal(v.total, 100, 'o total do dia continua sendo a venda inteira');
  });

  await t.test('ECLETICA_TPAG reconfigura um código sem mexer no código-fonte', async () => {
    // O Eclética pode usar um tPag fora do óbvio pra alguma forma da tela do
    // caixa. Descobrir isso não pode exigir alterar o agente e reinstalar.
    const antes = process.env.ECLETICA_TPAG;
    try {
      process.env.ECLETICA_TPAG = '05=credito,99=pendura';
      const { lerVenda: ler } = await import(`./agent.js?tpag=${Date.now()}`);
      const v = ler(escrever('tpag-05.xml', nfce({
        vNF: '50.00', infCpl: 'sem gorjeta', vTroco: '0.00', pags: [{ tPag: '05', vPag: '50.00' }],
      })));
      assert.equal(v.formas.credito, 50, '05 passou a ser crédito');
      assert.equal(v.canais.maquininha, 50, 'e agora entra no balde eletrônico');
      const w = ler(escrever('tpag-99.xml', nfce({
        vNF: '50.00', infCpl: 'sem gorjeta', vTroco: '0.00', pags: [{ tPag: '99', vPag: '50.00' }],
      })));
      assert.equal(w.formas.pendura, 50, '99 passou a ser pendura');
      assert.equal(w.canais.maquininha, 0);
    } finally {
      if (antes === undefined) delete process.env.ECLETICA_TPAG; else process.env.ECLETICA_TPAG = antes;
    }
  });

  await t.test('a data vem do dhEmi local, sem conversão de fuso', () => {
    // Venda às 23h com fuso -03:00: new Date().toISOString() jogaria pro dia
    // seguinte e o faturamento cairia na data errada.
    const v = lerVenda(escrever('i.xml', nfce({ dhEmi: '2026-09-11T23:40:00-03:00' })));
    assert.equal(v.data, '2026-09-11');
  });
});

// Evento de cancelamento de NFC-e (procEventoNFe). Não tem <mod> nem <dhEmi> —
// é um documento de forma completamente diferente da nota.
const evento = ({ chave = CHAVE, tpEvento = '110111', cStat = '135' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
<evento><infEvento><chNFe>${chave}</chNFe><tpEvento>${tpEvento}</tpEvento>
<detEvento><descEvento>Cancelamento</descEvento><xJust>Erro do operador</xJust></detEvento></infEvento></evento>
${cStat ? `<retEvento><infEvento><chNFe>${chave}</chNFe><cStat>${cStat}</cStat></infEvento></retEvento>` : ''}
</procEventoNFe>`;

test('venda cancelada fica fora do faturamento', async (t) => {
  // Monta uma árvore de mês parecida com a real: a nota em Emitidos e o evento
  // de cancelamento numa pasta irmã — que foi o motivo de varrer o mês inteiro
  // em vez de só Emitidos.
  const mes = fs.mkdtempSync(path.join(os.tmpdir(), 'ecletica-mes-'));
  const raiz = path.join(mes, '2026', '09');
  fs.mkdirSync(path.join(raiz, 'Emitidos'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'Eventos'), { recursive: true });
  process.env.ECLETICA_XML = mes;
  const { apurarDia: apurar } = await import(`./agent.js?mes=${Date.now()}`);

  const nota = (chave, vNF) => nfce({ vNF, infCpl: 'sem gorjeta', pags: [{ tPag: '01', vPag: vNF }], vTroco: '0.00' })
    .replace(CHAVE, chave);
  fs.writeFileSync(path.join(raiz, 'Emitidos', 'boa.xml'), nota('1'.repeat(44), '50.00'));
  fs.writeFileSync(path.join(raiz, 'Emitidos', 'ruim.xml'), nota('2'.repeat(44), '30.00'));

  await t.test('sem o evento, as duas contam', () => {
    assert.equal(apurar('2026-09-11').CONFRARIA.total, 80);
  });

  await t.test('com o evento numa pasta irmã, a cancelada sai', () => {
    fs.writeFileSync(path.join(raiz, 'Eventos', 'canc.xml'), evento({ chave: '2'.repeat(44) }));
    const r = apurar('2026-09-11');
    assert.equal(r.CONFRARIA.total, 50, 'venda cancelada não pode entrar no faturamento');
    assert.equal(r.CONFRARIA.vendas, 1);
  });

  await t.test('a ordem de leitura não importa — o filtro é depois da varredura', () => {
    // "canc.xml" vem depois de "boa.xml" e "ruim.xml" na ordem alfabética, mas
    // está noutra pasta; se o filtro rodasse dentro do laço, o resultado
    // dependeria de qual arquivo o sistema de arquivos devolvesse primeiro.
    fs.writeFileSync(path.join(raiz, 'Emitidos', 'aaa-canc.xml'), evento({ chave: '1'.repeat(44) }));
    assert.equal(apurar('2026-09-11').CONFRARIA, undefined, 'as duas canceladas: nada sobra');
    fs.unlinkSync(path.join(raiz, 'Emitidos', 'aaa-canc.xml'));
  });

  await t.test('nota movida pra pasta Cancelados também não conta', () => {
    // Alguns emissores não gravam evento: só movem o arquivo de pasta.
    fs.mkdirSync(path.join(raiz, 'Cancelados'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'Cancelados', 'movida.xml'), nota('3'.repeat(44), '999.00'));
    assert.equal(apurar('2026-09-11').CONFRARIA.total, 50, 'pasta de cancelados é ignorada inteira');
  });

  await t.test('carta de correção não cancela nada', () => {
    fs.writeFileSync(path.join(raiz, 'Eventos', 'cce.xml'), evento({ chave: '1'.repeat(44), tpEvento: '110110' }));
    assert.equal(apurar('2026-09-11').CONFRARIA.total, 50, 'a venda de 50 continua valendo');
  });

  await t.test('evento rejeitado pela SEFAZ não cancela', () => {
    // cStat 573 = "duplicidade de evento": o cancelamento NÃO foi registrado.
    fs.writeFileSync(path.join(raiz, 'Eventos', 'rej.xml'), evento({ chave: '1'.repeat(44), cStat: '573' }));
    assert.equal(apurar('2026-09-11').CONFRARIA.total, 50);
  });

  await t.test('a mesma nota nas duas árvores de XML conta uma vez só', async () => {
    // A instalação real tem XmlVenda e XmlVenda2 lado a lado, e ainda uma cópia
    // do destinatário — a mesma venda aparece em mais de um arquivo. Ler as duas
    // pastas sem deduplicar por chave dobraria o faturamento do dia.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecletica-2raizes-'));
    const a = path.join(base, 'XmlVenda', '2026', '09', 'Emitidos');
    const b = path.join(base, 'XmlVenda2', '2026', '09', 'Emitidos');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    const nota = (chave, vNF) => nfce({ vNF, infCpl: 'sem gorjeta', pags: [{ tPag: '01', vPag: vNF }], vTroco: '0.00' }).replace(CHAVE, chave);

    // A MESMA nota (mesma chave) escrita nas duas pastas.
    fs.writeFileSync(path.join(a, 'n1.xml'), nota('7'.repeat(44), '40.00'));
    fs.writeFileSync(path.join(b, 'n1-copia.xml'), nota('7'.repeat(44), '40.00'));
    // E uma que só existe na segunda — essa não pode ser perdida.
    fs.writeFileSync(path.join(b, 'n2.xml'), nota('8'.repeat(44), '10.00'));

    const envAntes = process.env.ECLETICA_XML;
    try {
      process.env.ECLETICA_XML = `${path.join(base, 'XmlVenda')};${path.join(base, 'XmlVenda2')}`;
      const { apurarDia: apurar } = await import(`./agent.js?raizes=${Date.now()}`);
      const diag = {};
      const r = apurar('2026-09-11', diag);

      assert.equal(r.CONFRARIA.total, 50, '40 + 10 — a cópia da primeira não pode somar de novo');
      assert.equal(r.CONFRARIA.vendas, 2);
      assert.equal(diag.repetidas, 1, 'a repetida foi contada como repetida, não descartada em silêncio');
    } finally {
      // O módulo lê ECLETICA_XML no import; deixar o valor trocado faria o
      // próximo teste (que reimporta) olhar pra árvore errada.
      process.env.ECLETICA_XML = envAntes;
    }
  });

  await t.test('o diagnóstico separa "pasta não existe" de "nada passou nos filtros"', async () => {
    // Os dois casos produzem exatamente a mesma tela ("nenhuma venda hoje") e
    // pedem soluções opostas: um é caminho errado no iniciar.bat, o outro é
    // filtro barrando nota boa. Sem essa distinção a busca começa do zero.
    const { apurarDia: apurar } = await import(`./agent.js?diag=${Date.now()}`);

    const vazio = {};
    apurar('2019-01-01', vazio);
    assert.equal(vazio.pastaExiste, false, 'mês sem pasta');

    const cheio = {};
    apurar('2026-09-11', cheio);
    assert.equal(cheio.pastaExiste, true);
    assert.ok(cheio.arquivos > 0, 'contou os XML da árvore');
    assert.ok(cheio.datas['2026-09-11'] > 0, 'registrou as datas encontradas');

    // Uma nota de outro CNPJ tem que aparecer com o motivo dito por extenso —
    // é o erro mais provável na instalação (loja com mais de um emitente).
    fs.writeFileSync(path.join(raiz, 'Emitidos', 'outra-empresa.xml'), nfce({ cnpj: '99999999999999' }));
    const comOutro = {};
    apurar('2026-09-11', comOutro);
    const motivo = Object.keys(comOutro.motivos).find((m) => m.includes('99999999999999'));
    assert.ok(motivo, `o motivo devia citar o CNPJ recusado, veio: ${JSON.stringify(comOutro.motivos)}`);
    fs.unlinkSync(path.join(raiz, 'Emitidos', 'outra-empresa.xml'));
  });

  await t.test('lerArquivo distingue os dois tipos de documento', () => {
    assert.equal(lerArquivo(escrever('ev.xml', evento())).tipo, 'cancelamento');
    assert.equal(lerArquivo(escrever('vd.xml', nfce())).tipo, 'venda');
  });
});
