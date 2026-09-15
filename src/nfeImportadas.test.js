import test from 'node:test';
import assert from 'node:assert/strict';
import { foldChave, chaveValida, chavesImportadas, jaImportada, separarImportadas } from './nfeImportadas.js';

const CHAVE = '16260906057223039388553000001528891567576944';
const OUTRA = '16260906057223039388553000001526211566438001';

test('a chave é comparada só pelos dígitos', () => {
  // Na tela ela aparece agrupada ("1626 0906 …") e no XML vem corrida.
  // Comparando como veio, a mesma nota pareceria duas.
  assert.equal(foldChave('1626 0906 0572 2303 9388 5530 0000 1528 8915 6757 6944'), CHAVE);
  assert.ok(chaveValida(` ${CHAVE} `));
  assert.ok(!chaveValida('1626'));
});

test('a chave é lida das compras E das contas', () => {
  // A importação sempre gravou a chave na conta a pagar e nunca na compra:
  // olhando só um lado, todo o histórico anterior voltaria como nota nova.
  const db = { compras: [{ chNFe: CHAVE }], contas: [{ chNFe: OUTRA }] };
  const k = chavesImportadas(db);
  assert.equal(k.size, 2);
  assert.ok(k.has(CHAVE) && k.has(OUTRA));
});

test('nota já importada é reconhecida; nota nova, não', () => {
  const db = { compras: [{ chNFe: CHAVE }], contas: [] };
  assert.ok(jaImportada(db, { chNFe: CHAVE }));
  assert.ok(!jaImportada(db, { chNFe: OUTRA }));
});

test('nota sem chave nunca é dada como importada', () => {
  // Sem a chave não dá pra afirmar nada, e esconder por palpite faria a nota
  // sumir sem ninguém achar.
  const db = { compras: [{ chNFe: CHAVE }] };
  assert.ok(!jaImportada(db, { chNFe: '' }));
  assert.ok(!jaImportada(db, {}));
  assert.ok(!jaImportada(db, { chNFe: '1626090605' }));
});

test('compra sem chave não vira chave vazia no conjunto', () => {
  // Uma chave "" no conjunto casaria com toda nota sem chave.
  const db = { compras: [{ chNFe: '' }, { nNF: '152889' }, { chNFe: CHAVE }] };
  assert.deepEqual([...chavesImportadas(db)], [CHAVE]);
});

test('separar devolve o que falta importar e o que já entrou', () => {
  const db = { compras: [{ chNFe: CHAVE }], contas: [] };
  const { visiveis, ocultas } = separarImportadas(db, [
    { nsu: 1, chNFe: CHAVE },
    { nsu: 2, chNFe: OUTRA },
    { nsu: 3 },
  ]);
  assert.deepEqual(visiveis.map((n) => n.nsu), [2, 3]);
  assert.deepEqual(ocultas.map((n) => n.nsu), [1]);
});

test('"Do início" não ressuscita nota já importada', () => {
  // O cenário que motivou o módulo: o botão reseta o contador da SEFAZ e a
  // varredura devolve tudo outra vez.
  const db = { compras: [{ chNFe: CHAVE }, { chNFe: OUTRA }], contas: [] };
  const varreduraDoInicio = [{ nsu: 10, chNFe: CHAVE }, { nsu: 11, chNFe: OUTRA }];
  assert.deepEqual(separarImportadas(db, varreduraDoInicio).visiveis, []);
});

test('banco vazio não esconde nada', () => {
  const { visiveis, ocultas } = separarImportadas({}, [{ nsu: 1, chNFe: CHAVE }]);
  assert.equal(visiveis.length, 1);
  assert.equal(ocultas.length, 0);
});
