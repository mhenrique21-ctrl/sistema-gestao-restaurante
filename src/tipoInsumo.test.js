import test from 'node:test';
import assert from 'node:assert/strict';
import { tipoPadraoPorCategoria, tipoDoInsumo, pendenciasDeInsumo, baixaDaVenda, ehProdutoVendido, chaveTipo } from './tipoInsumo.js';

test('regra automática por categoria contábil', async (t) => {
  await t.test('a própria categoria já responde pra revenda', () => {
    assert.equal(tipoPadraoPorCategoria('Bebidas para revenda'), 'revenda');
  });

  await t.test('ingredientes viram produção', () => {
    ['Proteínas', 'Hortifruti', 'Laticínios', 'Mercearia/Secos']
      .forEach((c) => assert.equal(tipoPadraoPorCategoria(c), 'insumo', c));
  });

  await t.test('limpeza e descartável não saem por venda', () => {
    assert.equal(tipoPadraoPorCategoria('Material de limpeza e higiene'), 'interno');
    // Copo e guardanapo saem junto com a venda, mas não estão na ficha de
    // ninguém: marcar como produção faria a baixa procurar uma ficha que não
    // existe, e o insumo nunca baixaria — parecendo configurado e não estando.
    assert.equal(tipoPadraoPorCategoria('Descartáveis de consumo do produto'), 'interno');
  });

  await t.test('"Outros" NÃO tem palpite', () => {
    // De propósito: vira pendência na tela em vez de um chute que ninguém revisa.
    assert.equal(tipoPadraoPorCategoria('Outros'), null);
    assert.equal(tipoPadraoPorCategoria(''), null);
    assert.equal(tipoPadraoPorCategoria(undefined), null);
  });

  await t.test('acento e caixa não atrapalham', () => {
    assert.equal(tipoPadraoPorCategoria('PROTEINAS'), 'insumo');
    assert.equal(tipoPadraoPorCategoria('laticinios'), 'insumo');
  });
});

test('resolução do tipo de um insumo', async (t) => {
  await t.test('marcação manual vence a categoria', () => {
    // O dono sabe que aquele chocolate é revenda, não ingrediente.
    const mp = { nome: 'Chocolate barra', categoria: 'Mercearia/Secos' };
    assert.deepEqual(tipoDoInsumo({}, mp), { tipo: 'insumo', origem: 'categoria' });
    assert.deepEqual(tipoDoInsumo({ 'chocolate barra': 'revenda' }, mp), { tipo: 'revenda', origem: 'marcado' });
  });

  await t.test('valor inválido no mapa cai pro padrão em vez de vazar', () => {
    const mp = { nome: 'Queijo', categoria: 'Laticínios' };
    assert.deepEqual(tipoDoInsumo({ queijo: 'qualquer_coisa' }, mp), { tipo: 'insumo', origem: 'categoria' });
  });

  await t.test('sem marcação e sem regra fica explicitamente indefinido', () => {
    assert.deepEqual(tipoDoInsumo({}, { nome: 'Guardanapo', categoria: 'Outros' }), { tipo: null, origem: 'nenhum' });
  });

  await t.test('a chave do mapa é o nome normalizado', () => {
    const mp = { nome: 'Água Mineral', categoria: 'Outros' };
    assert.equal(tipoDoInsumo({ 'agua mineral': 'revenda' }, mp).tipo, 'revenda');
  });
});

test('pendências da tela de Insumos', async (t) => {
  await t.test('sem tipo entra na lista; com regra automática não', () => {
    const { semTipo } = pendenciasDeInsumo({}, [
      { nome: 'Polvilho', categoria: 'Mercearia/Secos' },
      { nome: 'Guardanapo', categoria: 'Outros' },
    ]);
    assert.deepEqual(semTipo.map((m) => m.nome), ['Guardanapo']);
  });

  await t.test('conversão só é cobrada de revenda comprada em embalagem', () => {
    const mapa = { 'agua cx': 'revenda', 'agua un': 'revenda', polvilho: 'insumo' };
    const { semConversao } = pendenciasDeInsumo(mapa, [
      // Compra em caixa e vende em lata, sem dizer quantas cabem: a comparação
      // sairia errada com cara de certa.
      { nome: 'Agua cx', categoria: 'Outros', unidade: 'cx' },
      // Compra e vende por unidade: não há o que converter.
      { nome: 'Agua un', categoria: 'Outros', unidade: 'un' },
      // Insumo sai em g/kg pela ficha, que tem a própria conversão.
      { nome: 'Polvilho', categoria: 'Outros', unidade: 'kg' },
    ]);
    assert.deepEqual(semConversao.map((m) => m.nome), ['Agua cx']);
  });

  await t.test('revenda com conversão preenchida sai da lista', () => {
    const { semConversao } = pendenciasDeInsumo({ 'agua cx': 'revenda' },
      [{ nome: 'Agua cx', categoria: 'Outros', unidade: 'cx', unidadesPorEmbalagem: 12 }]);
    assert.equal(semConversao.length, 0);
  });

  await t.test('insumo sem nome não vira pendência fantasma', () => {
    const { semTipo } = pendenciasDeInsumo({}, [{ categoria: 'Outros' }, null]);
    assert.equal(semTipo.length, 0);
  });
});

test('o que a venda faz com o estoque', async (t) => {
  await t.test('revenda baixa as marcas; produzido baixa o próprio saldo', () => {
    // O mesmo suco pode vir de duas marcas, e o saldo mora nelas. Guardar
    // saldo também no nome do cardápio seria contabilidade em dobro.
    assert.equal(baixaDaVenda('revenda'), 'lista');
    // O insumo do produzido já saiu quando foi produzido. Baixar de novo aqui
    // contaria a farinha duas vezes — e o erro só apareceria na contagem.
    assert.equal(baixaDaVenda('produzido'), 'proprio');
  });

  await t.test('dose baixa o insumo pela ficha', () => {
    // Não se estoca "fatia de queijo": se estoca queijo, e a fatia sai na hora.
    assert.equal(baixaDaVenda('dose'), 'ficha');
  });

  await t.test('insumo e interno não são vendidos', () => {
    assert.equal(baixaDaVenda('insumo'), 'nenhum');
    assert.equal(baixaDaVenda('interno'), 'nenhum');
    assert.equal(baixaDaVenda(null), 'nenhum');
  });

  await t.test('só os três tipos vendáveis contam como produto', () => {
    assert.deepEqual(['revenda','produzido','dose','insumo','interno'].map(ehProdutoVendido),
      [true, true, true, false, false]);
  });
});

test('compatibilidade com a marcação anterior', async (t) => {
  await t.test('"producao" antigo é lido como "insumo"', () => {
    // Valor gravado numa versão anterior, no mesmo dia. Traduzir na leitura é
    // mais seguro que migrar dado: quem marcou não perde o trabalho.
    assert.deepEqual(tipoDoInsumo({ farinha: 'producao' }, { nome: 'Farinha', categoria: 'Outros' }),
      { tipo: 'insumo', origem: 'marcado' });
  });
});

test('código como identidade do produto', async (t) => {
  await t.test('produto com código é marcado pelo código, não pelo nome', () => {
    const mp = { nome: 'Agua Mineral', codigoEcletica: '165', categoria: 'Outros' };
    assert.equal(chaveTipo(mp), 'cod:165');
    assert.equal(tipoDoInsumo({ 'cod:165': 'revenda' }, mp).tipo, 'revenda');
  });

  await t.test('renomear no Gestão NÃO perde a marcação', () => {
    // É o motivo de existir: mudar o nome do produto não pode desfazer o
    // trabalho de classificação nem desvincular a venda.
    const mapa = { 'cod:165': 'revenda' };
    const renomeado = { nome: 'Água Mineral 500ml', codigoEcletica: '165', categoria: 'Outros' };
    assert.equal(tipoDoInsumo(mapa, renomeado).tipo, 'revenda');
  });

  await t.test('insumo sem código continua pelo nome', () => {
    const mp = { nome: 'Farinha', categoria: 'Outros' };
    assert.equal(chaveTipo(mp), 'farinha');
    assert.equal(tipoDoInsumo({ farinha: 'insumo' }, mp).tipo, 'insumo');
  });

  await t.test('marcação antiga por nome continua valendo depois de ganhar código', () => {
    // Quem marcou antes da importação não precisa marcar de novo.
    const mp = { nome: 'Agua Mineral', codigoEcletica: '165', categoria: 'Outros' };
    assert.equal(tipoDoInsumo({ 'agua mineral': 'revenda' }, mp).tipo, 'revenda');
  });

  await t.test('o código vence o nome quando os dois existem', () => {
    const mp = { nome: 'Agua Mineral', codigoEcletica: '165', categoria: 'Outros' };
    assert.equal(tipoDoInsumo({ 'cod:165': 'dose', 'agua mineral': 'revenda' }, mp).tipo, 'dose');
  });
});
