import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mede as cinco fatias da barra da DRE LENDO o App.tsx, como o
// `coresRelatorio.test.js` faz com os canais. Medir um rascunho à parte não
// prova nada: o que vale é o que está no código.
//
// ⚠️ Esta barra é a única parte da DRE que a pessoa lê como PROPORÇÃO, e as
// cinco fatias ficam encostadas umas nas outras — todo par é adjacente.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

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

// Deuteranopia pela matriz de Viénot — a mesma simplificação que o validador
// de paletas usa. Não é diagnóstico: é o piso de "duas fatias continuam
// distintas para quem não separa vermelho de verde".
function deuter(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.31399022 * r + 0.63951294 * g + 0.04649755 * b;
  const S = 0.01775239 * r + 0.10944209 * g + 0.87256922 * b;
  const M2 = 0.494207 * L + 1.24827 * S;
  const out = [
    5.47221206 * L - 4.6419601 * M2 + 0.16963708 * S,
    -1.1252419 * L + 2.29317094 * M2 - 0.1678952 * S,
    0.02980165 * L - 0.19318073 * M2 + 1.16364789 * S,
  ].map((v) => {
    const c = Math.max(0, Math.min(1, v));
    const t = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return `0${Math.round(t * 255).toString(16)}`.slice(-2);
  });
  return `#${out.join('')}`;
}

const CORES = (() => {
  const m = APP.match(/const CORES_DRE=\{([^}]+)\}/);
  assert.ok(m, 'CORES_DRE não está no App.tsx');
  return m[1].split(',').map((par) => {
    const [k, v] = par.split(':');
    return [k.trim(), v.trim().replace(/["']/g, '')];
  });
})();

// Os dois fundos reais em que a barra é desenhada: o card branco e o trilho
// creme que aparece atrás das fatias de largura zero.
const FUNDOS = ['#ffffff', '#f3ebe1'];

test('há uma cor por fatia, e nenhuma repetida', () => {
  assert.deepEqual(CORES.map(([k]) => k), ['taxa', 'cmv', 'despesa', 'imposto', 'sobra']);
  assert.ok(CORES.every(([, v]) => /^#[0-9a-f]{6}$/i.test(v)), 'hex de 6 dígitos');
  assert.equal(new Set(CORES.map(([, v]) => v.toLowerCase())).size, 5, 'cor repetida entre fatias');
});

test('TODO par fica acima do piso de visão normal (ΔE 15)', () => {
  // Na barra empilhada as cinco se encostam: não existe par "distante".
  for (let i = 0; i < CORES.length; i++) {
    for (let j = i + 1; j < CORES.length; j++) {
      const d = dE(CORES[i][1], CORES[j][1]);
      assert.ok(d >= 15, `${CORES[i][0]} ↔ ${CORES[j][0]} = ΔE ${d.toFixed(1)} — abaixo de 15`);
    }
  }
});

test('e continuam distintas sob daltonismo', () => {
  // ⚠️ Laranja e amarelo colapsam sob deuteranopia. A primeira tentativa desta
  // paleta media ΔE 5,9 aqui — pior que os 9,1 da paleta dos canais.
  for (let i = 0; i < CORES.length; i++) {
    for (let j = i + 1; j < CORES.length; j++) {
      const d = dE(deuter(CORES[i][1]), deuter(CORES[j][1]));
      assert.ok(d >= 15, `${CORES[i][0]} ↔ ${CORES[j][0]} sob deuteranopia = ΔE ${d.toFixed(1)}`);
    }
  }
});

test('nenhuma fatia some dentro do trilho da barra', () => {
  // ⚠️ Uma fatia de 2% desenhada numa cor perto do creme lê como trilho vazio —
  // e a fatia fina é justamente a que a pessoa precisa enxergar.
  for (const [nome, cor] of CORES) {
    for (const f of FUNDOS) {
      const d = dE(cor, f);
      assert.ok(d >= 15, `${nome} (${cor}) contra ${f} = ΔE ${d.toFixed(1)}`);
    }
  }
});
