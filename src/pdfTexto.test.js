import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { lerPdf, lerConteudo, agruparEmLinhas, lerStringLiteral, lerStringHex } from './pdfTexto.js';

// Monta um PDF de verdade (estrutura mínima, mas válida) com o conteúdo dado.
// ⚠️ Isto testa a MECÂNICA de extrair texto, que é genérica. O layout do
// relatório de cada plataforma continua precisando de um arquivo REAL — a
// mesma regra dos leitores de comanda.
function pdfCom(conteudo, comprimir = true) {
  const fluxo = comprimir ? zlib.deflateSync(Buffer.from(conteudo, 'latin1')) : Buffer.from(conteudo, 'latin1');
  const cabeca = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'
    + `2 0 obj\n<< /Length ${fluxo.length}${comprimir ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1');
  const rabo = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF', 'latin1');
  const b = Buffer.concat([cabeca, fluxo, rabo]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe('PDF não tem linha nem coluna — tem posição', () => {
  test('mesma altura vira a MESMA linha, na ordem do X', async () => {
    // ⚠️ Escrito FORA de ordem de propósito: o gerador põe as células na ordem
    // que quiser. Lendo na ordem do arquivo, a tabela sai embaralhada — e
    // embaralhada de um jeito plausível, que é o pior dos casos.
    const linhas = await lerPdf(pdfCom(`BT
      /F1 10 Tf
      1 0 0 1 300 700 Tm (36,88) Tj
      1 0 0 1 100 700 Tm (16/09/2026) Tj
      1 0 0 1 200 700 Tm (50,00) Tj
      1 0 0 1 100 680 Tm (17/09/2026) Tj
      1 0 0 1 200 680 Tm (20,00) Tj
    ET`));
    assert.deepEqual(linhas[0], ['16/09/2026', '50,00', '36,88']);
    assert.deepEqual(linhas[1], ['17/09/2026', '20,00']);
  });

  test('fração de ponto no Y não parte a linha em três', async () => {
    // Cada célula é posicionada por conta própria e sobra fração. Exigindo
    // igualdade, uma tabela de 20 linhas viraria 60.
    const itens = [{ x: 10, y: 700.4, texto: 'a' }, { x: 60, y: 699.8, texto: 'b' }, { x: 30, y: 680, texto: 'c' }];
    assert.deepEqual(agruparEmLinhas(itens), [['a', 'b'], ['c']]);
  });

  test('a linha de baixo vem DEPOIS: no PDF o Y cresce para cima', async () => {
    const itens = [{ x: 10, y: 100, texto: 'rodape' }, { x: 10, y: 700, texto: 'topo' }];
    assert.deepEqual(agruparEmLinhas(itens), [['topo'], ['rodape']]);
  });
});

describe('as strings do PDF', () => {
  test('parêntese ANINHADO não encerra a string', () => {
    // `(Taxa (R$))` é uma string só. Fechando no primeiro ")", o cabeçalho
    // sairia cortado — e "TAXA DE SERVICO (R" não casa com coluna nenhuma.
    assert.equal(lerStringLiteral('Taxa (R$)) Tj', 0).texto, 'Taxa (R$)');
  });

  test('escapes, inclusive o octal do acentuado', () => {
    assert.equal(lerStringLiteral('a\\(b\\)c)', 0).texto, 'a(b)c');
    assert.equal(lerStringLiteral('SERVI\\307O)', 0).texto, 'SERVIÇO');
    assert.equal(lerStringLiteral('quebra\\\ncolada)', 0).texto, 'quebracolada');
  });

  test('hexadecimal, com e sem BOM de UTF-16', () => {
    assert.equal(lerStringHex('546178>', 0).texto, 'Tax');
    assert.equal(lerStringHex('FEFF005400610078>', 0).texto, 'Tax');
    assert.equal(lerStringHex('54617>', 0).texto, 'Tap', 'ímpar: o último dígito vira 70, como manda a spec');
  });

  test('a faixa 0x80–0x9F é WinAnsi, não Latin-1', () => {
    // É exatamente onde as duas tabelas discordam — e é de lá que vem o traço
    // longo e as aspas curvas que alguns geradores usam no cabeçalho.
    assert.equal(lerStringHex('96>', 0).texto, '–');
    assert.equal(lerStringHex('E7>', 0).texto, 'ç', 'fora da faixa é Latin-1');
  });
});

describe('TJ: os pedaços são UMA palavra', () => {
  test('o espacejamento não vira coluna', async () => {
    // [(Pedi) -20 (do)] é a palavra "Pedido" partida pelo kerning. Cada pedaço
    // como célula quebraria todo cabeçalho do relatório.
    const itens = lerConteudo('BT 1 0 0 1 50 700 Tm [(Pedi) -20 (do)] TJ ET');
    assert.equal(itens.length, 1);
    assert.equal(itens[0].texto, 'Pedido');
  });
});

describe('o arquivo inteiro', () => {
  test('lê o fluxo comprimido (FlateDecode) e o solto', async () => {
    for (const comprimir of [true, false]) {
      const linhas = await lerPdf(pdfCom('BT 1 0 0 1 50 700 Tm (VALOR LIQUIDO) Tj ET', comprimir));
      assert.deepEqual(linhas, [['VALOR LIQUIDO']], comprimir ? 'comprimido' : 'solto');
    }
  });

  test('Td e T* andam na página como o gerador espera', async () => {
    const linhas = await lerPdf(pdfCom('BT /F1 10 Tf 14 TL 50 700 Td (um) Tj T* (dois) Tj T* (tres) Tj ET'));
    assert.deepEqual(linhas, [['um'], ['dois'], ['tres']]);
  });

  test('PDF sem texto nenhum devolve vazio, não meia tabela', async () => {
    // Página escaneada ou print de tela. Quem chamou avisa e manda exportar
    // em planilha — entregar meia tabela seria pior que não ler.
    assert.deepEqual(await lerPdf(pdfCom('q 100 0 0 100 50 700 cm /Im0 Do Q')), []);
  });

  test('arquivo que não é PDF não passa por leitor nenhum', async () => {
    const b = Buffer.from('isto e um txt');
    await assert.rejects(() => lerPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), /não é um PDF/);
  });
});
