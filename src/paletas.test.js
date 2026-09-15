import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lê as paletas do PRÓPRIO App.tsx e mede. Medir um rascunho à parte não provaria
// nada: o que vale é o que está no código. As tags usavam a cor saturada como
// TEXTO sobre o tom claro da mesma família — #22C55E sobre #DCFCE7 dá 2,07:1,
// menos da metade do legível — e ninguém percebeu por anos porque não havia
// nada medindo.
const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.tsx'), 'utf8');

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function lerPaletas() {
  const re = /\.app-root\[data-paleta="([a-z]+)"\](\[data-theme="dark"\])?\{([^}]+)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(APP))) {
    const tok = {};
    m[3].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0) tok[d.slice(0, i).replace('--', '').trim()] = d.slice(i + 1).trim();
    });
    out.push({ nome: m[1], modo: m[2] ? 'escuro' : 'claro', tok });
  }
  return out;
}

// Texto sobre fundo, em todo par que a tela realmente compõe.
const PARES = [
  ['text', 'bg3', 'texto no card'], ['text2', 'bg3', 'texto secundário'],
  ['text3', 'bg3', 'texto de apoio'], ['text', 'bg', 'texto na página'],
  ['successText', 'successBg', 'tag ok'], ['warningText', 'warningBg', 'tag aviso'],
  ['dangerText', 'dangerBg', 'tag perigo'], ['infoText', 'infoBg', 'tag info'],
  ['categoryText', 'categoryBg', 'tag categoria'],
  ['onPrimary', 'btnPrimary', 'texto no botão'], ['onSuccess', 'success', 'botão cheio'],
  ['onDanger', 'btnDanger', 'botão perigo'], ['btnDanger', 'categoryBg', 'botão excluir'],
];

test('as paletas estão no código, claro e escuro', () => {
  const p = lerPaletas();
  const nomes = [...new Set(p.map((x) => x.nome))];
  assert.ok(nomes.length >= 6, `esperava 6+ paletas, achei ${nomes.length}`);
  for (const n of nomes) {
    assert.ok(p.some((x) => x.nome === n && x.modo === 'claro'), `${n} sem claro`);
    assert.ok(p.some((x) => x.nome === n && x.modo === 'escuro'), `${n} sem escuro`);
  }
});

test('nenhum texto abaixo de 4,5:1 em nenhuma paleta', () => {
  const falhas = [];
  for (const { nome, modo, tok } of lerPaletas()) {
    for (const [fg, bg, rotulo] of PARES) {
      if (!tok[fg] || !tok[bg]) continue;
      const r = contraste(tok[fg], tok[bg]);
      if (r < 4.5) falhas.push(`${nome} ${modo} · ${rotulo}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(falhas, [], `\n  ${falhas.join('\n  ')}\n`);
});

test('toda paleta define os tokens que as telas usam', () => {
  // Faltando um, o token do .app-root base vence e a paleta sai pela metade —
  // uma tag cognac no meio da Tinta, sem erro nenhum aparecendo.
  const precisa = [...new Set(PARES.flatMap(([a, b]) => [a, b]))];
  const falhas = [];
  for (const { nome, modo, tok } of lerPaletas()) {
    const falta = precisa.filter((k) => !tok[k]);
    if (falta.length) falhas.push(`${nome} ${modo}: ${falta.join(', ')}`);
  }
  assert.deepEqual(falhas, []);
});

test('na Tinta os quatro fundos de status se distinguem entre si', () => {
  // Sem cor, quem separa um status do outro é a LUMINOSIDADE. Abaixo de 1,3:1
  // os cinzas leem como o mesmo cinza e a tag vira enfeite — foi o que
  // aconteceu na primeira tentativa, com 1,18:1 entre info e ok.
  for (const modo of ['claro', 'escuro']) {
    const { tok } = lerPaletas().find((p) => p.nome === 'tinta' && p.modo === modo);
    const fundos = ['infoBg', 'successBg', 'warningBg', 'dangerBg'].map((k) => tok[k]);
    let pior = Infinity, par = '';
    for (let i = 0; i < fundos.length; i++) {
      for (let j = i + 1; j < fundos.length; j++) {
        const r = contraste(fundos[i], fundos[j]);
        if (r < pior) { pior = r; par = `${fundos[i]} × ${fundos[j]}`; }
      }
    }
    assert.ok(pior >= 1.35, `tinta ${modo}: ${par} = ${pior.toFixed(2)}:1`);
  }
});

test('a paleta base também passa — ela é o padrão de quem não escolheu', () => {
  // "personalizada" não aplica data-paleta nenhum: valem os tokens do
  // .app-root. Se ela reprovar, reprova pra todo mundo que não mexeu em nada.
  for (const seletor of ['\\.app-root\\{', '\\.app-root\\[data-theme="dark"\\]\\{']) {
    const m = APP.match(new RegExp(seletor + '([^}]+)\\}'));
    assert.ok(m, `bloco ${seletor} não encontrado`);
    const tok = {};
    m[1].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0) tok[d.slice(0, i).replace('--', '').trim()] = d.slice(i + 1).trim();
    });
    for (const [fg, bg, rotulo] of PARES) {
      if (!tok[fg] || !tok[bg] || !/^#[0-9A-Fa-f]{6}$/.test(tok[fg]) || !/^#[0-9A-Fa-f]{6}$/.test(tok[bg])) continue;
      const r = contraste(tok[fg], tok[bg]);
      assert.ok(r >= 4.5, `base ${seletor}: ${rotulo} = ${r.toFixed(2)}:1`);
    }
  }
});
