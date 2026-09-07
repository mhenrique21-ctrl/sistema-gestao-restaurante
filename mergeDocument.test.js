import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeArrayById, mergeDocument } from './mergeDocument.js';

function conta(id, overrides = {}) {
  return { id, descricao: `Conta ${id}`, valor: 100, status: 'pendente', vencimento: '2026-07-20', ...overrides };
}

describe('mergeArrayById', () => {
  test('item só no existing é preservado', () => {
    const result = mergeArrayById([conta('a')], [], new Set());
    assert.deepEqual(result.map((c) => c.id), ['a']);
  });

  test('item só no incoming (recém-criado) é preservado', () => {
    const result = mergeArrayById([], [conta('b')], new Set());
    assert.deepEqual(result.map((c) => c.id), ['b']);
  });

  test('item nos dois lados: vence quem tem atualizadoEm mais recente', () => {
    const existing = [conta('a', { status: 'pago', atualizadoEm: '2026-07-20T10:00:00.000Z' })];
    const incoming = [conta('a', { status: 'pendente', atualizadoEm: '2026-07-20T09:00:00.000Z' })];
    const result = mergeArrayById(existing, incoming, new Set());
    assert.equal(result[0].status, 'pago', 'existing tinha atualizadoEm maior, devia vencer');
  });

  test('mistura updatedAt (número) e atualizadoEm (ISO string) — compara corretamente', () => {
    const existing = [conta('a', { status: 'pago', updatedAt: Date.parse('2026-07-20T10:00:00.000Z') })];
    const incoming = [conta('a', { status: 'pendente', atualizadoEm: '2026-07-20T09:00:00.000Z' })];
    const result = mergeArrayById(existing, incoming, new Set());
    assert.equal(result[0].status, 'pago');
  });

  test('sem timestamp em nenhum dos dois lados: incoming vence (comportamento anterior, sem regressão)', () => {
    const existing = [conta('a', { status: 'pago' })];
    const incoming = [conta('a', { status: 'pendente' })];
    const result = mergeArrayById(existing, incoming, new Set());
    assert.equal(result[0].status, 'pendente');
  });

  test('id em deletedIds nunca reaparece, mesmo com timestamp mais recente', () => {
    const existing = [];
    const incoming = [conta('a', { atualizadoEm: new Date().toISOString() })];
    const result = mergeArrayById(existing, incoming, new Set(['a']));
    assert.equal(result.length, 0);
  });

  test('regressão: marcar conta como paga em dois dispositivos concorrentes não se perde', () => {
    // Cenário real relatado: usuário marca conta A como paga; ao mesmo tempo
    // (ou pouco depois), outro POST baseado num snapshot mais antigo chega —
    // a marcação não pode "voltar".
    const base = [conta('a'), conta('b')];
    const deviceA = [conta('a', { status: 'pago', atualizadoEm: '2026-07-20T10:00:00.000Z' }), conta('b')];
    // deviceB nem sabe da mudança de A — seu snapshot ainda tem "a" pendente,
    // sem atualizadoEm (ex: POST de auto-save disparado por outra tela).
    const deviceB = [conta('a'), conta('b', { atualizadoEm: '2026-07-20T10:00:01.000Z' })];

    const afterA = mergeArrayById(base, deviceA, new Set());
    const afterBoth = mergeArrayById(afterA, deviceB, new Set());

    const a = afterBoth.find((c) => c.id === 'a');
    assert.equal(a.status, 'pago', 'marcação de pago não pode se perder — a tinha atualizadoEm, b (pra esse item) não');
  });

  test('regressão: poll do cliente não pode reverter uma marcação otimista local ainda não confirmada pelo servidor', () => {
    // Cenário real relatado: usuário clica "marcar como pago" (App.tsx stamps
    // atualizadoEm na hora, estado local otimista já mostra pago). Antes do
    // POST desse clique confirmar no servidor, um poll (a cada 3s fora da
    // aba Lista/Produção) busca o servidor — que ainda tem a versão antiga,
    // sem essa marcação. App.tsx agora chama
    // mergeArrayById(servidor, local, deletedIds) em vez de aceitar o
    // servidor cru — o lado que TEM o carimbo (o clique local) vence.
    const servidorAntesDoPost = [conta('x', { status: 'pendente' })];
    const localOtimista = [conta('x', { status: 'pago', atualizadoEm: new Date().toISOString() })];

    const resultadoDoPoll = mergeArrayById(servidorAntesDoPost, localOtimista, new Set());

    assert.equal(resultadoDoPoll.find((c) => c.id === 'x').status, 'pago', 'poll não pode reverter a marcação otimista que ainda não foi salva');
  });

  function venda(id, overrides = {}) {
    return { id, data: '2026-08-24', total: 100, maquininha: 0, dinheiro: 0, ...overrides };
  }

  test('regressão: venda manual e venda do PDV no mesmo dia coexistem (não são a mesma entidade)', () => {
    // Cenário real relatado: usuário digita as vendas do dia na aba
    // Lançamentos e clica "Salvar Vendas" — o valor some. Causa: a dedup por
    // data de "vendas" tratava a venda manual e a venda sincronizada do PDV
    // (origem:"pdv", resincronizada a cada minuto por delivery-backend/
    // gestaoSync) como duplicatas do mesmo dia e descartava uma das duas —
    // quase sempre a manual, porque a do PDV tem carimbo mais recente.
    const manual = venda('manual-1', { atualizadoEm: '2026-08-24T09:00:00.000Z' });
    const pdv = venda('pdv-confraria-2026-08-24', { origem: 'pdv', delivery: 50, atualizadoEm: '2026-08-24T09:05:00.000Z' });

    const result = mergeArrayById([], [manual, pdv], new Set(), true);

    assert.deepEqual(result.map((v) => v.id).sort(), ['manual-1', 'pdv-confraria-2026-08-24'], 'as duas vendas do mesmo dia devem sobreviver — são registros diferentes (manual vs pdv)');
  });

  test('vendas: duas entradas manuais pro mesmo dia (dois dispositivos) ainda deduplicam pelo mais recente', () => {
    const deviceA = venda('a', { atualizadoEm: '2026-08-24T10:00:00.000Z', maquininha: 200 });
    const deviceB = venda('b', { atualizadoEm: '2026-08-24T10:05:00.000Z', maquininha: 300 });

    const result = mergeArrayById([deviceA], [deviceB], new Set(), true);

    assert.equal(result.length, 1, 'duas entradas manuais pro mesmo dia continuam sendo tratadas como duplicata');
    assert.equal(result[0].id, 'b', 'a mais recente (deviceB) vence');
  });

  test('regressão: duplicata dentro do MESMO lado escolhe por timestamp, não pela ordem do array', () => {
    // Cenário real relatado: "os valores da Confraria ficam oscilando se eu
    // mexer em qualquer coisa" — sobra de duplicata (lixo de antes do
    // conserto de "salvar duplica") dentro do MESMO array (existing ou
    // incoming) fazia o merge escolher só o ÚLTIMO da ordem de iteração,
    // sem olhar timestamp — e como esse merge roda a cada POST/poll
    // (inclusive de telas que nem mexem em vendas), o vencedor podia trocar
    // a cada sincronização dependendo de como o array estava ordenado
    // naquele momento, oscilando o total na tela.
    const antiga = venda('frag-antiga', { atualizadoEm: '2026-08-24T09:00:00.000Z', maquininha: 3108.98 });
    const recente = venda('frag-recente', { atualizadoEm: '2026-08-24T10:00:00.000Z', delivery: 241.55 });

    // A mais recente vem PRIMEIRO no array — mesmo assim tem que vencer,
    // provando que é o timestamp que decide, não a posição.
    const resultOrdem1 = mergeArrayById([recente, antiga], [], new Set(), true);
    assert.equal(resultOrdem1.length, 1);
    assert.equal(resultOrdem1[0].id, 'frag-recente');

    // Mesmos dois itens, ordem invertida — resultado tem que ser IDÊNTICO.
    const resultOrdem2 = mergeArrayById([antiga, recente], [], new Set(), true);
    assert.equal(resultOrdem2.length, 1);
    assert.equal(resultOrdem2[0].id, 'frag-recente', 'trocar a ordem do array não pode trocar o vencedor');
  });

  test('vendas: reenvio do PDV pro mesmo dia atualiza a própria linha, sem duplicar nem afetar a manual', () => {
    const manual = venda('manual-1', { atualizadoEm: '2026-08-24T09:00:00.000Z' });
    const pdvAntigo = venda('pdv-confraria-2026-08-24', { origem: 'pdv', delivery: 30, atualizadoEm: '2026-08-24T09:05:00.000Z' });
    const pdvNovo = venda('pdv-confraria-2026-08-24', { origem: 'pdv', delivery: 80, atualizadoEm: '2026-08-24T09:10:00.000Z' });

    const result = mergeArrayById([manual, pdvAntigo], [pdvNovo], new Set(), true);

    assert.equal(result.length, 2);
    assert.equal(result.find((v) => v.id === 'manual-1').maquininha, 0, 'venda manual intacta');
    assert.equal(result.find((v) => v.origem === 'pdv').delivery, 80, 'reenvio do pdv atualiza o valor');
  });
});

describe('mergeDocument', () => {
  test('sem estado existente, devolve incoming sem alterar', () => {
    const incoming = { contas: [conta('a')] };
    const result = mergeDocument(null, incoming);
    assert.equal(result, incoming);
  });

  test('funde contas por id, preservando o que só existe em cada lado', () => {
    const existing = { contas: [conta('a')], deletedIds: [] };
    const incoming = { contas: [conta('b')], deletedIds: [] };
    const result = mergeDocument(existing, incoming);
    assert.deepEqual(result.contas.map((c) => c.id).sort(), ['a', 'b']);
  });

  test('deletedIds é a união dos dois lados e some qualquer entidade correspondente', () => {
    const existing = { contas: [conta('a')], vendas: [{ id: 'v1' }], deletedIds: ['a'] };
    const incoming = { contas: [conta('a', { atualizadoEm: new Date().toISOString() })], vendas: [{ id: 'v1' }], deletedIds: [] };
    const result = mergeDocument(existing, incoming);
    assert.equal(result.contas.length, 0, 'conta excluída não pode reaparecer mesmo com atualizadoEm novo');
    assert.deepEqual(result.deletedIds, ['a']);
  });

  test('config: incoming vence campo a campo, sem apagar o que o outro salvou', () => {
    // Antes o config inteiro vinha do incoming, então trocar a alíquota num
    // aparelho apagava o timbre que outro tinha acabado de salvar.
    const existing = { config: { snAliquota: 6, impressao: { cnpj: '12.345.678/0001-90' } } };
    const incoming = { config: { snAliquota: 8 } };
    const result = mergeDocument(existing, incoming);
    assert.equal(result.config.snAliquota, 8, 'quem postou por último vence no campo que mexeu');
    assert.equal(result.config.impressao.cnpj, '12.345.678/0001-90', 'timbre do outro aparelho não pode sumir');
  });

  test('desconectar todos: o carimbo mais recente vence, venha de que lado vier', () => {
    // Se o incoming vencesse por ser incoming, um aparelho postando sua cópia
    // anterior desfaria a ordem de desconexão e todo mundo seguiria logado.
    const ordemNova = mergeDocument(
      { config: { sessoesValidasApos: 2000 } },
      { config: { sessoesValidasApos: 1000 } },   // aparelho com a cópia velha
    );
    assert.equal(ordemNova.config.sessoesValidasApos, 2000, 'carimbo antigo não pode desfazer o novo');

    const admin = mergeDocument(
      { config: { sessoesValidasApos: 1000 } },
      { config: { sessoesValidasApos: 3000 } },   // admin acabou de clicar
    );
    assert.equal(admin.config.sessoesValidasApos, 3000);
  });

  test('config sem sub-objetos não ganha impressao/sortPrefs vazios', () => {
    const result = mergeDocument({ config: { snAliquota: 6 } }, { config: { snAliquota: 8 } });
    assert.deepEqual(result.config, { snAliquota: 8 });
  });

  test('listaCompras continua sendo resolvido pela lógica própria (mergeListaCompras), não pela genérica', () => {
    const existing = { listaAtualId: 'nova', listaAtualAbertaEm: '2026-01-02T00:00:00.000Z', listaCompras: [] };
    const incoming = { listaAtualId: 'antiga', listaAtualAbertaEm: '2026-01-01T00:00:00.000Z', listaCompras: [{ id: 'x', updatedAt: 1 }] };
    const result = mergeDocument(existing, incoming);
    assert.equal(result.listaAtualId, 'nova', 'identidade da lista mais recente devia vencer, como testado em mergeListaCompras.test.js');
  });

  test('regressão completa: conta marcada como paga sobrevive a um POST concorrente baseado em snapshot antigo', () => {
    const base = { contas: [conta('a'), conta('b')], deletedIds: [] };
    const payloadMarcarPaga = { ...base, contas: [conta('a', { status: 'pago', atualizadoEm: '2026-07-20T10:00:00.000Z' }), conta('b')] };
    // Outro dispositivo, no mesmo instante, salva uma edição em "b" sem saber
    // que "a" acabou de ser marcada como paga em outro lugar.
    const payloadConcorrente = { ...base, contas: [conta('a'), conta('b', { valor: 200, atualizadoEm: '2026-07-20T10:00:01.000Z' })] };

    const afterPagar = mergeDocument(base, payloadMarcarPaga);
    const final = mergeDocument(afterPagar, payloadConcorrente);

    const a = final.contas.find((c) => c.id === 'a');
    const b = final.contas.find((c) => c.id === 'b');
    assert.equal(a.status, 'pago', 'conta marcada como paga não pode voltar a pendente');
    assert.equal(b.valor, 200, 'edição concorrente em outro registro também não pode se perder');
  });

  test('regressão: edição de produto do catálogo (produtosLista) sobrevive a um poll concorrente', () => {
    // Cenário relatado: editar "Biscoito maisena" (categoria/rua) e a edição
    // não ficava salva — um POST concorrente sem o carimbo revertia o campo.
    const produto = (over = {}) => ({ id: 'prod-1', nome: 'Biscoito maisena', cat: 'Mercearia', unidade: 'un', rua: '', ...over });
    const base = { produtosLista: [produto()], deletedIds: [] };
    const payloadEdicao = { ...base, produtosLista: [produto({ rua: 'Rua 3', atualizadoEm: '2026-07-22T10:00:00.000Z' })] };
    const payloadConcorrente = { ...base, produtosLista: [produto()] };

    const afterEdicao = mergeDocument(base, payloadEdicao);
    const final = mergeDocument(afterEdicao, payloadConcorrente);

    assert.equal(final.produtosLista.find((p) => p.id === 'prod-1').rua, 'Rua 3', 'edição carimbada não pode ser revertida por um POST sem carimbo');
  });

  test('dicionarioClassificacao: aparelho com bundle antigo não apaga o que já foi ensinado', () => {
    // O documento mesclado nasce do incoming; sem tratamento explícito, um
    // POST vindo de uma aba que não conhece o campo o removeria do servidor.
    const noServidor = { dicionarioClassificacao: { 'queijo mussarela': { categoria: 'Laticínios', origemAprendizado: 'usuario' } } };
    const postAntigo = { vendas: [] };  // bundle velho: nem sabe que o campo existe

    const final = mergeDocument(noServidor, postAntigo);
    assert.deepEqual(final.dicionarioClassificacao['queijo mussarela'].categoria, 'Laticínios');
  });

  test('dicionarioClassificacao: reclassificação nova vence a antiga', () => {
    const noServidor = { dicionarioClassificacao: { 'polpa acai': { categoria: 'Outros' } } };
    const incoming = { dicionarioClassificacao: { 'polpa acai': { categoria: 'Mercearia/Secos' } } };

    const final = mergeDocument(noServidor, incoming);
    assert.equal(final.dicionarioClassificacao['polpa acai'].categoria, 'Mercearia/Secos');
  });

  test('budgetCompras: categorias orçadas em aparelhos diferentes no mesmo período coexistem', () => {
    // União rasa perderia uma das duas — o período inteiro do incoming
    // sobrescreveria o do existing.
    const noServidor = { budgetCompras: { '2026-09': { categorias: { 'Proteínas': { orcado: 10000, ajustadoManualmente: true } } } } };
    const incoming = { budgetCompras: { '2026-09': { categorias: { 'Hortifruti': { orcado: 3000, ajustadoManualmente: true } } } } };

    const final = mergeDocument(noServidor, incoming);
    assert.equal(final.budgetCompras['2026-09'].categorias['Proteínas'].orcado, 10000, 'orçamento do outro aparelho não pode sumir');
    assert.equal(final.budgetCompras['2026-09'].categorias['Hortifruti'].orcado, 3000);
  });

  test('categoria do Financeiro excluída não ressuscita pelo POST de outro aparelho', () => {
    // "apago e ela volta": o outro aparelho ainda tem a categoria na lista e a
    // reenvia; como o documento mesclado nasce do incoming, sem o tombstone
    // ela voltava pra todo mundo.
    const noServidor = { categorias: [{ nome: 'Gás' }, { nome: 'Aluguel' }], categoriasDeleted: ['Gás'] };
    const postDoOutroAparelho = { categorias: [{ nome: 'Gás' }, { nome: 'Aluguel' }] };

    const final = mergeDocument(noServidor, postDoOutroAparelho);
    const nomes = final.categorias.map((c) => c.nome);
    assert.ok(!nomes.includes('Gás'), 'categoria excluída não pode voltar');
    assert.ok(nomes.includes('Aluguel'), 'as outras continuam');
  });

  test('recriar categoria com nome de uma excluída antes funciona', () => {
    // criarCategoriaFin tira o nome do tombstone; sem isso a categoria recém
    // criada sumiria sozinha na fusão seguinte.
    const noServidor = { categorias: [], categoriasDeleted: ['Gás'] };
    const postRecriando = { categorias: [{ nome: 'Gás' }], categoriasDeleted: [] };

    const final = mergeDocument(noServidor, postRecriando);
    assert.ok(final.categorias.map((c) => c.nome).includes('Gás'), 'recriada não pode ser apagada pelo tombstone antigo');
  });

  test('mapas: cada aparelho classificando coisa diferente não apaga o do outro', () => {
    // Substituir o mapa inteiro (comportamento antigo de campo sem fusão) faria
    // o último POST vencer e a classificação do outro sumir.
    const noServidor = { iconesProducao: { BOLOS: '🎂' }, giroInsumo: { 'file de frango': 'perecivel' } };
    const incoming = { iconesProducao: { TORTAS: '🥧' }, giroInsumo: { arroz: 'seco' } };
    const f = mergeDocument(noServidor, incoming);
    assert.deepEqual(f.iconesProducao, { BOLOS: '🎂', TORTAS: '🥧' });
    assert.deepEqual(f.giroInsumo, { 'file de frango': 'perecivel', arroz: 'seco' });
  });

  test('listaCategorias: cadastro num aparelho sobrevive ao POST do outro', () => {
    // O cenário do sintoma relatado: cadastro some sozinho porque o outro
    // aparelho posta a lista dele, sem a categoria recém-criada.
    const noServidor = { listaCategorias: ['polpas', 'farinhas'] };
    const postDoOutro = { listaCategorias: ['polpas'] };
    const f = mergeDocument(noServidor, postDoOutro);
    assert.ok(f.listaCategorias.includes('farinhas'), 'categoria criada no outro aparelho não pode sumir');
    assert.ok(f.listaCategorias.includes('polpas'));
  });

  test('listaCategorias: exclusão não ressuscita, mas recriar funciona', () => {
    const excluida = mergeDocument(
      { listaCategorias: ['polpas', 'farinhas'], listaCatDeleted: ['farinhas'] },
      { listaCategorias: ['polpas', 'farinhas'] },          // aparelho desatualizado
    );
    assert.ok(!excluida.listaCategorias.includes('farinhas'), 'excluída não pode voltar');

    const recriada = mergeDocument(
      { listaCategorias: ['polpas'], listaCatDeleted: ['farinhas'] },
      { listaCategorias: ['polpas', 'farinhas'], listaCatDeleted: [] },  // recriou de fato
    );
    assert.ok(recriada.listaCategorias.includes('farinhas'), 'recriada não pode ser apagada pelo tombstone antigo');
  });

  test('categoriasProducao: mesma regra de tombstone da Lista', () => {
    const f = mergeDocument(
      { categoriasProducao: ['BOLOS', 'TORTAS'], categoriasProducaoDeleted: ['TORTAS'] },
      { categoriasProducao: ['BOLOS', 'TORTAS'] },
    );
    assert.deepEqual(f.categoriasProducao, ['BOLOS']);
  });

  test('listaCatOrdem: incoming vence inteiro — ordem não se une', () => {
    // Unir duas ordens produziria uma terceira que não é a de ninguém.
    const f = mergeDocument({ listaCatOrdem: ['a', 'b', 'c'] }, { listaCatOrdem: ['c', 'a', 'b'] });
    assert.deepEqual(f.listaCatOrdem, ['c', 'a', 'b']);
  });

  test('recibosEntrega: dois aparelhos emitindo recibo, nenhum se perde', () => {
    const f = mergeDocument(
      { recibosEntrega: [{ id: 'r1', cliente: 'Padaria A' }] },
      { recibosEntrega: [{ id: 'r2', cliente: 'Padaria B' }] },
    );
    assert.equal(f.recibosEntrega.length, 2);
  });

  test('budgetCompras: voltar pra sugestão marca em vez de apagar, e a marcação vence', () => {
    // Apagar a chave faria o valor manual ressuscitar na fusão seguinte,
    // porque nenhuma das duas pontas tem lista de removidos pra este campo.
    const noServidor = { budgetCompras: { '2026-09': { categorias: { 'Laticínios': { orcado: 8000, ajustadoManualmente: true } } } } };
    const incoming = { budgetCompras: { '2026-09': { categorias: { 'Laticínios': { orcado: 8000, ajustadoManualmente: false } } } } };

    const final = mergeDocument(noServidor, incoming);
    assert.equal(final.budgetCompras['2026-09'].categorias['Laticínios'].ajustadoManualmente, false);
  });
});
