import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// SAIDA é lida na carga do módulo, então o destino tem que existir antes do
// import — daí o import dinâmico.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'captura-'));
process.env.CAPTURA_SAIDA = TMP;
const { gravar, comandaDeTeste, destinoWindows, fontesConfiguradas, comandoCopia, conferirNomeCompartilhado } = await import('./agent.js');
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

test('a origem entra no NOME do arquivo, não só no log', () => {
  // Semanas depois ninguém vai ler o log: vai procurar a comanda na pasta.
  const base = gravar(comandaDeTeste('ifood'), 'teste', 'ifood');
  assert.ok(path.basename(base).endsWith('_ifood'), `esperava sufixo _ifood em ${base}`);
  assert.ok(fs.existsSync(`${base}.bin`));
});

test('a COMANDA vence o rótulo da pasta quando os dois discordam', () => {
  // Pasta trocada na instalação é erro silencioso; seguir o rótulo mandaria o
  // pedido pro canal errado de Vendas, com outra taxa.
  const base = gravar(comandaDeTeste('ifood'), 'teste', '99food');
  assert.ok(path.basename(base).endsWith('_ifood'), `esperava _ifood em ${base}`);
});

test('as duas plataformas podem ser capturadas ao mesmo tempo', () => {
  const antes = { ...process.env };
  process.env.CAPTURA_PASTA_99 = 'C:\\Comandas99';
  process.env.CAPTURA_PASTA_IFOOD = 'C:\\ComandasIfood';
  const fontes = fontesConfiguradas();
  assert.deepEqual(fontes.map((f) => f.plataforma), ['99food', 'ifood']);
  assert.ok(fontes.every((f) => f.tipo === 'pasta'));
  // ⚠️ Pastas SEPARADAS: a porta do Windows grava sempre no mesmo nome, então
  // uma pasta só para os dois faria dois pedidos quase juntos se
  // sobrescreverem — e a cozinha perderia uma comanda.
  assert.notEqual(fontes[0].pasta, fontes[1].pasta);
  process.env = antes;
});

test('quem já instalou o agente antigo continua capturando sem reconfigurar', () => {
  const antes = { ...process.env };
  delete process.env.CAPTURA_PASTA_99;
  delete process.env.CAPTURA_PASTA_IFOOD;
  delete process.env.CAPTURA_PORTA_99;
  delete process.env.CAPTURA_PORTA_IFOOD;
  const fontes = fontesConfiguradas();
  assert.equal(fontes.length, 1);
  assert.equal(fontes[0].plataforma, '', 'sem rótulo a origem sai do texto da comanda');
  process.env = antes;
});

test('um aplicativo por pasta e o outro por IP convivem', () => {
  const antes = { ...process.env };
  process.env.CAPTURA_PASTA_99 = 'C:\\Comandas99';
  process.env.CAPTURA_PORTA_IFOOD = '9101';
  delete process.env.CAPTURA_PASTA_IFOOD;
  const fontes = fontesConfiguradas();
  assert.deepEqual(fontes.map((f) => [f.plataforma, f.tipo]), [['99food', 'pasta'], ['ifood', 'rede']]);
  process.env = antes;
});

test('nome de impressora COM ESPAÇO chega inteiro no copy', () => {
  // As impressoras desta loja se chamam "EPSON COZINHA", "EPSON BALCAO",
  // "ELGIN i8" — espaço é o normal, não a exceção. Sem aspas, o `copy` lê
  // "EPSON" como destino e "COZINHA" como um segundo arquivo de origem, e o
  // erro só aparece na hora do pedido, com a cozinha esperando papel.
  const cmd = comandoCopia('C:\\impressora-agent\\capturas\\x.bin', destinoWindows('EPSON COZINHA'));
  assert.equal(cmd, 'copy /b "C:\\impressora-agent\\capturas\\x.bin" "\\\\localhost\\EPSON COZINHA"');
  // Tem que COMEÇAR por `copy`: com `cmd /c`, linha que começa com aspas cai
  // na regra de remoção de aspas do cmd e se desmonta.
  assert.ok(cmd.startsWith('copy '), 'a linha não pode começar com aspas');
  // E o /b continua lá: sem ele o 0x1A do ESC/POS vira fim de arquivo.
  assert.ok(cmd.includes(' /b '));
});

describe('o nome da impressora é conferido na SUBIDA, não na primeira comanda', () => {
  // Numa instalação real o config ficou com o nome de exemplo (TERMICA)
  // enquanto a impressora se chamava ELGIN i8. O agente subiu anunciando
  // "repassando para \\localhost\TERMICA" e só falhou quando a comanda chegou.
  const DA_LOJA = ['VIRTUAL', 'EPSON COZINHA', 'EPSON BALCAO', 'ELGIN i8'];

  test('nome que existe passa', () => {
    assert.equal(conferirNomeCompartilhado('ELGIN i8', DA_LOJA).ok, true);
  });

  test('maiúscula não reprova — o Windows não diferencia', () => {
    assert.equal(conferirNomeCompartilhado('elgin i8', DA_LOJA).ok, true);
  });

  test('o nome de exemplo é reprovado, com a lista do que existe', () => {
    const r = conferirNomeCompartilhado('TERMICA', DA_LOJA);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'ausente');
    assert.deepEqual(r.candidatos, DA_LOJA, 'a tela precisa dizer quais existem');
  });

  test('espaço a menos vira sugestão do nome certo, não uma lista', () => {
    // "ELGINi8" é erro de digitação, não impressora errada — dizer QUAL é o
    // nome poupa uma ida ao impressoras.bat.
    const r = conferirNomeCompartilhado('ELGINi8', DA_LOJA);
    assert.equal(r.motivo, 'quase');
    assert.deepEqual(r.candidatos, ['ELGIN i8']);
  });

  test('sem conseguir listar, não acusa nada', () => {
    // PowerShell bloqueado não pode virar um alarme falso a cada subida.
    assert.equal(conferirNomeCompartilhado('ELGIN i8', []).ok, true);
  });

  test('nome vazio é reprovado', () => {
    assert.equal(conferirNomeCompartilhado('   ', DA_LOJA).ok, false);
  });
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
