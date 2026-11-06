import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { varrer, unicoEmVoo, MAX_LOTES } from './nfeVarredura.js';

// ── Os dois lados da conversa, falsos ───────────────────────────────────────

// A SEFAZ, com a regra que travou a loja em 05/11/2026: perguntar um NSU ABAIXO do
// último que ela já entregou é consumo indevido (656). Entrega até 50 por lote e,
// quando não há mais nada depois do pedido, responde 137 (lote vazio).
function sefazFalsa({ existentes, porLote = 50, entregue = 0 }) {
  const estado = { entregue, pedidos: [] };
  const consultar = async (pedido) => {
    estado.pedidos.push(pedido);
    if (pedido < estado.entregue) throw new Error('SEFAZ limitou as consultas (cStat 656)');
    const lote = existentes.filter((n) => n > pedido).slice(0, porLote);
    if (!lote.length) return { nfes: [], ultNSU: pedido };
    estado.entregue = lote[lote.length - 1];
    return { nfes: lote.map((n) => ({ chNFe: `chave-${n}`, nsu: n })), ultNSU: estado.entregue };
  };
  return { consultar, estado };
}

// O disco: o ponteiro (nsu.json) e o cache (sefaz_cache.json), com o registro da ORDEM.
function discoFalso(ponteiro) {
  const d = {
    eventos: [], ponteiro, cache: [],
    lerPonteiro() { d.eventos.push('lerPonteiro'); return d.ponteiro; },
    guardar({ nfes }) { d.eventos.push(`guardar(${nfes.length})`); d.cache.push(...nfes); },
    gravarPonteiro(n) { d.eventos.push(`ponteiro=${n}`); d.ponteiro = n; },
  };
  return d;
}

const nsus = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);

// O comportamento ANTIGO, reproduzido: relê o ponteiro do "arquivo" a cada chamada, e o
// ramo 138 não gravava nada (o `maxNSU > nsuResp` nunca era verdadeiro).
async function varreduraAntiga({ arquivo, consultar, max = 8 }) {
  const todas = [];
  let erroParcial = null;
  for (let i = 0; i < max; i++) {
    let r;
    try { r = await consultar(arquivo.ponteiro); } catch (e) { erroParcial = e; break; }
    todas.push(...r.nfes);
    if (!r.nfes.length) break;
  }
  return { nfes: todas, erroParcial };
}

// ── O caso de 05/11, reproduzido ────────────────────────────────────────────
describe('o defeito de 05/11/2026', () => {
  test('ANTES: a 2ª pergunta repetia o NSU e a SEFAZ respondia 656', async () => {
    const { consultar, estado } = sefazFalsa({ existentes: nsus(761, 830) });
    const arquivo = { ponteiro: 760 };                       // nunca muda: o 138 não gravava
    const r = await varreduraAntiga({ arquivo, consultar });
    assert.deepEqual(estado.pedidos, [760, 760], 'perguntou o mesmo NSU duas vezes');
    assert.match(r.erroParcial.message, /656/);
    assert.equal(r.nfes.length, 50, 'só o 1º lote chegou');
    assert.equal(arquivo.ponteiro, 760, 'o ponteiro ficou onde estava, atrás da SEFAZ');
  });

  test('AGORA: a mesma SEFAZ, o mesmo atraso — varre tudo e o ponteiro chega no fim', async () => {
    const { consultar, estado } = sefazFalsa({ existentes: nsus(761, 830) });
    const disco = discoFalso(760);
    const r = await varrer({ ...disco, consultar });
    assert.deepEqual(estado.pedidos, [760, 810, 830], 'cada pergunta usa o NSU que a SEFAZ acabou de devolver');
    assert.equal(r.erroParcial, null);
    assert.equal(disco.cache.length, 70, 'as 70 notas foram guardadas');
    assert.equal(disco.ponteiro, 830);
    assert.equal(r.ultNSU, 830);
  });
});

describe('a ordem: o cache vai ANTES do ponteiro', () => {
  test('cada lote é guardado e SÓ DEPOIS o ponteiro anda', async () => {
    const { consultar } = sefazFalsa({ existentes: nsus(761, 890) });
    const disco = discoFalso(760);
    await varrer({ ...disco, consultar });
    assert.deepEqual(disco.eventos, [
      'lerPonteiro',
      'guardar(50)', 'ponteiro=810',
      'guardar(50)', 'ponteiro=860',
      'guardar(30)', 'ponteiro=890',
    ]);
  });

  test('o ponteiro é lido UMA vez, não a cada pergunta', async () => {
    // ⚠️ Relê-lo do arquivo a cada chamada era o defeito.
    const { consultar } = sefazFalsa({ existentes: nsus(761, 1000) });
    const disco = discoFalso(760);
    await varrer({ ...disco, consultar });
    assert.equal(disco.eventos.filter((e) => e === 'lerPonteiro').length, 1);
  });

  test('se NÃO conseguiu guardar, o ponteiro NÃO anda', async () => {
    // "Guardou e não andou" só repete um lote; "andou e não guardou" é a nota perdida.
    const { consultar } = sefazFalsa({ existentes: nsus(761, 830) });
    const disco = discoFalso(760);
    disco.guardar = ({ nfes }) => { disco.eventos.push(`guardar(${nfes.length})`); throw new Error('disco cheio'); };
    const r = await varrer({ ...disco, consultar });
    assert.equal(disco.ponteiro, 760, 'o ponteiro ficou onde estava');
    assert.ok(!disco.eventos.some((e) => e.startsWith('ponteiro=')), disco.eventos.join(' '));
    assert.match(r.erroParcial.message, /disco cheio/);
    assert.equal(r.nfes.length, 50, 'as notas continuam no retorno para quem chamou tentar de novo');
    assert.equal(r.ultNSU, 760);
  });

  test('se guardou mas NÃO conseguiu gravar o ponteiro, para e diz', async () => {
    const { consultar } = sefazFalsa({ existentes: nsus(761, 830) });
    const disco = discoFalso(760);
    disco.gravarPonteiro = () => { throw new Error('sem permissão'); };
    const r = await varrer({ ...disco, consultar });
    assert.match(r.erroParcial.message, /sem permissão/);
    assert.equal(r.ultNSU, 760, 'não finge que andou');
    assert.equal(disco.cache.length, 50, 'o cache do lote já estava gravado');
  });
});

describe('o ponteiro só anda para a frente', () => {
  test('resposta com ultNSU MENOR não o rebaixa — e não pergunta de novo o mesmo NSU', async () => {
    const pedidos = [];
    const consultar = async (p) => { pedidos.push(p); return { nfes: [{ chNFe: 'x', nsu: 700 }], ultNSU: 700 }; };
    const disco = discoFalso(760);
    const r = await varrer({ ...disco, consultar });
    assert.equal(disco.ponteiro, 760);
    assert.equal(r.ultNSU, 760);
    assert.equal(pedidos.length, 1, 'insistir com o mesmo NSU é o consumo indevido');
    assert.equal(disco.cache.length, 1, 'a nota que veio é guardada mesmo assim');
  });

  test('lote só de EVENTOS anda o ponteiro sem tocar no cache', async () => {
    // Eventos (a ciência que nós mesmos manifestamos, por exemplo) ocupam NSU e não
    // viram nota. Não andar por causa deles repetiria o lote para sempre.
    const consultar = async () => ({ nfes: [], ultNSU: 815 });
    const disco = discoFalso(809);
    const r = await varrer({ ...disco, consultar });
    assert.equal(disco.ponteiro, 815);
    assert.deepEqual(disco.eventos, ['lerPonteiro', 'ponteiro=815']);
    assert.equal(r.lotes, 1);
  });

  test('137 sem nada novo não grava coisa nenhuma', async () => {
    const consultar = async (p) => ({ nfes: [], ultNSU: p });
    const disco = discoFalso(819);
    const r = await varrer({ ...disco, consultar });
    assert.deepEqual(disco.eventos, ['lerPonteiro']);
    assert.equal(r.ultNSU, 819);
  });
});

describe('quando a SEFAZ recusa', () => {
  test('656 no MEIO: o que já veio está guardado e o ponteiro parou no último lote bom', async () => {
    // O caso de 27/08/2026, que perdeu notas: aqui o lote 1 já está no cache.
    let chamada = 0;
    const consultar = async () => {
      if (++chamada === 2) throw new Error('SEFAZ limitou as consultas (cStat 656)');
      return { nfes: nsus(761, 810).map((n) => ({ chNFe: `c${n}`, nsu: n })), ultNSU: 810 };
    };
    const disco = discoFalso(760);
    const r = await varrer({ ...disco, consultar });
    assert.match(r.erroParcial.message, /656/);
    assert.equal(disco.cache.length, 50);
    assert.equal(disco.ponteiro, 810);
    assert.equal(r.ultNSU, 810);
    // E o RETORNO também leva o que já veio: o botão Sincronizar mostra ao navegador exatamente
    // isto, e o erro não pode esvaziar a lista de quem acabou de receber as notas.
    assert.equal(r.nfes.length, 50);
  });

  test('656 no PRIMEIRO pedido: não grava nada e devolve o ponteiro verdadeiro, não zero', async () => {
    // ⚠️ O retorno antigo era `ultimo?.ultNSU || 0`, e o cache guardava "ultNSU: 0" — a
    // tela mostrava "NSU 0" para um ponteiro que estava em 760.
    const consultar = async () => { throw new Error('SEFAZ limitou as consultas (cStat 656)'); };
    const disco = discoFalso(760);
    const r = await varrer({ ...disco, consultar });
    assert.deepEqual(disco.eventos, ['lerPonteiro']);
    assert.equal(r.ultNSU, 760);
    assert.deepEqual(r.nfes, []);
    assert.ok(r.erroParcial);
  });

  test('ponteiro ATRASADO de verdade: não inventa — fica parado, sem perder nada', async () => {
    // Limite honesto: se alguém digitar um NSU abaixo do que a SEFAZ já entregou, o conserto
    // não adivinha o número certo. Não avança por conta própria (foi o salto de 22/10).
    const { consultar } = sefazFalsa({ existentes: nsus(761, 830), entregue: 810 });
    const disco = discoFalso(760);
    const r = await varrer({ ...disco, consultar });
    assert.match(r.erroParcial.message, /656/);
    assert.equal(disco.ponteiro, 760);
    assert.equal(r.ultNSU, 760);
  });
});

describe('o limite por varredura', () => {
  test(`para em ${MAX_LOTES} lotes e o ponteiro fica no último, para a próxima continuar`, async () => {
    const { consultar, estado } = sefazFalsa({ existentes: nsus(761, 5000) });
    const disco = discoFalso(760);
    let esperas = 0;
    const r = await varrer({ ...disco, consultar, esperar: async () => { esperas++; } });
    assert.equal(estado.pedidos.length, MAX_LOTES);
    assert.equal(r.lotes, MAX_LOTES);
    assert.equal(disco.ponteiro, 760 + 50 * MAX_LOTES);
    assert.equal(esperas, MAX_LOTES - 1, 'espera entre os lotes, não depois do último');
  });

  test('max menor é respeitado', async () => {
    const { consultar, estado } = sefazFalsa({ existentes: nsus(761, 5000) });
    await varrer({ ...discoFalso(760), consultar, max: 3 });
    assert.equal(estado.pedidos.length, 3);
  });
});

describe('uma varredura por CNPJ de cada vez', () => {
  const devagar = (ms, valor) => () => new Promise((ok) => setTimeout(() => ok(valor), ms));

  test('duas chamadas ao mesmo tempo rodam UMA vez e as duas recebem o mesmo resultado', async () => {
    // Confraria e Seama têm o mesmo CNPJ, logo o mesmo ponteiro: dois pedidos juntos
    // perguntam o MESMO NSU, e o segundo é consumo indevido garantido.
    const m = new Map();
    let rodou = 0;
    const iniciar = async () => { rodou++; return devagar(20, 'ok')(); };
    const [a, b] = await Promise.all([unicoEmVoo(m, 'cnpj', iniciar), unicoEmVoo(m, 'cnpj', iniciar)]);
    assert.equal(rodou, 1);
    assert.equal(a, 'ok');
    assert.equal(b, 'ok');
  });

  test('terminada a primeira, a seguinte roda de verdade', async () => {
    const m = new Map();
    let rodou = 0;
    const iniciar = async () => { rodou++; return rodou; };
    assert.equal(await unicoEmVoo(m, 'cnpj', iniciar), 1);
    assert.equal(await unicoEmVoo(m, 'cnpj', iniciar), 2);
    assert.equal(m.size, 0, 'não deixa lixo no mapa');
  });

  test('uma que FALHA libera a vaga', async () => {
    // Senão o primeiro 656 travaria toda varredura seguinte até reiniciar o app.
    const m = new Map();
    await assert.rejects(unicoEmVoo(m, 'cnpj', async () => { throw new Error('656'); }), /656/);
    assert.equal(m.size, 0);
    assert.equal(await unicoEmVoo(m, 'cnpj', async () => 'de novo'), 'de novo');
  });

  test('CNPJs diferentes não se bloqueiam', async () => {
    const m = new Map();
    let rodou = 0;
    const iniciar = async () => { rodou++; return devagar(10, 'x')(); };
    await Promise.all([unicoEmVoo(m, 'A', iniciar), unicoEmVoo(m, 'B', iniciar)]);
    assert.equal(rodou, 2);
  });
});

// ── A fiação no new_server.js ───────────────────────────────────────────────
// Nem o build nem o TypeScript acusam isto: é JavaScript válido fazendo a coisa errada. O
// teste lê o servidor — a mesma técnica de listaSync.test.js e authTela.test.js.
describe('a fiação no new_server.js', () => {
  const servidor = readFileSync(new URL('./new_server.js', import.meta.url), 'utf8');
  // Os testes olham CÓDIGO. Os comentários do servidor contam a história desta falha (inclusive
  // citando a linha que não funcionava), e isso não pode reprovar o teste que a trava.
  const semComentarios = (t) => t.replace(/\/\/.*$/gm, '');
  const trecho = (de, ate) => {
    const i = servidor.indexOf(de);
    assert.ok(i >= 0, `não achei "${de}" no new_server.js`);
    const j = servidor.indexOf(ate, i + de.length);
    assert.ok(j > i, `não achei "${ate}" depois de "${de}"`);
    return semComentarios(servidor.slice(i, j));
  };

  test('sefazDistDFe NÃO grava o ponteiro — quem anda é a varredura, depois de guardar', () => {
    const corpo = trecho('function sefazDistDFe(', 'const delay =');
    assert.ok(!/saveNsu\(/.test(corpo), 'saveNsu dentro de sefazDistDFe grava antes de o lote estar no cache');
  });

  test('sefazDistDFe recebe o ponteiro por parâmetro, em vez de relê-lo do arquivo a cada chamada', () => {
    const corpo = trecho('function sefazDistDFe(', 'const delay =');
    assert.match(corpo, /function sefazDistDFe\(emp, ultNSUPedido\)/);
    assert.match(corpo, /ultNSUPedido \?\?/);
  });

  test('a varredura passa por varrer() e por unicoEmVoo()', () => {
    const corpo = trecho('function sefazVarrerTudo(', 'async function sefazSync(');
    assert.match(corpo, /unicoEmVoo\(/);
    assert.match(servidor, /await varrer\(\{/);
    assert.match(servidor, /import \{[^}]*\bvarrer\b[^}]*\} from '\.\/nfeVarredura\.js'/);
  });

  test('o ponteiro só é gravado pela varredura (e pela mão do usuário)', () => {
    const chamadas = [...semComentarios(servidor).matchAll(/saveNsu\(/g)].length;
    // definição + varredura + POST /api/nsu-status + reset e NSU manual da rota de sincronizar
    assert.ok(chamadas <= 5, `saveNsu apareceu ${chamadas}× — alguém voltou a gravar o ponteiro por outro caminho`);
  });

  test('autoSync tira o retrato de "completas" ANTES da varredura', () => {
    // A varredura já guarda cada lote no cache; o retrato de DEPOIS já tem o que chegou e
    // o log de "promovidas" ficaria sempre em zero.
    const corpo = trecho('async function autoSyncSEFAZ(', 'server.listen(');
    const retrato = corpo.indexOf('const antesCompletas');
    const varredura = corpo.indexOf('await sefazSync(emp)');
    assert.ok(retrato >= 0 && varredura >= 0);
    assert.ok(retrato < varredura, 'antesCompletas é calculado depois da varredura');
  });

  test('ponteiro e cache são gravados de forma atômica (arquivo temporário + rename)', () => {
    assert.match(trecho('function gravarJsonAtomico(', 'function getNsuMap('), /renameSync/);
    for (const [de, ate] of [
      ['function saveNsu(', 'function setRateLimit('],
      ['function setRateLimit(', 'function isRateLimited('],
      ['function saveCache(', 'const MIME ='],
    ]) {
      const corpo = trecho(de, ate);
      assert.match(corpo, /gravarJsonAtomico\(/, `${de} não grava de forma atômica`);
      assert.ok(!/writeFileSync/.test(corpo), `${de} ainda usa writeFileSync direto`);
    }
  });

  test('a tela recebe o ponteiro VERDADEIRO, não o "ultNSU: 0" que o cache guardava', () => {
    const corpo = trecho("urlPath === '/api/nfe-cache') {", "urlPath === '/api/nfe-cache/remove'");
    assert.match(corpo, /nsuAtual\(emp\)/);
  });
});
