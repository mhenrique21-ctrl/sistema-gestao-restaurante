import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// SAIDA é lida na carga do módulo, então o destino tem que existir antes do
// import — daí o import dinâmico.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'captura-'));
process.env.CAPTURA_SAIDA = TMP;
const { gravar, comandaDeTeste, destinoWindows } = await import('./agent.js');
const { textoDeEscPos, linhasUteis } = await import('./escpos.js');

test('a comanda de teste volta legível depois de virar bytes de impressora', () => {
  const linhas = linhasUteis(textoDeEscPos(comandaDeTeste()));
  assert.equal(linhas[0], '99FOOD - TESTE');
  assert.ok(linhas.some((l) => l.includes('Pao de Queijo') && l.includes('8,00')));
  assert.ok(linhas.some((l) => l.startsWith('TOTAL') && l.includes('20,00')));
  // Sem separador e sem o avanço de papel do fim.
  assert.ok(!linhas.some((l) => /^-+$/.test(l)));
});

test('gravar guarda o cru e o legível lado a lado', () => {
  const bytes = comandaDeTeste();
  const base = gravar(bytes, 'teste');
  assert.ok(base, 'gravar devolveu o caminho base');
  // O .bin tem que ser IDÊNTICO ao que chegou: é dele que sai uma releitura
  // quando a tabela de caracteres ou o parser mudarem.
  assert.deepEqual(fs.readFileSync(`${base}.bin`), bytes);
  assert.ok(fs.readFileSync(`${base}.txt`, 'utf8').includes('TOTAL'));
});

test('trabalho vazio não cria arquivo', () => {
  // Cliente que abre e fecha a conexão sem mandar nada (teste de porta do
  // próprio 99Food, varredura de rede) não pode virar uma comanda em branco.
  const antes = fs.readdirSync(TMP).length;
  assert.equal(gravar(Buffer.alloc(0), 'vazio'), null);
  assert.equal(fs.readdirSync(TMP).length, antes);
});

test('nome da impressora do Windows vira caminho sozinho', () => {
  // Impressora USB não tem endereço, mas compartilhada tem caminho. Aceitar as
  // três formas evita a pergunta "tenho que digitar as barras?" no config.bat.
  assert.equal(destinoWindows('TERMICA'), '\\\\localhost\\TERMICA');
  assert.equal(destinoWindows('  TERMICA  '), '\\\\localhost\\TERMICA');
  assert.equal(destinoWindows('\\\\CAIXA\\TERMICA'), '\\\\CAIXA\\TERMICA');
  // Porta paralela ainda existe em impressora antiga, e aceita a cópia direta.
  assert.equal(destinoWindows('LPT1'), 'LPT1:');
  assert.equal(destinoWindows('LPT1:'), 'LPT1:');
  // Vazio tem que continuar vazio: é o sinal de "nenhum repasse configurado",
  // e virar "\\\\localhost\\" mandaria a comanda pra lugar nenhum em silêncio.
  assert.equal(destinoWindows(''), '');
  assert.equal(destinoWindows(undefined), '');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
