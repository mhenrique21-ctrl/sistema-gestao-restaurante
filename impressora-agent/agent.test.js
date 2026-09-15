import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// SAIDA é lida na carga do módulo, então o destino tem que existir antes do
// import — daí o import dinâmico.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'captura-'));
process.env.CAPTURA_SAIDA = TMP;
// Sem segredo, o envio pro Gestão nem existe — teste não fala com a rede.
delete process.env.SEAMA_SERVICE_SECRET;
const { gravar, comandaDeTeste, destinoWindows, fontesConfiguradas, comandoCopia, conferirNomeCompartilhado,
  pedidosDoDia, hojeISO } = await import('./agent.js');
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

describe('o dia é reconstruído dos ARQUIVOS, não acumulado na memória', () => {
  // /api/venda-pdv SUBSTITUI o registro do dia. Um acumulador em memória seria
  // zerado por qualquer reinício do PC, e o POST seguinte trocaria o dia
  // inteiro pelos poucos pedidos que chegaram depois — o faturamento
  // encolheria sozinho e só apareceria no fechamento do mês.
  const grava = (nome, obj) => fs.writeFileSync(path.join(TMP, nome), JSON.stringify(obj));

  test('pega só os .json do dia pedido', () => {
    grava('2026-03-03_10-00-00-000_ifood.json', { numero: '1', pagoPeloApp: 10 });
    grava('2026-03-03_11-00-00-000_99food.json', { numero: '2', pagoPeloApp: 20 });
    grava('2026-03-04_09-00-00-000_ifood.json', { numero: '3', pagoPeloApp: 99 });
    const hoje = pedidosDoDia('2026-03-03');
    assert.deepEqual(hoje.map((p) => p.numero).sort(), ['1', '2']);
    assert.deepEqual(pedidosDoDia('2026-03-04').map((p) => p.numero), ['3']);
  });

  test('.bin e .txt do mesmo pedido não entram como pedido', () => {
    fs.writeFileSync(path.join(TMP, '2026-03-03_10-00-00-000_ifood.bin'), 'x');
    fs.writeFileSync(path.join(TMP, '2026-03-03_10-00-00-000_ifood.txt'), 'x');
    assert.equal(pedidosDoDia('2026-03-03').length, 2, 'só os .json');
  });

  test('.json corrompido não derruba o envio do dia inteiro', () => {
    // Um arquivo cortado pela metade (PC desligado no meio da gravação) não
    // pode impedir os outros pedidos do dia de subirem.
    fs.writeFileSync(path.join(TMP, '2026-03-03_12-00-00-000_ifood.json'), '{ cortad');
    assert.equal(pedidosDoDia('2026-03-03').length, 2);
  });

  test('dia sem captura nenhuma devolve vazio, não erro', () => {
    assert.deepEqual(pedidosDoDia('2026-01-01'), []);
  });

  test('a data do arquivo é a LOCAL, não a UTC', () => {
    // O Amapá é UTC−3: `toISOString()` às 21h de sexta devolveria sábado, e o
    // pedido subiria no dia errado. O nome do arquivo usa a data local, e a
    // busca tem que usar a mesma.
    assert.equal(hojeISO(new Date(2026, 8, 15, 21, 30)), '2026-09-15');
    assert.equal(hojeISO(new Date(2026, 8, 15, 0, 5)), '2026-09-15');
  });
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
