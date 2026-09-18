import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  lerXlsx, lerCsv, separadorDoCsv, numeroBr, dataDaCelula,
  colunaParaIndice, lerSharedStrings, lerSheet, listarZip,
} from './planilha.js';

const AMOSTRA = path.join(import.meta.dirname, '..', 'amostras', 'relatorio-ifood-2026-09-16.xlsx');

// ⚠️ A AMOSTRA É O RELATÓRIO REAL e ela NÃO está no repositório: enquanto ele
// for público, o faturamento pedido a pedido não entra aqui. O arquivo fica em
// `amostras/` (no .gitignore) na máquina de quem desenvolve; sem ele, os
// testes que dependem do arquivo são PULADOS em vez de falharem — teste
// vermelho por falta de um arquivo opcional ensina a ignorar teste vermelho.
const TEM_AMOSTRA = fs.existsSync(AMOSTRA);
const seTemAmostra = { skip: TEM_AMOSTRA ? false : 'amostras/relatorio-ifood-2026-09-16.xlsx não está aqui' };


describe('o .xlsx é um ZIP e o navegador sabe abrir', () => {
  test('acha as partes que interessam', seTemAmostra, () => {
    const buf = fs.readFileSync(AMOSTRA);
    const nomes = listarZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      .map((e) => e.nome);
    assert.ok(nomes.includes('xl/worksheets/sheet1.xml'));
    assert.ok(nomes.includes('xl/sharedStrings.xml'));
  });

  test('lê o relatório real de 16/09/2026', seTemAmostra, async () => {
    const buf = fs.readFileSync(AMOSTRA);
    const linhas = await lerXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.equal(linhas.length, 21, 'cabeçalho + 20 pedidos');
    assert.equal(linhas[0][0], 'ID COMPLETO DO PEDIDO');
    assert.equal(linhas[0][15], 'VALOR LIQUIDO (R$)');
    assert.equal(linhas[1][5], '9857');
    assert.equal(numeroBr(linhas[1][15]), 20.95);
  });
});

describe('a letra da coluna, não a posição', () => {
  test('converte como a planilha conta', () => {
    assert.equal(colunaParaIndice('A1'), 0);
    assert.equal(colunaParaIndice('T20'), 19);
    assert.equal(colunaParaIndice('AA1'), 26);
    assert.equal(colunaParaIndice('BC9'), 54);
  });

  test('coluna VAZIA no meio não desloca a linha', () => {
    // ⚠️ A planilha pula a célula vazia em vez de escrever uma vazia. Lendo em
    // ordem de aparição, todo valor depois do buraco andaria pra esquerda — e
    // o deslocamento é DIFERENTE em cada linha, então nem dá pra compensar.
    const linhas = lerSheet(
      '<row><c r="A1" t="s"><v>0</v></c><c r="C1"><v>7</v></c></row>', ['oi'],
    );
    assert.deepEqual(linhas[0], ['oi', '', '7']);
  });
});

describe('texto partido no meio pela formatação', () => {
  test('junta os pedaços do mesmo <si>', () => {
    // O Excel parte a string quando um trecho tem formato diferente. Pegando
    // só o primeiro <t>, o nome do produto viria pela metade.
    const s = lerSharedStrings('<sst><si><t>Coxinha </t><t>de Frango</t></si></sst>');
    assert.deepEqual(s, ['Coxinha de Frango']);
  });

  test('desescapa o & por último', () => {
    // O XML "&amp;lt;" quer dizer o TEXTO "&lt;", não o sinal "<". Trocando o
    // &amp; primeiro, o "&lt;" recém-formado seria reinterpretado e viraria
    // "<" — e um nome de produto com & sairia diferente do que está no papel.
    assert.deepEqual(lerSharedStrings('<sst><si><t>A &amp;lt; B</t></si></sst>'), ['A &lt; B']);
  });
});

describe('CSV: o separador é descoberto, não fixado', () => {
  test('exportação brasileira usa ponto e vírgula', () => {
    // ⚠️ Fixar a vírgula devolveria UMA coluna com o relatório inteiro dentro.
    assert.equal(separadorDoCsv('a;b;c\n1;2;3'), ';');
    assert.equal(separadorDoCsv('a,b,c\n1,2,3'), ',');
  });

  test('vírgula DENTRO de aspas não conta como separador', () => {
    const l = lerCsv('nome;valor\n"Coxinha, grande";"12,50"');
    assert.deepEqual(l[1], ['Coxinha, grande', '12,50']);
  });

  test('aspas dobradas viram uma aspa só', () => {
    assert.deepEqual(lerCsv('a\n"diz ""oi"""')[1], ['diz "oi"']);
  });

  test('o BOM do Excel não gruda no primeiro cabeçalho', () => {
    // Sem tirar, a primeira coluna se chamaria "﻿ID" e nenhuma busca por
    // nome de coluna acharia ela.
    assert.equal(lerCsv('﻿ID;NOME\n1;x')[0][0], 'ID');
  });
});

describe('número de planilha brasileira', () => {
  test('o ponto de MILHAR não é decimal', () => {
    // ⚠️ Trocar só a vírgula por ponto faria 1.234,56 virar 1.234 — o
    // relatório inteiro mil vezes menor, com cara de número certo.
    assert.equal(numeroBr('1.234,56'), 1234.56);
    assert.equal(numeroBr('R$ 1.234,56'), 1234.56);
    assert.equal(numeroBr('1234.56'), 1234.56);
    assert.equal(numeroBr('-7.44'), -7.44);
    assert.equal(numeroBr('(7,44)'), -7.44);
    assert.equal(numeroBr(''), 0);
    assert.equal(numeroBr('0.0'), 0);
  });
});

describe('data da célula', () => {
  test('texto brasileiro, ISO e serial do Excel', () => {
    assert.equal(dataDaCelula('16/09/2026 20:08:46'), '2026-09-16');
    assert.equal(dataDaCelula('1/9/2026'), '2026-09-01');
    assert.equal(dataDaCelula('2026-09-16T20:08:46'), '2026-09-16');
    assert.equal(dataDaCelula(46281), '2026-09-16');   // serial do Excel
    assert.equal(dataDaCelula('nada'), '');
  });
});
