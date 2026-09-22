import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATS_LISTA, categoriaFechada, classificarRua, novoLocal, locaisAtivos,
  localPorId, planoDeMigracao, contabilDaLista, migrarCorredoresParaLocal,
} from './listaCompras.js';

describe('a taxonomia fechada da Lista', () => {
  test('as 19 antigas caem nas 10 novas', () => {
    // ⚠️ "carnes" e "proteína" eram a mesma coisa em dois lugares; "grãos",
    // "farinhas", "massas", "molhos" e "temperos" são todas a mercearia.
    assert.equal(categoriaFechada('carnes'), 'Açougue e frios');
    assert.equal(categoriaFechada('proteína'), 'Açougue e frios');
    assert.equal(categoriaFechada('grãos'), 'Mercearia');
    assert.equal(categoriaFechada('latas, caixas e temperos'), 'Mercearia');
    assert.equal(categoriaFechada('chocolates'), 'Doces e sobremesas');
    assert.equal(categoriaFechada('embalagens'), 'Descartáveis e embalagens');
    assert.equal(categoriaFechada('material de limpeza'), 'Limpeza e higiene');
  });

  test('a categoria CONTÁBIL que Compras injeta também é traduzida', () => {
    // ⚠️ Desde a Fase 1 `criarItemDaLista` grava a categoria contábil no campo
    // da Lista. Sem esta tradução, todo insumo auto-criado cairia em "Outros" e
    // a fila de revisão nasceria cheia do que o sistema já sabia classificar.
    assert.equal(categoriaFechada('Proteínas'), 'Açougue e frios');
    assert.equal(categoriaFechada('Mercearia/Secos'), 'Mercearia');
    assert.equal(categoriaFechada('Descartáveis de consumo do produto'), 'Descartáveis e embalagens');
    assert.equal(categoriaFechada('Bebidas para revenda'), 'Bebidas');
  });

  test('a própria taxonomia nova é aceita, com ou sem acento', () => {
    for (const c of CATS_LISTA) assert.equal(categoriaFechada(c), c);
    assert.equal(categoriaFechada('acougue e frios'), 'Açougue e frios');
    assert.equal(categoriaFechada('  LATICINIOS  '), 'Laticínios');
  });

  test('o que não casa devolve NULL — nunca "Outros" por chute', () => {
    // ⚠️ Chutar esconderia o trabalho: o que não casa é exatamente o nome de
    // loja e o produto que viraram categoria.
    assert.equal(categoriaFechada('queijo minas'), null);
    assert.equal(categoriaFechada('cia do sorveteiro'), null);
    assert.equal(categoriaFechada('bombom'), null);
    assert.equal(categoriaFechada(''), null);
    assert.equal(categoriaFechada(null), null);
  });

  test('são DEZ, e "Outros" é a última', () => {
    assert.equal(CATS_LISTA.length, 10);
    assert.equal(CATS_LISTA[CATS_LISTA.length - 1], 'Outros');
    // A ordem é a do corredor: hortifruti primeiro, limpeza no fim.
    assert.equal(CATS_LISTA[0], 'Hortifruti');
  });
});

describe('"Rua 7" é corredor; "Santa Lucia" é loja', () => {
  test('o número é o que separa os dois', () => {
    for (const v of ['Rua 7', 'rua 7', 'RUA 7', '7', 'Corredor 7', 'corr 7', 'Rua nº 7', 'rua n 7']) {
      const r = classificarRua(v);
      assert.equal(r.tipo, 'corredor', `deveria ser corredor: ${v}`);
      assert.equal(r.numero, '7');
    }
  });

  test('o corredor NÃO sabe de qual loja é — e diz isso', () => {
    // ⚠️ "Rua 7" existe no Açaí e no Sendas. Adivinhar mandaria o item para a
    // loja errada, e a lista sairia impossível de seguir sem ninguém entender.
    assert.equal(classificarRua('Rua 7').precisaLocal, true);
  });

  test('nome de loja vira local', () => {
    for (const v of ['Santa Lucia', 'Sendas Distribuidora', 'Açaí', 'Queijo Minas', 'Cia do Sorveteiro']) {
      const r = classificarRua(v);
      assert.equal(r.tipo, 'local');
      assert.equal(r.nome, v);
    }
  });

  test('nome que TEM número não vira corredor', () => {
    // "Supermercado 3 Irmãos" é loja, não corredor.
    assert.equal(classificarRua('Supermercado 3 Irmãos').tipo, 'local');
    assert.equal(classificarRua('Rua 7 do Sendas').tipo, 'local');
  });

  test('vazio é vazio', () => {
    assert.equal(classificarRua('').tipo, 'vazio');
    assert.equal(classificarRua(null).tipo, 'vazio');
    assert.equal(classificarRua('   ').tipo, 'vazio');
  });
});

describe('os locais de compra', () => {
  test('inativar, nunca excluir', () => {
    // ⚠️ Item antigo aponta pelo id: apagando o cadastro, a lista arquivada
    // deixa de dizer onde aquilo foi comprado.
    const locais = [
      novoLocal({ id: 'l1', nome: 'Açaí', temCorredor: true, corredores: ['1', '2', '7'] }),
      novoLocal({ id: 'l2', nome: 'Santa Lucia', ativo: false }),
    ];
    assert.equal(locaisAtivos(locais).length, 1);
    // Mas ainda se acha pelo id, que é o que o histórico usa.
    assert.equal(localPorId(locais, 'l2').nome, 'Santa Lucia');
  });

  test('o cadastro limpa o que veio torto', () => {
    const l = novoLocal({ id: 'x', nome: '  Sendas  ', corredores: [' 3 ', '', '  '] });
    assert.equal(l.nome, 'Sendas');
    assert.deepEqual(l.corredores, ['3']);
    assert.equal(l.temCorredor, false);
    assert.ok(l.atualizadoEm);
  });
});

describe('o plano de migração', () => {
  const DADOS = {
    listaCompras: [
      { id: 'i1', nome: 'Coxão mole', categoria: 'carnes', rua: 'Rua 7' },
      { id: 'i2', nome: 'Queijo', categoria: 'queijo minas', rua: 'Queijo Minas' },
      { id: 'i3', nome: 'Sorvete', categoria: 'cia do sorveteiro', rua: 'Cia do Sorveteiro' },
      { id: 'i4', nome: 'Bombom', categoria: 'bombom', rua: '' },
      { id: 'i5', nome: 'Detergente', categoria: 'material de limpeza', rua: 'Santa Lucia' },
    ],
    produtosLista: [{ id: 'p1', nome: 'Alcatra', cat: 'Proteínas', rua: 'Rua 7' }],
    listaRuas: ['Rua 7', 'Santa Lucia', 'Sendas Distribuidora'],
    listaCategorias: ['queijo minas', 'bombom'],
  };

  test('separa corredor de loja, e conta quantos itens dependem de cada', () => {
    const p = planoDeMigracao(DADOS);
    assert.deepEqual(p.corredores.map((c) => c.numero), ['7']);
    assert.equal(p.corredores[0].itens, 2);
    assert.deepEqual(p.locais.map((l) => l.valor).sort(),
      ['Cia do Sorveteiro', 'Queijo Minas', 'Santa Lucia', 'Sendas Distribuidora']);
    // Loja que existe só na lista de ruas, sem item nenhum, aparece com zero.
    assert.equal(p.locais.find((l) => l.valor === 'Sendas Distribuidora').itens, 0);
  });

  test('a categoria que o sistema reconhece já vem com destino', () => {
    const p = planoDeMigracao(DADOS);
    const m = Object.fromEntries(p.categoriasOk.map((c) => [c.valor, c.alvo]));
    assert.equal(m['carnes'], 'Açougue e frios');
    assert.equal(m['material de limpeza'], 'Limpeza e higiene');
    assert.equal(m['Proteínas'], 'Açougue e frios');
  });

  test('o que não é categoria vira PERGUNTA, com o motivo escrito', () => {
    // ⚠️ "cia do sorveteiro" é loja; "bombom" é produto. Os dois só têm em comum
    // não serem categoria — e nada aqui decide qual é qual.
    const p = planoDeMigracao(DADOS);
    const pend = Object.fromEntries(p.categoriasPendentes.map((c) => [c.valor, c]));
    assert.equal(pend['queijo minas'].pareceLocal, true);
    assert.equal(pend['cia do sorveteiro'].pareceLocal, true);
    // "bombom" nunca foi rua: não parece local, e continua sendo pergunta.
    assert.equal(pend['bombom'].pareceLocal, false);
    assert.equal(Object.keys(pend).length, 3);
  });

  test('a fila é ordenada pelo que mais pesa', () => {
    const p = planoDeMigracao({
      listaCompras: [
        { nome: 'a', categoria: 'xis' }, { nome: 'b', categoria: 'xis' }, { nome: 'c', categoria: 'zzz' },
      ],
    });
    assert.deepEqual(p.categoriasPendentes.map((c) => c.valor), ['xis', 'zzz']);
  });

  test('base vazia não quebra', () => {
    const p = planoDeMigracao({});
    assert.deepEqual(p.locais, []);
    assert.deepEqual(p.corredores, []);
    assert.equal(p.totalItens, 0);
  });
});

describe('a ponte da Lista para Compras', () => {
  test('cada categoria da Lista vira uma categoria CONTÁBIL válida', () => {
    // ⚠️ As duas medem coisas diferentes (§5). Mandar "Açougue e frios" direto
    // para o campo de Compras criaria uma categoria contábil nova — a mesma
    // poluição que esta fase limpou, do outro lado.
    const CONTABEIS = ['Proteínas', 'Hortifruti', 'Laticínios', 'Mercearia/Secos',
      'Bebidas para revenda', 'Descartáveis de consumo do produto',
      'Material de limpeza e higiene', 'Outros'];
    for (const c of CATS_LISTA) {
      assert.ok(CONTABEIS.includes(contabilDaLista(c)), `${c} → ${contabilDaLista(c)} não é contábil`);
    }
  });

  test('doce e café caem em Mercearia/Secos — não existe linha de CMV para doce', () => {
    assert.equal(contabilDaLista('Doces e sobremesas'), 'Mercearia/Secos');
    assert.equal(contabilDaLista('Café e complementos'), 'Mercearia/Secos');
    assert.equal(contabilDaLista('Açougue e frios'), 'Proteínas');
    assert.equal(contabilDaLista('Limpeza e higiene'), 'Material de limpeza e higiene');
  });

  test('sem categoria vira "Outros", que é o que a revisão de entrada cobra', () => {
    // O item chega no carrinho pedindo decisão, em vez de entrar calado numa
    // categoria que ninguém escolheu.
    assert.equal(contabilDaLista(null), 'Outros');
    assert.equal(contabilDaLista(''), 'Outros');
    assert.equal(contabilDaLista('categoria que não existe'), 'Outros');
  });
});

describe('a migração dos corredores para um local só', () => {
  const base = () => ({
    listaCompras: [
      { id: 'a', nome: 'arroz', rua: 'Rua 7' },
      { id: 'b', nome: 'sabão', rua: 'Santa Lucia' },
      { id: 'c', nome: 'leite', rua: 'corredor 12' },
      { id: 'd', nome: 'café', rua: '' },
    ],
    produtosLista: [
      { id: 'p1', nome: 'arroz', rua: 'Rua 7' },
      { id: 'p2', nome: 'queijo', rua: 'Rua 3', localId: 'sendas', corredor: '3' },
    ],
  });

  test('só o que é CORREDOR anda; loja e vazio ficam como estavam', () => {
    // ⚠️ Arrastar "Santa Lucia" junto mandaria para o Assaí um item comprado
    // noutro lugar — o erro que a recusa de adivinhar existia para evitar.
    const r = migrarCorredoresParaLocal({ ...base(), localId: 'assai' });
    assert.equal(r.listaCompras[0].localId, 'assai');
    assert.equal(r.listaCompras[0].corredor, '7');
    assert.equal(r.listaCompras[1].localId, undefined);
    assert.equal(r.listaCompras[2].corredor, '12');
    assert.equal(r.listaCompras[3].localId, undefined);
    assert.equal(r.itensLista, 2);
    assert.equal(r.itensCatalogo, 1);
    assert.equal(r.itens, 3);
    assert.deepEqual(r.corredores, ['7', '12']);
  });

  test('item que já tem local NÃO é tocado — escolha à mão não se apaga com um botão', () => {
    const r = migrarCorredoresParaLocal({ ...base(), localId: 'assai' });
    assert.equal(r.produtosLista[1].localId, 'sendas');
    assert.equal(r.produtosLista[1].corredor, '3');
    assert.equal(r.produtosLista[1].atualizadoEm, undefined);
  });

  test('o `rua` antigo continua gravado — é de onde o número veio', () => {
    const r = migrarCorredoresParaLocal({ ...base(), localId: 'assai' });
    assert.equal(r.listaCompras[0].rua, 'Rua 7');
  });

  test('produtosLista CARIMBA atualizadoEm — sem ele a fusão desfaz a migração', () => {
    // §3, a armadilha do carimbo que falta: o registro do servidor tem carimbo
    // de uma gravação anterior e vence a edição local no poll seguinte.
    const r = migrarCorredoresParaLocal({ ...base(), localId: 'assai', agora: 'CARIMBO', ts: 42 });
    assert.equal(r.produtosLista[0].atualizadoEm, 'CARIMBO');
    assert.equal(r.listaCompras[0].updatedAt, 42);
  });

  test('não muda o objeto original — a gravação sai do `d` do save', () => {
    const b = base();
    const r = migrarCorredoresParaLocal({ ...b, localId: 'assai' });
    assert.equal(b.listaCompras[0].localId, undefined);
    assert.notEqual(r.listaCompras, b.listaCompras);
  });

  test('depois de migrar, a fila de corredores do plano ZERA', () => {
    // ⚠️ É isto que faz a migração terminar. Contando pelo `rua`, que continua
    // gravado, a tela diria "corredores para resolver" para sempre.
    const b = base();
    assert.ok(planoDeMigracao(b).corredores.length > 0);
    const r = migrarCorredoresParaLocal({ ...b, localId: 'assai' });
    const depois = planoDeMigracao({ listaCompras: r.listaCompras, produtosLista: r.produtosLista });
    assert.equal(depois.corredores.length, 0);
    // A rua que é LOJA continua pendente: é outra pergunta.
    assert.deepEqual(depois.locais.map((l) => l.valor), ['Santa Lucia']);
  });

  test('rodar duas vezes não muda nada na segunda', () => {
    const b = base();
    const r1 = migrarCorredoresParaLocal({ ...b, localId: 'assai' });
    const r2 = migrarCorredoresParaLocal({ ...r1, localId: 'assai' });
    assert.equal(r2.itens, 0);
    assert.deepEqual(r2.corredores, []);
  });
});
