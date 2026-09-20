import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mede a paleta dos canais LENDO o App.tsx, como o `paletas.test.js` faz com as
// paletas do app. Medir um rascunho à parte não provaria nada: o que vale é o
// que está no código.
//
// ⚠️ As cores que a antiga aba "Por Canal" usava REPROVAM, e o par que reprova é
// justamente o que mais se compara: #F97316 (99Food) contra #EF4444 (iFood) dá
// ΔE 10,4 com visão NORMAL. Abaixo de 15 duas cores deixam de ser
// distinguíveis mesmo por quem enxerga todas — não é questão de daltonismo.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

// sRGB → OKLab. A distância euclidiana em OKLab ×100 é o ΔE que o validador de
// paletas usa; em RGB a mesma distância não quer dizer nada perceptual.
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const dE = (a, b) => {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
};

const CORES = (() => {
  const m = APP.match(/const CORES_REL=\[([^\]]+)\]/);
  assert.ok(m, 'CORES_REL não está no App.tsx');
  return m[1].split(',').map((c) => c.trim().replace(/["']/g, ''));
})();

test('a paleta dos canais existe e tem uma cor por canal', () => {
  assert.ok(CORES.length >= 5, `só ${CORES.length} cores para 5 canais`);
  assert.ok(CORES.every((c) => /^#[0-9a-f]{6}$/i.test(c)), 'hex de 6 dígitos');
  assert.equal(new Set(CORES.map((c) => c.toLowerCase())).size, CORES.length, 'sem cor repetida');
});

test('nenhum par ADJACENTE fica abaixo do piso de visão normal (ΔE 15)', () => {
  // Adjacente é o que importa: são as fatias que se encostam na barra empilhada
  // e as linhas vizinhas da tabela.
  for (let i = 0; i + 1 < CORES.length; i++) {
    const d = dE(CORES[i], CORES[i + 1]);
    assert.ok(d >= 15, `${CORES[i]} ↔ ${CORES[i + 1]} = ΔE ${d.toFixed(1)} — abaixo de 15`);
  }
});

test('nenhum par, adjacente ou não, repete a cor de outro canal', () => {
  // Numa tabela de cinco linhas todo par se compara, não só os vizinhos.
  for (let i = 0; i < CORES.length; i++) {
    for (let j = i + 1; j < CORES.length; j++) {
      const d = dE(CORES[i], CORES[j]);
      assert.ok(d >= 8, `${CORES[i]} ↔ ${CORES[j]} = ΔE ${d.toFixed(1)} — cores gêmeas`);
    }
  }
});

test('o par que REPROVAVA não voltou', () => {
  // A medida que originou tudo isto. Se alguém devolver as cores antigas
  // "porque parecem com a marca", este teste é que avisa.
  assert.ok(dE('#F97316', '#EF4444') < 15, 'a medida antiga continua valendo como referência');
  const baixo = CORES.map((c) => c.toLowerCase());
  assert.ok(!(baixo.includes('#f97316') && baixo.includes('#ef4444')),
    'o par 99Food/iFood que dá ΔE 10,4 voltou para a paleta');
});

test('as três abas absorvidas não ficaram penduradas no código', () => {
  // ⚠️ Um `relTab` que nenhum bloco renderiza dá TELA EM BRANCO, sem erro
  // nenhum — nem o build nem o TypeScript acusam.
  for (const t of ['mensal', 'canal', 'sazonal', 'empresas']) {
    assert.ok(!APP.includes(`relTab==="${t}"`), `sobrou o bloco da aba "${t}"`);
  }
  assert.ok(APP.includes('relTab==="periodo"'), 'a aba "periodo" tem que existir');
  // E quem tinha uma das antigas gravada como aba padrão precisa cair em algum
  // lugar que exista.
  assert.ok(APP.includes('ABA_REL_ANTIGA'), 'falta a tradução da aba padrão antiga');
});
