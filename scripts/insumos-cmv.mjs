#!/usr/bin/env node
// Compras com categoria "insumos" → categoria contábil do CMV.
// ============================================================================
// "insumos" é uma categoria da lista OPERACIONAL antiga (a dos corredores da
// Lista de Compras), não uma das 8 contábeis de `compras[].categoria` (§5 do
// CLAUDE.md). Como não está em CATS_CMV, a DRE joga essas compras em Despesas
// e o CMV sai menor do que é — quase tudo ali é matéria-prima.
//
// Dois modos, sem tocar no servidor (ele lê o JSON do disco a cada pedido, não
// precisa reiniciar nada):
//
//   node scripts/insumos-cmv.mjs listar [dirDados]
//       conta as compras "insumos" de cada loja, propõe uma categoria por ITEM
//       e grava a proposta em <dirDados>/insumos-proposta-<loja>.json
//
//   node scripts/insumos-cmv.mjs gravar [dirDados] --proposta <arquivo.json>
//       aplica a proposta (depois de revisada): backup do JSON da loja em
//       <dirDados>/backups/reclass-insumos/, reescreve a categoria das compras
//       (a original fica em `categoriaOriginal`, carimbo `atualizadoEm` para a
//       fusão não reverter), e ensina o dicionarioClassificacao com origem
//       "usuario" — que nem o agente nem a importação sobrescrevem.
//
// Na VPS o dirDados é /var/www/app-gestao/dados.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CATS_CMV = ['Proteínas', 'Hortifruti', 'Laticínios', 'Mercearia/Secos', 'Bebidas para revenda', 'Descartáveis de consumo do produto'];
export const CATS_NAO_CMV = ['Material de limpeza e higiene', 'Outros'];
export const CATS_COMPRA = [...CATS_CMV, ...CATS_NAO_CMV];
const LOJAS = ['confraria', 'seama'];

// Mesmo foldNome do App.tsx — a chave do dicionário tem que casar com a dele.
export const foldNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').replace(/[^\d,.-]/g, '');
  return (t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t)) || 0;
};

// As mesmas regras do classificarItem do App.tsx (REGRAS_LIMPEZA e
// PALAVRAS_CATEGORIA), mais o que um café/lanchonete compra e a lista de lá
// não cobre. As entradas de MAIS de uma palavra vêm primeiro de propósito:
// "leite de coco" é mercearia, e "leite" sozinho casaria antes como laticínio.
const REGRAS_LIMPEZA = ['detergente', 'sabao', 'sabonete', 'alcool 70', 'alcool', 'desinfetante', 'esponja', 'agua sanitaria',
  'vassoura', 'rodo', 'luva', 'amaciante', 'limpador', 'multiuso', 'desengordurante', 'papel higienico', 'papel toalha',
  'cloro', 'saco de lixo', 'saco lixo', 'touca', 'mascara', 'pano de prato', 'pano', 'bombril', 'la de aco', 'inseticida', 'lustra'];
const PALAVRAS = [
  // multi-palavra primeiro
  ['leite de coco', 'Mercearia/Secos'], ['leite condensado', 'Mercearia/Secos'], ['leite em po', 'Mercearia/Secos'],
  ['creme de leite', 'Laticínios'], ['papel aluminio', 'Descartáveis de consumo do produto'], ['filme pvc', 'Descartáveis de consumo do produto'],
  ['agua de coco', 'Bebidas para revenda'], ['agua mineral', 'Bebidas para revenda'], ['agua com gas', 'Bebidas para revenda'],
  ['molho de tomate', 'Mercearia/Secos'], ['extrato de tomate', 'Mercearia/Secos'], ['polpa', 'Mercearia/Secos'],
  // Proteínas
  ['carne', 'Proteínas'], ['frango', 'Proteínas'], ['peixe', 'Proteínas'], ['atum', 'Proteínas'], ['presunto', 'Proteínas'], ['salame', 'Proteínas'],
  ['bacon', 'Proteínas'], ['linguica', 'Proteínas'], ['file', 'Proteínas'], ['costela', 'Proteínas'], ['picanha', 'Proteínas'], ['alcatra', 'Proteínas'],
  ['patinho', 'Proteínas'], ['coxa', 'Proteínas'], ['ovo', 'Proteínas'], ['peito de peru', 'Proteínas'], ['calabresa', 'Proteínas'], ['salsicha', 'Proteínas'],
  ['hamburguer', 'Proteínas'], ['camarao', 'Proteínas'], ['sardinha', 'Proteínas'], ['mortadela', 'Proteínas'], ['blanquet', 'Proteínas'], ['lombo', 'Proteínas'],
  // Laticínios
  ['leite', 'Laticínios'], ['manteiga', 'Laticínios'], ['queijo', 'Laticínios'], ['mussarela', 'Laticínios'], ['muçarela', 'Laticínios'], ['requeijao', 'Laticínios'],
  ['creme', 'Laticínios'], ['iogurte', 'Laticínios'], ['nata', 'Laticínios'], ['chantilly', 'Laticínios'], ['cream cheese', 'Laticínios'], ['ricota', 'Laticínios'],
  ['parmesao', 'Laticínios'], ['cheddar', 'Laticínios'], ['coalho', 'Laticínios'], ['margarina', 'Laticínios'],
  // Hortifruti
  ['alface', 'Hortifruti'], ['tomate', 'Hortifruti'], ['cebola', 'Hortifruti'], ['batata', 'Hortifruti'], ['cenoura', 'Hortifruti'], ['banana', 'Hortifruti'],
  ['laranja', 'Hortifruti'], ['limao', 'Hortifruti'], ['maca', 'Hortifruti'], ['abacaxi', 'Hortifruti'], ['mamao', 'Hortifruti'], ['manga', 'Hortifruti'],
  ['pimentao', 'Hortifruti'], ['couve', 'Hortifruti'], ['verdura', 'Hortifruti'], ['fruta', 'Hortifruti'], ['legume', 'Hortifruti'], ['morango', 'Hortifruti'],
  ['uva', 'Hortifruti'], ['melancia', 'Hortifruti'], ['melao', 'Hortifruti'], ['maracuja', 'Hortifruti'], ['kiwi', 'Hortifruti'], ['abacate', 'Hortifruti'],
  ['goiaba', 'Hortifruti'], ['acerola', 'Hortifruti'], ['cupuacu', 'Hortifruti'], ['acai', 'Hortifruti'], ['coco', 'Hortifruti'], ['alho', 'Hortifruti'],
  ['salsa', 'Hortifruti'], ['cebolinha', 'Hortifruti'], ['coentro', 'Hortifruti'], ['hortela', 'Hortifruti'], ['rucula', 'Hortifruti'], ['repolho', 'Hortifruti'],
  ['pepino', 'Hortifruti'], ['abobora', 'Hortifruti'], ['abobrinha', 'Hortifruti'], ['milho verde', 'Hortifruti'], ['pera', 'Hortifruti'], ['tangerina', 'Hortifruti'],
  ['gengibre', 'Hortifruti'], ['brocolis', 'Hortifruti'], ['beterraba', 'Hortifruti'], ['mandioca', 'Hortifruti'], ['macaxeira', 'Hortifruti'],
  // Bebidas para revenda
  ['refrigerante', 'Bebidas para revenda'], ['cerveja', 'Bebidas para revenda'], ['suco', 'Bebidas para revenda'], ['agua', 'Bebidas para revenda'],
  ['energetico', 'Bebidas para revenda'], ['vinho', 'Bebidas para revenda'], ['coca', 'Bebidas para revenda'], ['guarana', 'Bebidas para revenda'],
  ['tonica', 'Bebidas para revenda'], ['red bull', 'Bebidas para revenda'], ['heineken', 'Bebidas para revenda'], ['pepsi', 'Bebidas para revenda'],
  ['fanta', 'Bebidas para revenda'], ['sprite', 'Bebidas para revenda'], ['h2o', 'Bebidas para revenda'], ['cha pronto', 'Bebidas para revenda'],
  // Descartáveis de consumo do produto
  ['saco', 'Descartáveis de consumo do produto'], ['sacola', 'Descartáveis de consumo do produto'], ['copo', 'Descartáveis de consumo do produto'],
  ['prato', 'Descartáveis de consumo do produto'], ['talher', 'Descartáveis de consumo do produto'], ['embalagem', 'Descartáveis de consumo do produto'],
  ['bandeja', 'Descartáveis de consumo do produto'], ['guardanapo', 'Descartáveis de consumo do produto'], ['canudo', 'Descartáveis de consumo do produto'],
  ['marmita', 'Descartáveis de consumo do produto'], ['tampa', 'Descartáveis de consumo do produto'], ['pote', 'Descartáveis de consumo do produto'],
  ['colher descart', 'Descartáveis de consumo do produto'], ['garfo descart', 'Descartáveis de consumo do produto'], ['palito', 'Descartáveis de consumo do produto'],
  ['caixa pizza', 'Descartáveis de consumo do produto'], ['caixa para', 'Descartáveis de consumo do produto'], ['forminha', 'Descartáveis de consumo do produto'],
  ['papel manteiga', 'Descartáveis de consumo do produto'], ['mexedor', 'Descartáveis de consumo do produto'], ['lacre', 'Descartáveis de consumo do produto'],
  // Mercearia/Secos
  ['farinha', 'Mercearia/Secos'], ['arroz', 'Mercearia/Secos'], ['feijao', 'Mercearia/Secos'], ['acucar', 'Mercearia/Secos'], ['sal', 'Mercearia/Secos'],
  ['oleo', 'Mercearia/Secos'], ['azeite', 'Mercearia/Secos'], ['molho', 'Mercearia/Secos'], ['cafe', 'Mercearia/Secos'], ['caldo', 'Mercearia/Secos'],
  ['tempero', 'Mercearia/Secos'], ['macarrao', 'Mercearia/Secos'], ['massa', 'Mercearia/Secos'], ['chocolate', 'Mercearia/Secos'], ['vinagre', 'Mercearia/Secos'],
  ['achocolatado', 'Mercearia/Secos'], ['cacau', 'Mercearia/Secos'], ['granola', 'Mercearia/Secos'], ['aveia', 'Mercearia/Secos'], ['mel', 'Mercearia/Secos'],
  ['canela', 'Mercearia/Secos'], ['baunilha', 'Mercearia/Secos'], ['xarope', 'Mercearia/Secos'], ['calda', 'Mercearia/Secos'], ['fermento', 'Mercearia/Secos'],
  ['amido', 'Mercearia/Secos'], ['maisena', 'Mercearia/Secos'], ['trigo', 'Mercearia/Secos'], ['pao', 'Mercearia/Secos'], ['biscoito', 'Mercearia/Secos'],
  ['bolacha', 'Mercearia/Secos'], ['torrada', 'Mercearia/Secos'], ['granulado', 'Mercearia/Secos'], ['confeito', 'Mercearia/Secos'], ['cobertura', 'Mercearia/Secos'],
  ['essencia', 'Mercearia/Secos'], ['corante', 'Mercearia/Secos'], ['gelatina', 'Mercearia/Secos'], ['cappuccino', 'Mercearia/Secos'], ['cha', 'Mercearia/Secos'],
  ['mate', 'Mercearia/Secos'], ['capsula', 'Mercearia/Secos'], ['grao', 'Mercearia/Secos'], ['milho', 'Mercearia/Secos'], ['ervilha', 'Mercearia/Secos'],
  ['azeitona', 'Mercearia/Secos'], ['ketchup', 'Mercearia/Secos'], ['mostarda', 'Mercearia/Secos'], ['maionese', 'Mercearia/Secos'], ['pimenta', 'Mercearia/Secos'],
  ['oregano', 'Mercearia/Secos'], ['castanha', 'Mercearia/Secos'], ['amendoim', 'Mercearia/Secos'], ['nozes', 'Mercearia/Secos'], ['pacoca', 'Mercearia/Secos'],
  ['doce de leite', 'Mercearia/Secos'], ['geleia', 'Mercearia/Secos'], ['tapioca', 'Mercearia/Secos'], ['goma', 'Mercearia/Secos'], ['cuscuz', 'Mercearia/Secos'],
  ['flocao', 'Mercearia/Secos'], ['leite vegetal', 'Mercearia/Secos'], ['whey', 'Mercearia/Secos'], ['adocante', 'Mercearia/Secos'], ['gelo', 'Mercearia/Secos'],
];

// De onde veio a proposta, na ordem em que a tela do app também confia:
// o que o usuário já ensinou, depois a regra de limpeza, depois o palpite.
export function proporCategoria(nome, dicionario) {
  const n = foldNome(nome);
  if (!n) return { categoria: 'Outros', origem: 'nenhuma' };
  const aprendido = dicionario?.[n];
  if (aprendido?.categoria && CATS_COMPRA.includes(aprendido.categoria)) return { categoria: aprendido.categoria, origem: 'dicionario' };
  if (REGRAS_LIMPEZA.some((p) => n.includes(p))) return { categoria: 'Material de limpeza e higiene', origem: 'regra' };
  for (const [palavra, cat] of PALAVRAS) {
    // Palavra inteira: "sal" não pode casar "salame" nem "salsa".
    const re = new RegExp(`(^|[^a-z])${palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?([^a-z]|$)`);
    if (re.test(n)) return { categoria: cat, origem: 'palpite' };
  }
  return { categoria: 'Outros', origem: 'nenhuma' };
}

const ehInsumos = (c) => foldNome(c?.categoria) === 'insumos';

// Agrupa as compras "insumos" por item e propõe uma categoria por item.
export function listarInsumos(d) {
  const grupos = new Map();
  for (const c of d?.compras || []) {
    if (!ehInsumos(c)) continue;
    const chave = foldNome(c.nomeProduto);
    if (!grupos.has(chave)) grupos.set(chave, { chave, nome: String(c.nomeProduto || '').trim(), compras: 0, total: 0, ids: [], ultimaData: '' });
    const g = grupos.get(chave);
    g.compras++; g.total = r2(g.total + money(c.valor)); g.ids.push(c.id);
    if ((c.data || '') > g.ultimaData) g.ultimaData = c.data || '';
  }
  const itens = [...grupos.values()].map((g) => ({ ...g, ...proporCategoria(g.nome, d?.dicionarioClassificacao) }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { itens, compras: itens.reduce((s, i) => s + i.compras, 0), total: r2(itens.reduce((s, i) => s + i.total, 0)) };
}

// Aplica a proposta revisada. Casa por NOME (foldNome), não por id: uma compra
// "insumos" do mesmo item que chegou depois da listagem entra junto.
export function aplicarProposta(d, proposta, agora = new Date().toISOString()) {
  const mapa = new Map();
  for (const it of proposta?.itens || []) {
    if (it.pular || !CATS_COMPRA.includes(it.categoria)) continue;
    mapa.set(it.chave || foldNome(it.nome), it.categoria);
  }
  let alteradas = 0, aprendidos = 0;
  const porCat = {};
  for (const c of d.compras || []) {
    if (!ehInsumos(c)) continue;
    const cat = mapa.get(foldNome(c.nomeProduto));
    if (!cat) continue;
    c.categoriaOriginal = c.categoriaOriginal || c.categoria;
    c.categoria = cat; c.atualizadoEm = agora; alteradas++;
    porCat[cat] = r2((porCat[cat] || 0) + money(c.valor));
  }
  d.dicionarioClassificacao = d.dicionarioClassificacao || {};
  for (const [chave, categoria] of mapa) {
    const atual = d.dicionarioClassificacao[chave];
    if (atual?.categoria === categoria && atual?.origemAprendizado === 'usuario') continue;
    d.dicionarioClassificacao[chave] = { categoria, origemAprendizado: 'usuario', ultimaAtualizacao: agora };
    aprendidos++;
  }
  return { alteradas, aprendidos, porCat, ignoradas: (proposta?.itens || []).length - mapa.size };
}

// Onde "insumos" realmente aparece no banco. Quando `listar` dá zero, a
// categoria está em outro lugar: no Financeiro (`contas[].categoria`), no
// catálogo (`materiasPrimas[].categoria`) ou no mapa da DRE.
export function diagnosticar(d, hoje = new Date().toISOString().slice(0, 10)) {
  const ini90 = new Date(Date.parse(hoje + 'T00:00:00Z') - 90 * 86400000).toISOString().slice(0, 10);
  const porCat = (lista, campoData) => {
    const m = {};
    for (const x of lista || []) {
      const k = String(x?.categoria || '(vazia)');
      m[k] = m[k] || { n: 0, total: 0, n90: 0, total90: 0 };
      const v = money(x.valor); m[k].n++; m[k].total = r2(m[k].total + v);
      if ((x?.[campoData] || '') >= ini90) { m[k].n90++; m[k].total90 = r2(m[k].total90 + v); }
    }
    return Object.entries(m).map(([cat, v]) => ({ cat, ...v })).sort((a, b) => b.total90 - a.total90 || b.total - a.total);
  };
  const grupos = new Set((d?.compras || []).map((c) => c.grupoId).filter(Boolean));
  const ligada = (c) => c.origem === 'compra' || !!c.chNFe || !!c.xmlNFe || (!!c.grupoId && grupos.has(c.grupoId));
  const contasSaida = (d?.contas || []).filter((c) => c.tipo === 'saida');
  const insumosFin = contasSaida.filter((c) => foldNome(c.categoria) === 'insumos');
  const mp = {};
  for (const m of d?.materiasPrimas || []) { const k = String(m?.categoria || '(vazia)'); mp[k] = (mp[k] || 0) + 1; }
  return {
    ini90,
    compras: porCat(d?.compras, 'data'),
    contas: porCat(contasSaida, 'vencimento'),
    insumosFin: {
      n: insumosFin.length, total: r2(insumosFin.reduce((s, c) => s + money(c.valor), 0)),
      pagas: insumosFin.filter((c) => c.status === 'pago').length,
      ligadasACompra: insumosFin.filter(ligada).length,
      porOrigem: insumosFin.reduce((m, c) => { const k = c.origem || '(sem origem)'; m[k] = (m[k] || 0) + 1; return m; }, {}),
      exemplos: insumosFin.sort((a, b) => (b.vencimento || '').localeCompare(a.vencimento || '')).slice(0, 12)
        .map((c) => ({ vencimento: c.vencimento, descricao: c.descricao, valor: money(c.valor), status: c.status, origem: c.origem || '', ligada: ligada(c) })),
    },
    mapaDre: d?.mapaCategoriaDre || {},
    categoriasFin: (d?.categorias || []).map((x) => (typeof x === 'string' ? x : x?.nome)).filter(Boolean),
    materiasPrimas: Object.entries(mp).sort((a, b) => b[1] - a[1]),
  };
}

// ── linha de comando ────────────────────────────────────────────────────────
const brl = (n) => 'R$ ' + r2(n).toFixed(2).replace('.', ',');
const lerLoja = (dir, loja) => JSON.parse(fs.readFileSync(path.join(dir, `${loja}.json`), 'utf-8'));

function cmdListar(dir) {
  for (const loja of LOJAS) {
    const arq = path.join(dir, `${loja}.json`);
    if (!fs.existsSync(arq)) { console.log(`\n== ${loja.toUpperCase()}: ${arq} não existe, pulando ==`); continue; }
    const d = lerLoja(dir, loja);
    const r = listarInsumos(d);
    const totalCompras = (d.compras || []).length;
    console.log(`\n== ${loja.toUpperCase()}: ${r.compras} compra(s) com categoria "insumos" de ${totalCompras} · ${brl(r.total)} · ${r.itens.length} item(ns) distinto(s) ==`);
    if (!r.itens.length) continue;
    const larg = Math.min(48, Math.max(10, ...r.itens.map((i) => i.nome.length)));
    console.log(`${'ITEM'.padEnd(larg)}  ${'N'.padStart(3)}  ${'TOTAL'.padStart(12)}  ${'ÚLTIMA'.padEnd(10)}  PROPOSTA (origem)`);
    for (const i of r.itens) {
      const nome = i.nome.length > larg ? i.nome.slice(0, larg - 1) + '…' : i.nome;
      const marca = i.origem === 'nenhuma' ? ' ⚠️ decidir' : i.origem === 'palpite' ? ' · conferir' : '';
      console.log(`${nome.padEnd(larg)}  ${String(i.compras).padStart(3)}  ${brl(i.total).padStart(12)}  ${i.ultimaData.padEnd(10)}  ${i.categoria} (${i.origem})${marca}`);
    }
    const saida = path.join(dir, `insumos-proposta-${loja}.json`);
    fs.writeFileSync(saida, JSON.stringify({ loja, geradoEm: new Date().toISOString(), itens: r.itens }, null, 2));
    console.log(`→ proposta gravada em ${saida} (edite "categoria" ou marque "pular": true antes de gravar)`);
  }
}

function cmdDiagnostico(dir) {
  for (const loja of LOJAS) {
    const arq = path.join(dir, `${loja}.json`);
    if (!fs.existsSync(arq)) continue;
    const r = diagnosticar(lerLoja(dir, loja));
    const tabela = (titulo, linhas) => {
      console.log(`\n-- ${titulo} (n / total · últimos 90 dias desde ${r.ini90}: n / total) --`);
      for (const l of linhas) console.log(`${l.cat.padEnd(38)} ${String(l.n).padStart(5)} ${brl(l.total).padStart(14)} · ${String(l.n90).padStart(4)} ${brl(l.total90).padStart(13)}`);
    };
    console.log(`\n==================== ${loja.toUpperCase()} ====================`);
    tabela('COMPRAS por categoria', r.compras);
    tabela('CONTAS (saída) por categoria', r.contas);
    const f = r.insumosFin;
    console.log(`\n-- CONTAS "Insumos": ${f.n} conta(s) · ${brl(f.total)} · ${f.pagas} paga(s) · ${f.ligadasACompra} ligada(s) a compra · origem: ${JSON.stringify(f.porOrigem)} --`);
    for (const e of f.exemplos) console.log(`  ${e.vencimento}  ${brl(e.valor).padStart(12)}  ${e.status.padEnd(8)} ${e.ligada ? 'ligada ' : 'solta  '} ${e.origem.padEnd(10)} ${e.descricao}`);
    console.log(`\n-- mapaCategoriaDre --`); console.log(JSON.stringify(r.mapaDre));
    console.log(`-- categorias do Financeiro --`); console.log(r.categoriasFin.join(' | '));
    console.log(`-- materiasPrimas por categoria --`); console.log(r.materiasPrimas.map(([c, n]) => `${c}: ${n}`).join(' | '));
  }
}

function cmdGravar(dir, arqProposta) {
  if (!arqProposta) { console.error('Faltou --proposta <arquivo.json>'); process.exit(2); }
  const proposta = JSON.parse(fs.readFileSync(arqProposta, 'utf-8'));
  const loja = String(proposta.loja || '').toLowerCase();
  if (!LOJAS.includes(loja)) { console.error(`Proposta sem "loja" válida (confraria|seama): ${proposta.loja}`); process.exit(2); }
  const arq = path.join(dir, `${loja}.json`);
  const bruto = fs.readFileSync(arq);
  const d = JSON.parse(bruto.toString('utf-8'));

  const backDir = path.join(dir, 'backups', 'reclass-insumos');
  fs.mkdirSync(backDir, { recursive: true });
  const backup = path.join(backDir, `${loja}_antes_${Date.now()}.json`);
  fs.writeFileSync(backup, bruto);

  const r = aplicarProposta(d, proposta);
  if (!r.alteradas && !r.aprendidos) { console.log(`${loja.toUpperCase()}: nada a alterar (backup em ${backup})`); return; }
  // Mesmo jeito do servidor: arquivo temporário + rename, nunca escrita parcial.
  const tmp = arq + '.reclass.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, arq);
  console.log(`${loja.toUpperCase()}: ${r.alteradas} compra(s) reclassificada(s), ${r.aprendidos} nome(s) ensinado(s) ao dicionário, ${r.ignoradas} item(ns) da proposta ignorado(s)`);
  for (const [cat, v] of Object.entries(r.porCat).sort((a, b) => b[1] - a[1])) console.log(`  ${cat.padEnd(36)} ${brl(v).padStart(12)}`);
  console.log(`  backup: ${backup}`);
}

const ehMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (ehMain) {
  const [modo, ...resto] = process.argv.slice(2);
  const iProp = resto.indexOf('--proposta');
  const arqProposta = iProp >= 0 ? resto[iProp + 1] : null;
  const dir = resto.filter((a, i) => !a.startsWith('--') && i !== iProp + 1)[0] || path.join(process.cwd(), 'dados');
  if (modo === 'listar') cmdListar(dir);
  else if (modo === 'diagnostico') cmdDiagnostico(dir);
  else if (modo === 'gravar') cmdGravar(dir, arqProposta);
  else { console.log('Uso:\n  node scripts/insumos-cmv.mjs listar [dirDados]\n  node scripts/insumos-cmv.mjs diagnostico [dirDados]\n  node scripts/insumos-cmv.mjs gravar [dirDados] --proposta <insumos-proposta-loja.json>'); process.exit(modo ? 2 : 0); }
}
