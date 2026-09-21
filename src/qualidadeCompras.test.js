import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarTexto, temEncodingQuebrado, soDigitos, cnpjValido, semelhanca, nucleoDoNome,
  acharFornecedor, mesclarFornecedores, gruposDeFornecedor,
  precoPorUnidadeBase, referenciaDePreco, conferirPreco, auditarPrecos,
  normalizarEncoding, duplicadasPorTexto,
  conciliacaoPorCategoria, pctHistoricoPorCategoria,
  garantirFornecedor, criarItemDaLista, filaSemCategoria, janelaAnterior,
  linhasDaRevisao, pendenciasDaRevisao, correcoesDaRevisao, resumoDoEncoding,
} from './qualidadeCompras.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// ── TAREFA 1 ────────────────────────────────────────────────────────────────
describe('fornecedor: o CNPJ decide, o nome sugere', () => {
  const FORNS = [
    { id: 'a', nome: 'SENDAS DISTRIBUIDORA S/A LJ190', cnpj: '06.057.223/0361-00' },
    { id: 'b', nome: 'Lider Industria e Comercio Ltda', cnpj: '' },
    { id: 'c', nome: 'Supermercado Santa Lucia', cnpj: '' },
  ];

  test('o CNPJ casa mesmo com a grafia completamente diferente', () => {
    // ⚠️ Identificador fiscal não é palpite: vence qualquer diferença de nome.
    const r = acharFornecedor(FORNS, { cnpj: '06057223036100', nome: 'ASSAI ATACADISTA' }, fold);
    assert.equal(r.fornecedor.id, 'a');
    assert.equal(r.motivo, 'cnpj');
  });

  test('o CNPJ formatado e o cru são o mesmo CNPJ', () => {
    assert.equal(soDigitos('06.057.223/0361-00'), '06057223036100');
    assert.ok(cnpjValido('06.057.223/0361-00'));
    assert.ok(!cnpjValido('11111111111111'), 'todos iguais não é CNPJ');
    assert.ok(!cnpjValido('123'), 'curto demais');
  });

  test('sem CNPJ, o nome parecido vira SUGESTÃO', () => {
    const r = acharFornecedor(FORNS, { nome: 'LIDER INDÚSTRIA E COMÉRCIO LTDA.' }, fold);
    assert.equal(r.fornecedor.id, 'b');
    assert.equal(r.motivo, 'nome');
    assert.ok(r.score >= 0.82);
  });

  test('⚠️ CNPJ DIFERENTE nos dois barra o nome parecido — são filiais', () => {
    // Duas lojas da mesma rede têm razão social quase igual e CNPJ distinto.
    // Juntá-las misturaria a compra de duas lojas num fornecedor só.
    const comOutraFilial = [...FORNS, { id: 'd', nome: 'SENDAS DISTRIBUIDORA S/A LJ190', cnpj: '06.057.223/0999-00' }];
    const r = acharFornecedor(comOutraFilial, { cnpj: '06.057.223/0361-00', nome: 'SENDAS DISTRIBUIDORA S/A LJ190' }, fold);
    assert.equal(r.fornecedor.id, 'a', 'tem que ser a filial do CNPJ buscado');
    assert.equal(r.motivo, 'cnpj');
  });

  test('o sufixo de razão social não dá semelhança de graça', () => {
    // ⚠️ Sem tirar "ltda"/"comercio", dois fornecedores sem nada em comum
    // ganhariam pontos só pelo fim do nome.
    assert.equal(nucleoDoNome('Lider Industria e Comercio Ltda', fold), 'lider');
    assert.ok(semelhanca(nucleoDoNome('LIDER LTDA', fold), nucleoDoNome('SENDAS LTDA', fold)) < 0.5);
  });

  test('a ordem das palavras não separa o mesmo fornecedor', () => {
    // Bigrama, não distância de edição: as palavras trocam de lugar na razão
    // social o tempo todo.
    assert.ok(semelhanca('santa lucia supermercado', 'supermercado santa lucia') > 0.82);
  });

  test('fornecedor que não parece com nenhum devolve null', () => {
    assert.equal(acharFornecedor(FORNS, { nome: 'Padaria do Zé' }, fold), null);
    assert.equal(acharFornecedor(FORNS, { nome: '' }, fold), null);
  });
});

describe('mesclar fornecedor reescreve o histórico', () => {
  const DB = {
    fornecedores: [
      { id: 'a', nome: 'Sendas Distribuidora', cnpj: '' },
      { id: 'b', nome: 'SENDAS DISTRIBUIDORA S/A', cnpj: '06.057.223/0361-00' },
    ],
    compras: [
      { id: 'c1', fornecedor: 'SENDAS DISTRIBUIDORA S/A', valor: 100 },
      { id: 'c2', fornecedor: 'Sendas Distribuidora', valor: 50 },
      { id: 'c3', fornecedor: 'Outro', valor: 10 },
    ],
    materiasPrimas: [
      { id: 'm1', nome: 'Arroz', fornecedores: ['SENDAS DISTRIBUIDORA S/A', 'Outro'] },
      { id: 'm2', nome: 'Feijão', fornecedores: ['Outro'] },
    ],
  };

  test('as compras do removido passam a apontar para o canônico', () => {
    // ⚠️ `compras[].fornecedor` guarda o NOME. Apagar o cadastro sem reescrever
    // deixaria o histórico apontando para um fornecedor que não existe mais.
    const r = mesclarFornecedores(DB, { canonicoId: 'a', idsRemovidos: ['b'] });
    assert.equal(r.comprasTocadas, 1);
    assert.equal(r.compras.find((c) => c.id === 'c1').fornecedor, 'Sendas Distribuidora');
    assert.equal(r.compras.find((c) => c.id === 'c3').fornecedor, 'Outro', 'não toca no que não é dele');
  });

  test('a lista de fornecedores do insumo também é reescrita, sem duplicar', () => {
    const r = mesclarFornecedores(DB, { canonicoId: 'a', idsRemovidos: ['b'] });
    assert.deepEqual(r.materiasPrimas.find((m) => m.id === 'm1').fornecedores, ['Sendas Distribuidora', 'Outro']);
    assert.equal(r.insumosTocados, 1);
  });

  test('o canônico HERDA o CNPJ de quem tinha', () => {
    // Sem isso a duplicata volta na próxima importação, porque o que sobrou
    // não tem a chave que impediria de criar de novo.
    const r = mesclarFornecedores(DB, { canonicoId: 'a', idsRemovidos: ['b'] });
    assert.equal(r.fornecedores.find((f) => f.id === 'a').cnpj, '06.057.223/0361-00');
    assert.equal(r.fornecedores.length, 1);
  });

  test('mesclar consigo mesmo, ou sem canônico, não faz nada', () => {
    assert.equal(mesclarFornecedores(DB, { canonicoId: 'a', idsRemovidos: ['a'] }), null);
    assert.equal(mesclarFornecedores(DB, { canonicoId: 'zzz', idsRemovidos: ['b'] }), null);
  });
});

describe('os grupos que a tela de administração lista', () => {
  const FORNS = [
    { id: '1', nome: 'Sendas Distribuidora', cnpj: '06057223036100' },
    { id: '2', nome: 'SENDAS DISTR S/A LJ190', cnpj: '06.057.223/0361-00' },
    { id: '3', nome: 'Supermercado Santa Lucia', cnpj: '' },
    { id: '4', nome: 'SUPERMERCADO SANTA LUCIA LTDA', cnpj: '' },
    { id: '5', nome: 'Padaria do Zé', cnpj: '' },
  ];

  test('CNPJ vem primeiro, porque é certeza', () => {
    const g = gruposDeFornecedor(FORNS, fold);
    assert.equal(g[0].motivo, 'cnpj');
    assert.deepEqual(g[0].itens.map((f) => f.id), ['1', '2']);
  });

  test('o nome parecido vira um grupo separado', () => {
    const g = gruposDeFornecedor(FORNS, fold);
    const porNome = g.find((x) => x.motivo === 'nome');
    assert.deepEqual(porNome.itens.map((f) => f.id), ['3', '4']);
  });

  test('quem não tem par não vira grupo de um', () => {
    const g = gruposDeFornecedor(FORNS, fold);
    assert.ok(!g.some((x) => x.itens.some((f) => f.id === '5')));
  });
});

// ── TAREFA 4 ────────────────────────────────────────────────────────────────
describe('preço por unidade-base', () => {
  test('g e ml viram kg e L ANTES de comparar', () => {
    // R$ 7,69 por 100 g é o mesmo preço que R$ 76,90 por kg.
    assert.deepEqual(precoPorUnidadeBase({ valorTotal: 7.69, quantidade: 100, unidade: 'g' }),
      { preco: 76.9, unidade: 'g', base: 'kg' });
    assert.deepEqual(precoPorUnidadeBase({ valorTotal: 76.9, quantidade: 1, unidade: 'kg' }),
      { preco: 76.9, unidade: 'kg', base: 'kg' });
  });

  test('unidade que não converte fica nela mesma', () => {
    assert.deepEqual(precoPorUnidadeBase({ valorTotal: 12, quantidade: 6, unidade: 'un' }),
      { preco: 2, unidade: 'un', base: 'un' });
  });

  test('quantidade zero não divide por zero', () => {
    assert.equal(precoPorUnidadeBase({ valorTotal: 10, quantidade: 0, unidade: 'kg' }), null);
  });

  test('O CASO DO ÓLEO: R$ 769,00/100 ml é pego', () => {
    // ⚠️ O erro real: 1 unidade de 900 ml lançada como "100 ml" com o valor
    // cheio. R$ 7,69/L vira R$ 769,00/L e ninguém repara, porque o campo do
    // valor está certo.
    const compras = [
      { nomeProduto: 'Óleo de soja', categoria: 'Mercearia/Secos', valor: 7.69, quantidade: 900, unidade: 'ml' },
      { nomeProduto: 'Óleo de soja', categoria: 'Mercearia/Secos', valor: 7.49, quantidade: 900, unidade: 'ml' },
      { nomeProduto: 'Óleo de soja', categoria: 'Mercearia/Secos', valor: 7.99, quantidade: 900, unidade: 'ml' },
    ];
    const r = conferirPreco(compras, { nomeProduto: 'Óleo de soja', categoria: 'Mercearia/Secos', valor: 76.9, quantidade: 100, unidade: 'ml' }, fold);
    assert.equal(r.ok, false);
    assert.equal(r.acima, true);
    assert.ok(r.razao > 90, `razão ${r.razao}`);
  });

  test('⚠️ a referência é a MEDIANA — um erro já gravado não absolve o próximo', () => {
    // Com a média, a compra errada puxaria a régua para cima e o erro seguinte
    // passaria. É a mesma lição da taxa do plano do iFood.
    const compras = [
      { nomeProduto: 'Óleo', categoria: 'X', valor: 8, quantidade: 1, unidade: 'l' },
      { nomeProduto: 'Óleo', categoria: 'X', valor: 8, quantidade: 1, unidade: 'l' },
      { nomeProduto: 'Óleo', categoria: 'X', valor: 769, quantidade: 1, unidade: 'l' },  // o erro
    ];
    const ref = referenciaDePreco(compras, { nomeProduto: 'Óleo', categoria: 'X' }, fold).mediana('l');
    assert.equal(ref.valor, 8, 'a mediana ignora o outlier; a média daria 261,67');
    const r = conferirPreco(compras, { nomeProduto: 'Óleo', categoria: 'X', valor: 700, quantidade: 1, unidade: 'l' }, fold);
    assert.equal(r.ok, false);
  });

  test('preço MUITO abaixo também é erro de unidade', () => {
    const compras = [{ nomeProduto: 'Café', categoria: 'X', valor: 40, quantidade: 1, unidade: 'kg' }];
    const r = conferirPreco(compras, { nomeProduto: 'Café', categoria: 'X', valor: 40, quantidade: 1000, unidade: 'kg' }, fold);
    assert.equal(r.ok, false);
    assert.equal(r.acima, false);
  });

  test('⚠️ SEM referência não bloqueia — travar o primeiro cadastro ensina a ignorar o aviso', () => {
    const r = conferirPreco([], { nomeProduto: 'Novidade', categoria: 'X', valor: 999, quantidade: 1, unidade: 'kg' }, fold);
    assert.equal(r.ok, true);
    assert.match(r.motivo, /primeiro preço/);
  });

  test('sem histórico do item, cai na mediana da CATEGORIA', () => {
    const compras = [
      { nomeProduto: 'Coxão mole', categoria: 'Proteínas', valor: 38, quantidade: 1, unidade: 'kg' },
      { nomeProduto: 'Patinho', categoria: 'Proteínas', valor: 42, quantidade: 1, unidade: 'kg' },
    ];
    const ref = referenciaDePreco(compras, { nomeProduto: 'Alcatra', categoria: 'Proteínas' }, fold).mediana('kg');
    assert.equal(ref.de, 'categoria');
    assert.equal(ref.valor, 40);
  });

  test('a auditoria devolve os piores primeiro', () => {
    const db = { compras: [
      { id: '1', nomeProduto: 'Óleo', categoria: 'X', valor: 8, quantidade: 1, unidade: 'l', data: '2026-09-01' },
      { id: '2', nomeProduto: 'Óleo', categoria: 'X', valor: 8, quantidade: 1, unidade: 'l', data: '2026-09-02' },
      { id: '3', nomeProduto: 'Óleo', categoria: 'X', valor: 769, quantidade: 1, unidade: 'l', data: '2026-09-03' },
      { id: '4', nomeProduto: 'Óleo', categoria: 'X', valor: 30, quantidade: 1, unidade: 'l', data: '2026-09-04' },
    ] };
    const a = auditarPrecos(db, fold);
    assert.equal(a[0].id, '3');
    assert.ok(a[0].razao > 90);
  });
});

// ── TAREFA 5 ────────────────────────────────────────────────────────────────
describe('encoding', () => {
  test('NFD e NFC viram a mesma string', () => {
    const nfd = 'proteína';   // i + acento combinante
    const nfc = 'proteína';
    assert.notEqual(nfd, nfc, 'cruas são diferentes — é esse o problema');
    assert.equal(normalizarTexto(nfd), normalizarTexto(nfc));
  });

  test('o caractere de substituição é ACHADO, nunca adivinhado', () => {
    // ⚠️ Onde o byte se perdeu não há o que recuperar; chutar a letra criaria
    // um nome novo que não casa com nada.
    assert.ok(temEncodingQuebrado('prote�na'));
    assert.equal(normalizarTexto('prote�na'), 'prote�na');
  });

  test('a migração conta o que tocou e lista o que não dá pra consertar', () => {
    const db = {
      materiasPrimas: [
        { id: '1', nome: 'proteína', categoria: 'Proteínas' },
        { id: '2', nome: 'Arroz  branco ', categoria: 'Mercearia/Secos' },
        { id: '3', nome: 'PRODU�ÃO IVAN', categoria: 'Outros' },
      ],
    };
    const r = normalizarEncoding(db);
    assert.equal(r.materiasPrimas[0].nome, 'proteína');
    assert.equal(r.materiasPrimas[1].nome, 'Arroz branco', 'espaço duplo e borda também');
    assert.equal(r.quebrados.length, 1);
    assert.equal(r.quebrados[0].id, '3');
    assert.ok(r.camposTocados >= 2);
  });

  test('db sem nada para normalizar não devolve coleção nenhuma', () => {
    const r = normalizarEncoding({ materiasPrimas: [{ id: '1', nome: 'Arroz' }] });
    assert.equal(r.materiasPrimas, undefined);
    assert.equal(r.camposTocados, 0);
  });

  test('acha o par que só é dois por causa do texto', () => {
    const d = duplicadasPorTexto(['Proteínas', 'proteínas', 'Hortifruti'], fold);
    assert.equal(d.length, 1);
    assert.equal(d[0].variantes.length, 2);
  });
});

// ── TAREFA 6 ────────────────────────────────────────────────────────────────
describe('compra × consumo estimado', () => {
  const COMPRAS = [
    { data: '2026-09-05', categoria: 'Proteínas', valor: 3000 },
    { data: '2026-09-12', categoria: 'Hortifruti', valor: 400 },
    { data: '2026-08-30', categoria: 'Proteínas', valor: 9999 },   // fora do período
  ];

  test('estima pelo percentual histórico e acusa o descompasso', () => {
    const r = conciliacaoPorCategoria({
      compras: COMPRAS, receita: 20000,
      pctPorCategoria: { 'Proteínas': 10, 'Hortifruti': 3 },
      de: '2026-09-01', ate: '2026-09-30',
    });
    const prot = r.linhas.find((l) => l.cat === 'Proteínas');
    assert.equal(prot.comprado, 3000);
    assert.equal(prot.estimado, 2000);
    assert.equal(prot.pctDif, 50);
    assert.equal(prot.alerta, true);

    const hort = r.linhas.find((l) => l.cat === 'Hortifruti');
    assert.equal(hort.estimado, 600);
    assert.equal(hort.alerta, false, 'comprou MENOS que o estimado');
  });

  test('⚠️ categoria sem percentual NÃO vira alerta — vira "sem referência"', () => {
    // Alertar sobre um número que ninguém definiu é pior que não alertar.
    const r = conciliacaoPorCategoria({
      compras: [{ data: '2026-09-05', categoria: 'Embalagens', valor: 800 }],
      receita: 20000, pctPorCategoria: {}, de: '2026-09-01', ate: '2026-09-30',
    });
    assert.equal(r.linhas[0].semReferencia, true);
    assert.equal(r.linhas[0].alerta, false);
    assert.equal(r.linhas[0].estimado, null);
  });

  test('a compra fora do período fica fora', () => {
    const r = conciliacaoPorCategoria({
      compras: COMPRAS, receita: 20000, pctPorCategoria: { 'Proteínas': 10 },
      de: '2026-09-01', ate: '2026-09-30',
    });
    assert.equal(r.totalComprado, 3400);
  });

  test('o percentual histórico sai do próprio histórico', () => {
    const r = pctHistoricoPorCategoria({
      compras: [
        { data: '2026-07-10', categoria: 'Proteínas', valor: 5000 },
        { data: '2026-08-10', categoria: 'Proteínas', valor: 5000 },
        { data: '2026-08-10', categoria: 'Hortifruti', valor: 1000 },
      ],
      vendas: [{ data: '2026-07-31', total: 50000 }, { data: '2026-08-31', total: 50000 }],
      de: '2026-07-01', ate: '2026-08-31',
    });
    assert.equal(r.receita, 100000);
    assert.equal(r.pct['Proteínas'], 10);
    assert.equal(r.pct['Hortifruti'], 1);
  });

  test('período sem receita não divide por zero', () => {
    const r = pctHistoricoPorCategoria({ compras: [], vendas: [], de: '2026-09-01', ate: '2026-09-30' });
    assert.deepEqual(r, { receita: 0, pct: {}, dias: 0 });
  });
});

describe('o ponto único por onde fornecedor entra', () => {
  let n = 0;
  const uid = () => `novo${++n}`;
  const LISTA = [{ id: 'a', nome: 'Sendas Distribuidora', cnpj: '' }];

  test('mesmo CNPJ com grafia diferente NÃO cria registro novo', () => {
    // É o critério de aceite da Tarefa 1.
    const comCnpj = [{ id: 'a', nome: 'Sendas Distribuidora', cnpj: '06057223036100' }];
    const r = garantirFornecedor(comCnpj, { nome: 'SENDAS DISTRIBUIDORA S/A LJ190', cnpj: '06.057.223/0361-00' }, fold, uid);
    assert.equal(r.criado, false);
    assert.equal(r.fornecedor.id, 'a');
    assert.equal(r.fornecedores.length, 1);
  });

  test('⚠️ grava no cadastro antigo o CNPJ que faltava', () => {
    // Sem isso a dedução por CNPJ só valeria para quem fosse cadastrado depois.
    const r = garantirFornecedor(LISTA, { nome: 'Sendas Distribuidora', cnpj: '06.057.223/0361-00' }, fold, uid);
    assert.equal(r.criado, false);
    assert.equal(r.fornecedores[0].cnpj, '06.057.223/0361-00');
  });

  test('só o sufixo de razão social diferente REAPROVEITA', () => {
    // "Frigorifico Boi Forte" e "Frigorifico Boi Forte Ltda" são a mesma
    // empresa: o núcleo dá idêntico depois de tirar o ruído, então entra como
    // exato e não cria registro novo.
    const r = garantirFornecedor([{ id: 'a', nome: 'Frigorifico Boi Forte' }], { nome: 'Frigorifico Boi Forte Ltda' }, fold, uid);
    assert.equal(r.criado, false);
    assert.equal(r.fornecedores.length, 1);
  });

  test('parecido mas NÃO igual cria, e devolve a sugestão', () => {
    // ⚠️ "Boi Forte" e "Boi Bom" medem 0,848 e são duas empresas. Juntar
    // sozinho seria decidir por palpite de nome — e o histórico das duas iria
    // junto, sem desfazer.
    const r = garantirFornecedor([{ id: 'a', nome: 'Frigorifico Boi Forte' }], { nome: 'Frigorifico Boi Bom' }, fold, uid);
    assert.equal(r.criado, true);
    assert.equal(r.fornecedores.length, 2);
    assert.equal(r.sugestao.fornecedor.id, 'a');
    assert.ok(r.sugestao.score >= 0.82 && r.sugestao.score < 1);
  });

  test('nome vazio não cria nada', () => {
    const r = garantirFornecedor(LISTA, { nome: '   ' }, fold, uid);
    assert.equal(r.criado, false);
    assert.equal(r.fornecedor, null);
    assert.equal(r.fornecedores.length, 1);
  });

  test('o item da Lista nasce CARIMBADO e já vinculado', () => {
    // Sem `atualizadoEm` o primeiro save da vida dele nasce perdendo a fusão.
    const it = criarItemDaLista({ id: 'mp1', nome: ' Arroz  branco ', categoria: 'Mercearia/Secos', unidade: 'kg' }, uid);
    assert.equal(it.nome, 'Arroz branco');
    assert.deepEqual(it.mpVinculados, ['mp1']);
    assert.ok(it.atualizadoEm);
    assert.equal(it.criadoPor, 'compra');
  });
});

describe('a fila do que entrou sem categoria', () => {
  const COMPRAS = [
    { nomeProduto: 'ÓLEO DE SOJA 900ML', categoria: 'Outros', valor: 1000, data: '2026-09-01' },
    { nomeProduto: 'oleo de soja 900ml', categoria: 'Outros', valor: 842, data: '2026-09-10' },
    { nomeProduto: 'MARMITA HAMBURGUEIRA', categoria: 'Outros', valor: 640, data: '2026-09-05' },
    { nomeProduto: 'PEITO DE PERU', categoria: 'Outros', valor: 963.4, data: '2026-09-03' },
    { nomeProduto: 'QUEIJO MUSSARELA', categoria: 'Laticínios', valor: 5000, data: '2026-09-04' },
    { nomeProduto: 'ACUCAR', categoria: 'Outros', valor: 9999, data: '2026-09-06' },
  ];
  // O palpite do App: palavra-chave, e "sem palpite" volta com origem "nenhuma".
  const palpiteDe = (nome) => {
    const n = fold(nome);
    if (n.includes('oleo') || n.includes('acucar')) return { categoria: 'Mercearia/Secos', origem: 'palpite' };
    if (n.includes('peru')) return { categoria: 'Proteínas', origem: 'palpite' };
    return { categoria: 'Outros', origem: 'nenhuma' };
  };
  // "ACUCAR" já foi ensinado: some da fila mesmo tendo compra em "Outros".
  const dicionario = { [fold('ACUCAR')]: { categoria: 'Mercearia/Secos' } };

  test('UMA linha por nome, com o dinheiro somado', () => {
    const r = filaSemCategoria(COMPRAS, { dicionario, palpiteDe, fold });
    const oleo = r.linhas.find((l) => l.nome.includes('SOJA'));
    assert.equal(oleo.compras, 2);
    assert.equal(oleo.valor, 1842);
    assert.equal(oleo.ultima, '2026-09-10');
  });

  test('a ordem padrão é o DINHEIRO PARADO, não a contagem', () => {
    // ⚠️ É a ordem que diz por onde começar: a fila só encolhe se as primeiras
    // linhas forem as que mais pesam no CMV.
    const r = filaSemCategoria(COMPRAS, { dicionario, palpiteDe, fold });
    assert.deepEqual(r.linhas.map((l) => l.nome), ['ÓLEO DE SOJA 900ML', 'PEITO DE PERU', 'MARMITA HAMBURGUEIRA']);
    assert.equal(r.totalParado, 3445.4);
    assert.equal(r.total, 3);
  });

  test('quem já foi ensinado sai da fila, e quem tem categoria nunca entrou', () => {
    const r = filaSemCategoria(COMPRAS, { dicionario, palpiteDe, fold });
    assert.ok(!r.linhas.some((l) => fold(l.nome).includes('acucar')));
    assert.ok(!r.linhas.some((l) => fold(l.nome).includes('mussarela')));
  });

  test('"Outros" com origem "nenhuma" NÃO é palpite', () => {
    // ⚠️ Tratá-lo como palpite mandaria a fila inteira de volta para "Outros"
    // num clique — que é exatamente como ela se formou.
    const r = filaSemCategoria(COMPRAS, { dicionario, palpiteDe, fold });
    const marmita = r.linhas.find((l) => l.nome.includes('MARMITA'));
    assert.equal(marmita.temPalpite, false);
    assert.equal(marmita.palpite, null);
    assert.equal(r.comPalpite, 2);
  });

  test('as outras duas ordens', () => {
    const porNome = filaSemCategoria(COMPRAS, { dicionario, palpiteDe, fold, ordem: 'nome' });
    assert.deepEqual(porNome.linhas.map((l) => l.nome), ['MARMITA HAMBURGUEIRA', 'ÓLEO DE SOJA 900ML', 'PEITO DE PERU']);
    const porCompras = filaSemCategoria(COMPRAS, { dicionario, palpiteDe, fold, ordem: 'compras' });
    assert.equal(porCompras.linhas[0].nome, 'ÓLEO DE SOJA 900ML');
  });

  test('sem compra nenhuma devolve fila vazia, não null', () => {
    const r = filaSemCategoria([], { fold, palpiteDe });
    assert.deepEqual(r.linhas, []);
    assert.equal(r.totalParado, 0);
  });
});

describe('a janela da régua', () => {
  test('termina na VÉSPERA do período', () => {
    // ⚠️ Incluindo o período, a compra exagerada entraria no próprio percentual
    // histórico e suavizaria o alerta sobre ela mesma.
    assert.deepEqual(janelaAnterior('2026-09-01', 180), { de: '2026-03-05', ate: '2026-08-31' });
  });
  test('atravessa o ano sem inventar dia', () => {
    assert.deepEqual(janelaAnterior('2026-01-01', 30), { de: '2025-12-02', ate: '2025-12-31' });
  });
  test('data inválida devolve null', () => {
    assert.equal(janelaAnterior('', 180), null);
    assert.equal(janelaAnterior('2026-09-01', 0), null);
  });
});

describe('a revisão no ato da entrada', () => {
  // 18 compras anteriores do óleo, todas por volta de R$ 8,54/L.
  const COMPRAS = Array.from({ length: 18 }, (_, i) => ({
    nomeProduto: 'ÓLEO DE SOJA', categoria: 'Mercearia/Secos',
    unidade: 'ml', quantidade: 900, valor: 7.69 + i * 0.01, data: '2026-08-01',
  }));
  const palpiteDe = (nome) => {
    const n = fold(nome);
    if (n.includes('oleo')) return { categoria: 'Mercearia/Secos', origem: 'palpite' };
    if (n.includes('peru')) return { categoria: 'Proteínas', origem: 'palpite' };
    return { categoria: 'Outros', origem: 'nenhuma' };
  };
  // O lançamento real do dono: 100 ml onde eram 900.
  const ITENS = [
    { nome: 'ÓLEO DE SOJA', categoria: 'Mercearia/Secos', unidade: 'ml', quantidade: 100, valorTotal: 76.9 },
    { nome: 'MARMITA HAMBURGUEIRA', categoria: 'Outros', unidade: 'un', quantidade: 100, valorTotal: 160 },
    { nome: 'PEITO DE PERU', categoria: '', unidade: 'kg', quantidade: 2, valorTotal: 80 },
  ];
  const linhas = () => linhasDaRevisao(ITENS, { compras: COMPRAS, fold, palpiteDe });

  test('"Outros" conta como SEM categoria', () => {
    // ⚠️ Nenhum caminho de importação deixa o campo vazio: todos caem em
    // "Outros" sozinhos. Pedir só quando está vazio é uma pergunta que nunca
    // aparece — e é assim que 864 itens foram parar lá.
    const l = linhas();
    assert.equal(l.find((x) => x.nome.includes('MARMITA')).precisaCategoria, true);
    assert.equal(l.find((x) => x.nome.includes('PERU')).precisaCategoria, true);
    assert.equal(l.find((x) => x.nome.includes('SOJA')).precisaCategoria, false);
  });

  test('o preço fora da faixa aparece com a mediana e a razão', () => {
    const oleo = linhas().find((x) => x.nome.includes('SOJA'));
    assert.equal(oleo.precoFora, true);
    assert.equal(oleo.preco.preco.preco, 769);
    assert.equal(oleo.preco.preco.base, 'l');
    assert.ok(oleo.preco.razao > 80);
    assert.equal(oleo.preco.acima, true);
  });

  test('o mesmo nome duas vezes na nota é UMA linha', () => {
    const l = linhasDaRevisao([...ITENS, { nome: 'óleo  de soja', categoria: 'Mercearia/Secos', unidade: 'ml', quantidade: 100, valorTotal: 76.9 }],
      { compras: COMPRAS, fold, palpiteDe });
    assert.equal(l.length, 3);
  });

  test('a categoria BLOQUEIA e o preço exige resposta', () => {
    const l = linhas();
    const nada = pendenciasDaRevisao(l, {}, { compras: COMPRAS, fold });
    assert.equal(nada.podeConfirmar, false);
    assert.equal(nada.faltaCategoria.length, 2);
    assert.equal(nada.precoNaoResolvido.length, 1);

    // Escolhida a categoria dos dois, só o preço segura.
    const comCat = {
      [fold('MARMITA HAMBURGUEIRA')]: { categoria: 'Descartáveis de consumo do produto' },
      [fold('PEITO DE PERU')]: { categoria: 'Proteínas' },
    };
    const so = pendenciasDaRevisao(l, comCat, { compras: COMPRAS, fold });
    assert.deepEqual(so.faltaCategoria, []);
    assert.deepEqual(so.precoNaoResolvido, [fold('ÓLEO DE SOJA')]);
  });

  test('CORRIGIR a quantidade resolve o preço sozinho — sem precisar do escape', () => {
    // 100 → 900 ml põe o preço em R$ 85,44/L… ainda 10× a mediana. Com o valor
    // certo (7,69 por 900 ml) fecha.
    const l = linhas();
    const base = {
      [fold('MARMITA HAMBURGUEIRA')]: { categoria: 'Outros' },
      [fold('PEITO DE PERU')]: { categoria: 'Proteínas' },
    };
    const meio = pendenciasDaRevisao(l, { ...base, [fold('ÓLEO DE SOJA')]: { quantidade: 900 } }, { compras: COMPRAS, fold });
    assert.deepEqual(meio.precoNaoResolvido, [fold('ÓLEO DE SOJA')]);
    const ok = pendenciasDaRevisao(l, { ...base, [fold('ÓLEO DE SOJA')]: { quantidade: 900, valorTotal: 7.69 } }, { compras: COMPRAS, fold });
    assert.equal(ok.podeConfirmar, true);
  });

  test('"Outros" ESCOLHIDO à mão passa; o que ninguém escolheu não', () => {
    // Frete e brinde existem. A diferença é ter sido decidido.
    const l = linhas();
    const r = pendenciasDaRevisao(l, {
      [fold('MARMITA HAMBURGUEIRA')]: { categoria: 'Outros' },
      [fold('PEITO DE PERU')]: { categoria: 'Proteínas' },
      [fold('ÓLEO DE SOJA')]: { precoOk: true },
    }, { compras: COMPRAS, fold });
    assert.equal(r.podeConfirmar, true);
  });

  test('o escape do preço é explícito e não some com a categoria', () => {
    const l = linhas();
    const r = pendenciasDaRevisao(l, { [fold('ÓLEO DE SOJA')]: { precoOk: true } }, { compras: COMPRAS, fold });
    assert.deepEqual(r.precoNaoResolvido, []);
    assert.equal(r.faltaCategoria.length, 2);
    assert.equal(r.podeConfirmar, false);
  });

  test('a correção REFAZ o unitário', () => {
    // ⚠️ Sem isso a compra guardaria 900 ml pelo unitário de 100, e a auditoria
    // apontaria amanhã o lançamento que a pessoa corrigiu hoje.
    const c = correcoesDaRevisao(linhas(), {
      [fold('ÓLEO DE SOJA')]: { quantidade: 900, valorTotal: 7.69 },
      [fold('PEITO DE PERU')]: { categoria: 'Proteínas' },
    });
    const oleo = c[fold('ÓLEO DE SOJA')];
    assert.equal(oleo.quantidade, 900);
    assert.equal(oleo.valorTotal, 7.69);
    assert.equal(oleo.valorUnitario, 0.01);
    assert.equal(oleo.nome, 'ÓLEO DE SOJA');
    // Só categoria: nada de unitário inventado.
    assert.deepEqual(c[fold('PEITO DE PERU')], { nome: 'PEITO DE PERU', categoria: 'Proteínas' });
  });

  test('escolha igual ao que já estava NÃO vira correção', () => {
    const c = correcoesDaRevisao(linhas(), { [fold('ÓLEO DE SOJA')]: { categoria: 'Mercearia/Secos', quantidade: 100 } });
    assert.deepEqual(c, {});
  });

  test('nada a revisar devolve lista vazia — a tela não abre', () => {
    const l = linhasDaRevisao([{ nome: 'ÓLEO DE SOJA', categoria: 'Mercearia/Secos', unidade: 'ml', quantidade: 900, valorTotal: 7.7 }],
      { compras: COMPRAS, fold, palpiteDe });
    assert.equal(l.filter((x) => x.precisaCategoria || x.precoFora).length, 0);
  });
});

describe('o resumo do encoding', () => {
  const DB = {
    compras: [
      { id: 'c1', nomeProduto: 'Protéina de soja', categoria: 'Protéinas' },
      { id: 'c2', nomeProduto: 'Peito  de peru', categoria: 'Proteínas' },
      { id: 'c3', nomeProduto: 'PRODU�ÃO IVAN', categoria: 'Outros' },
    ],
    // ⚠️ "A" + cedilha NÃO junta (não existe precomposto) — o fixture precisa de
    // um "c" + cedilha, que junta em "ç". A própria NFC tem esse detalhe.
    produtosLista: [{ id: 'p1', nome: 'Açucar', cat: 'mercearia' }],
  };

  test('conta os campos e diz de quais coleções', () => {
    const r = resumoDoEncoding(DB, fold);
    assert.ok(r.camposTocados >= 4);
    assert.ok(r.colecoes.includes('compras'));
    assert.ok(r.colecoes.includes('produtosLista'));
  });

  test('o U+FFFD é LISTADO, nunca consertado', () => {
    // ⚠️ Onde o byte se perdeu não há o que recuperar, e chutar a letra criaria
    // um nome novo que não casa com nada.
    const r = resumoDoEncoding(DB, fold);
    assert.equal(r.quebrados.length, 1);
    assert.equal(r.quebrados[0].id, 'c3');
    assert.ok(r.mudanca.compras.find((c) => c.id === 'c3').nomeProduto.includes('�'));
  });

  test('as categorias que passam a ser UMA aparecem', () => {
    // É a parte que muda RELATÓRIO, não só texto: duas grafias somam em duas
    // linhas da DRE.
    const r = resumoDoEncoding(DB, fold);
    assert.equal(r.categoriasQueJuntam.length, 1);
    assert.equal(r.categoriasQueJuntam[0].variantes.length, 2);
  });

  test('a prévia e a aplicação saem da MESMA função', () => {
    const r = resumoDoEncoding(DB, fold);
    assert.equal(r.mudanca.camposTocados, r.camposTocados);
  });
});

describe('o número que não virou número', () => {
  const COMPRAS = Array.from({ length: 5 }, () => ({
    nomeProduto: 'ÓLEO DE SOJA', categoria: 'Mercearia/Secos', unidade: 'ml', quantidade: 900, valor: 7.7, data: '2026-08-01',
  }));
  const LINHAS = linhasDaRevisao(
    [{ nome: 'ÓLEO DE SOJA', categoria: 'Mercearia/Secos', unidade: 'ml', quantidade: 100, valorTotal: 76.9 }],
    { compras: COMPRAS, fold });
  const chave = fold('ÓLEO DE SOJA');

  test('apagar o campo NÃO resolve a pendência de preço', () => {
    // ⚠️ Sem preço legível `conferirPreco` devolve ok — não há com o que
    // comparar. Sem esta trava, limpar o campo fazia o aviso sumir e a compra
    // entrar valendo zero.
    assert.equal(LINHAS[0].precoFora, true);
    const r = pendenciasDaRevisao(LINHAS, { [chave]: { quantidade: 0 } }, { compras: COMPRAS, fold });
    assert.deepEqual(r.precoNaoResolvido, [chave]);
    const r2_ = pendenciasDaRevisao(LINHAS, { [chave]: { valorTotal: 0 } }, { compras: COMPRAS, fold });
    assert.deepEqual(r2_.precoNaoResolvido, [chave]);
  });

  test('zero e NaN não viram correção', () => {
    // Gravar zero destrói o lançamento em vez de corrigi-lo.
    assert.deepEqual(correcoesDaRevisao(LINHAS, { [chave]: { quantidade: 0, valorTotal: Number('7,69') } }), {});
  });

  test('número válido continua corrigindo', () => {
    const c = correcoesDaRevisao(LINHAS, { [chave]: { quantidade: 900, valorTotal: 7.7 } });
    assert.equal(c[chave].quantidade, 900);
    assert.equal(c[chave].valorTotal, 7.7);
  });
});
