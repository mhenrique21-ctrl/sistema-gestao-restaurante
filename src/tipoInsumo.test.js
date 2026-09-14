import test from 'node:test';
import assert from 'node:assert/strict';
import { tipoPadraoPorCategoria, tipoDoInsumo, pendenciasDeInsumo } from './tipoInsumo.js';

test('regra automática por categoria contábil', async (t) => {
  await t.test('a própria categoria já responde pra revenda', () => {
    assert.equal(tipoPadraoPorCategoria('Bebidas para revenda'), 'revenda');
  });

  await t.test('ingredientes viram produção', () => {
    ['Proteínas', 'Hortifruti', 'Laticínios', 'Mercearia/Secos']
      .forEach((c) => assert.equal(tipoPadraoPorCategoria(c), 'producao', c));
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
    assert.equal(tipoPadraoPorCategoria('PROTEINAS'), 'producao');
    assert.equal(tipoPadraoPorCategoria('laticinios'), 'producao');
  });
});

test('resolução do tipo de um insumo', async (t) => {
  await t.test('marcação manual vence a categoria', () => {
    // O dono sabe que aquele chocolate é revenda, não ingrediente.
    const mp = { nome: 'Chocolate barra', categoria: 'Mercearia/Secos' };
    assert.deepEqual(tipoDoInsumo({}, mp), { tipo: 'producao', origem: 'categoria' });
    assert.deepEqual(tipoDoInsumo({ 'chocolate barra': 'revenda' }, mp), { tipo: 'revenda', origem: 'marcado' });
  });

  await t.test('valor inválido no mapa cai pro padrão em vez de vazar', () => {
    const mp = { nome: 'Queijo', categoria: 'Laticínios' };
    assert.deepEqual(tipoDoInsumo({ queijo: 'qualquer_coisa' }, mp), { tipo: 'producao', origem: 'categoria' });
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
    const mapa = { 'agua cx': 'revenda', 'agua un': 'revenda', polvilho: 'producao' };
    const { semConversao } = pendenciasDeInsumo(mapa, [
      // Compra em caixa e vende em lata, sem dizer quantas cabem: a comparação
      // sairia errada com cara de certa.
      { nome: 'Agua cx', categoria: 'Outros', unidade: 'cx' },
      // Compra e vende por unidade: não há o que converter.
      { nome: 'Agua un', categoria: 'Outros', unidade: 'un' },
      // Produção sai em g/kg pela ficha, que tem a própria conversão.
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
