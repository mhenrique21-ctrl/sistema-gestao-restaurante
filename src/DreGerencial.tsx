// DRE gerencial — leitura nova da mesma DRE do Gestão.
// Os números vêm das funções do próprio App (resumoPeriodo, calcularBudget,
// gerarIndicativos), passadas em `fn`; aqui só muda a forma de mostrar.
import { useEffect, useMemo, useRef, useState } from "react";
import { htmlRelatorioDre } from "./dreRelatorio";

const TZ_LOJA = "America/Belem";
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const mesLongo = (m: string) => `${MESES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;
const mesCurto = (m: string) => `${MESES[+m.slice(5, 7) - 1].slice(0, 3)}/${m.slice(2, 4)}`;
const ok = (v: any) => v !== null && v !== undefined && Number.isFinite(v);
const brl = (v: any) => (ok(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—");
const pct = (v: any) => (ok(v) ? (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "—");
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
const dpct = (v: any) => (ok(v) ? sinal(v) + pct(Math.abs(v)) : "—");
const dpp = (v: any) => (ok(v) ? sinal(v) + (Math.abs(v) * 100).toFixed(1).replace(".", ",") + " pp" : "—");
const compacto = (v: any) => (ok(v) ? new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v) : "—");
const div = (a: number, b: number) => (b ? a / b : null);
const hojeLoja = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ_LOJA });
const nomeLoja = (e: string) => (/seama/i.test(e) ? "SEAMA" : /confraria/i.test(e) ? "Confraria" : e);

const META_CMV = 0.30, META_MARGEM = 0.10, META_TAXAS = 0.05;

// ── Períodos: semana (seg–dom), quinzena (1–15 / 16–fim), mês e personalizado ──
type Per = { tipo: string; ini: string; fim: string; ref: string };
const dUTC = (s: string) => new Date(s + "T12:00:00Z");
const isoD = (d: Date) => d.toISOString().slice(0, 10);
const addDias = (s: string, n: number) => isoD(new Date(dUTC(s).getTime() + n * 86400000));
const nDias = (a: string, b: string) => Math.round((dUTC(b).getTime() - dUTC(a).getTime()) / 86400000) + 1;
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dm = (s: string) => s.slice(8, 10) + "/" + s.slice(5, 7);
function chaveSemanaIso(ini: string) {
  const d = dUTC(ini); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const ano = d.getUTCFullYear(), j4 = new Date(Date.UTC(ano, 0, 4));
  const sem = 1 + Math.round(((d.getTime() - j4.getTime()) / 86400000 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7);
  return `${ano}-W${String(sem).padStart(2, "0")}`;
}
function periodoDe(tipo: string, base: string, de?: string, ate?: string): Per {
  const [y, m, d] = base.split("-").map(Number), ym = base.slice(0, 7);
  if (tipo === "semana") { const ini = addDias(base, -((dUTC(base).getUTCDay() + 6) % 7)); return { tipo, ini, fim: addDias(ini, 6), ref: chaveSemanaIso(ini) }; }
  if (tipo === "quinzena") return d <= 15 ? { tipo, ini: `${ym}-01`, fim: `${ym}-15`, ref: `${ym}-Q1` } : { tipo, ini: `${ym}-16`, fim: `${ym}-${ultimoDia(y, m)}`, ref: `${ym}-Q2` };
  if (tipo === "personalizado" && de && ate) return { tipo, ini: de, fim: ate, ref: `${de}_${ate}` };
  return { tipo: "mes", ini: `${ym}-01`, fim: `${ym}-${String(ultimoDia(y, m)).padStart(2, "0")}`, ref: ym };
}
function deslocar(p: Per, passo: number): Per {
  let q = p;
  for (let i = 0; i < Math.abs(passo); i++) {
    if (q.tipo === "personalizado") { const n = nDias(q.ini, q.fim);
      q = passo < 0 ? { ...q, fim: addDias(q.ini, -1), ini: addDias(q.ini, -n) } : { ...q, ini: addDias(q.fim, 1), fim: addDias(q.fim, n) };
      q.ref = `${q.ini}_${q.fim}`; }
    else q = periodoDe(q.tipo, passo < 0 ? addDias(q.ini, -1) : addDias(q.fim, 1));
  }
  return q;
}
function rotulo(p: Per) {
  if (p.tipo === "mes") return mesLongo(p.ref);
  if (p.tipo === "quinzena") return `${p.ref.endsWith("Q1") ? "1ª" : "2ª"} quinzena de ${mesLongo(p.ref.slice(0, 7))}`;
  if (p.tipo === "semana") return `Semana de ${dm(p.ini)} a ${dm(p.fim)}/${p.fim.slice(0, 4)}`;
  return `${dm(p.ini)}/${p.ini.slice(0, 4)} a ${dm(p.fim)}/${p.fim.slice(0, 4)}`;
}
function rotuloCurto(p: Per) {
  if (p.tipo === "mes") return mesCurto(p.ref);
  if (p.tipo === "quinzena") return `${p.ref.endsWith("Q1") ? "1ª" : "2ª"}q ${mesCurto(p.ref.slice(0, 7))}`;
  return dm(p.ini);
}
const NOME_PER: any = { semana: "semana", quinzena: "quinzena", mes: "mês", personalizado: "período" };

// Mesma regra do resumoPeriodo do app, mas para qualquer intervalo de datas.
function resumoIntervalo(db: any, ini: string, fim: string, fn: any) {
  const pm = (v: any) => (fn.parseMoney ? fn.parseMoney(v) : Number(v) || 0) || 0;
  const dias = nDias(ini, fim);
  const vendas = (db?.vendas || []).filter((v: any) => v.data >= ini && v.data <= fim);
  const receita = vendas.reduce((s: number, v: any) => s + (v.total || 0), 0);
  const taxas = vendas.reduce((s: number, v: any) => s + ((v.ifood || 0) - (v.ifoodLiq ?? v.ifood ?? 0)) + ((v["99food"] || 0) - (v.nfoodLiq ?? v["99food"] ?? 0)), 0);
  const cmv = (fn.CATS_CMV || []).reduce((s: number, cat: string) => s + fn.gastoCategoria(db.compras, cat, ini, fim), 0)
    + (fn.viaFinanceiro && fn.TIPOS_CMV_FIN ? fn.viaFinanceiro(db, ini, fim, fn.TIPOS_CMV_FIN) : 0);
  const despesas = (db?.contas || []).filter((c: any) => c.vencimento >= ini && c.vencimento <= fim && c.status === "pago" && c.tipo === "saida"
      && c.origem !== "adiantamento_rh" && !["fora", "pendente"].includes(fn.resolverDestinoDre(db, c.categoria)))
    .reduce((s: number, c: any) => s + pm(c.valor), 0)
    + (fn.viaFinanceiro && fn.TIPOS_DESP_FIN ? fn.viaFinanceiro(db, ini, fim, fn.TIPOS_DESP_FIN) : 0)
    + (db?.compras || []).filter((c: any) => c.data >= ini && c.data <= fim && !fn.ehCategoriaCmv(c.categoria || "Outros")).reduce((s: number, c: any) => s + pm(c.valor), 0);
  const folhaMensal = (db?.funcionarios || []).reduce((s: number, f: any) => s + (pm(f.salario) || 0), 0);
  const [y, m] = ini.split("-").map(Number);
  const folha = folhaMensal / ultimoDia(y, m) * dias;
  return { receita, taxas, cmv, despesas, folha, resultado: receita - taxas - cmv - despesas };
}
const podeIntervalo = (fn: any) => !!(fn.gastoCategoria && fn.CATS_CMV && fn.resolverDestinoDre && fn.ehCategoriaCmv);

// Um mês de uma loja, pela regra do app + Simples pela alíquota da loja.
function calcularPeriodo(db: any, per: Per, hoje: string, fn: any) {
  let r: any;
  if (per.tipo === "mes") r = fn.resumoPeriodo(db, "mes", per.ref, hoje);
  else if (podeIntervalo(fn)) r = resumoIntervalo(db, per.ini, per.fim, fn);
  else if (per.tipo === "semana") r = fn.resumoPeriodo(db, "semana", per.ref, hoje);
  else return null;
  const sn = (db?.config?.snAliquota || 6) / 100;
  const receita = r.receita || 0, imposto = receita * sn;
  const lucro = r.resultado - imposto;
  const variaveis = r.taxas + r.cmv + imposto;
  const mcp = div(receita - variaveis, receita);
  const pe = mcp && mcp > 0 ? r.despesas / mcp : null;
  return {
    per, receita, taxas: r.taxas, imposto, cmv: r.cmv, despesas: r.despesas, folha: r.folha, lucro, sn,
    receitaLiq: receita - r.taxas - imposto, lucroBruto: receita - r.taxas - imposto - r.cmv,
    margem: div(lucro, receita), cmvPct: div(r.cmv, receita), taxasPct: div(r.taxas, receita),
    despPct: div(r.despesas, receita), folhaPct: div(r.folha, receita), primePct: div(r.cmv + r.folha, receita),
    pontoEq: pe, margemSeg: pe === null ? null : div(receita - pe, receita),
  };
}

function mesesDisponiveis(db: any, hoje: string) {
  const datas = (db?.vendas || []).map((v: any) => String(v.data || "").slice(0, 7)).filter((m: string) => /^\d{4}-\d{2}$/.test(m));
  const fim = hoje.slice(0, 7), ini = datas.length ? datas.sort()[0] : fim;
  const out: string[] = [];
  let [y, m] = ini.split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= fim) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out.slice(-12);
}

function leiturasDoMes(a: any, p: any) {
  const out: string[] = [];
  if (!a.receita) return ["Sem vendas lançadas neste período ainda."];
  if (p && p.receita) {
    const subiuR = a.receita > p.receita, subiuL = a.lucro > p.lucro;
    out.push(subiuR && !subiuL ? `A receita subiu ${pct(a.receita / p.receita - 1)}, mas o lucro caiu: os custos cresceram mais que as vendas.`
      : subiuR && subiuL ? `Receita (+${pct(a.receita / p.receita - 1)}) e lucro subiram juntos em relação ao período anterior.`
      : subiuL ? "Mesmo vendendo menos, o lucro melhorou: os custos caíram mais que as vendas."
      : "Receita e lucro caíram em relação ao período anterior.");
  }
  out.push(a.lucro < 0
    ? `O mês está com prejuízo de ${brl(-a.lucro)}.${a.pontoEq ? ` Para empatar, a receita precisaria chegar a ${brl(a.pontoEq)}.` : ""}`
    : `Sobram ${brl(a.lucro)} (${pct(a.margem)} da receita)${a.margemSeg > 0 ? `; as vendas podem cair até ${pct(a.margemSeg)} antes de virar prejuízo` : ""}.`);
  out.push(a.cmvPct > META_CMV
    ? `O CMV está em ${pct(a.cmvPct)}, ${dpp(a.cmvPct - META_CMV)} acima dos 30%: cerca de ${brl((a.cmvPct - META_CMV) * a.receita)} a menos no resultado.`
    : `O CMV está em ${pct(a.cmvPct)}, dentro dos 30%.`);
  if (p && p.receita) {
    const lin: [string, string][] = [["o CMV", "cmvPct"], ["as despesas", "despPct"], ["as taxas de apps", "taxasPct"]];
    const [nome, k] = lin.sort((x, y) => Math.abs(a[y[1]] - p[y[1]]) - Math.abs(a[x[1]] - p[x[1]]))[0];
    out.push(`A maior mudança foi ${nome}: de ${pct(p[k])} para ${pct(a[k])} da receita (${dpp(a[k] - p[k])}).`);
  }
  return out;
}


// ── Composição de cada linha da DRE (o que está dentro da Receita, Taxas, CMV, Despesas)
// Segue a mesma regra do resumoPeriodo; o que não couber em nenhum grupo vira "Diferença",
// para a soma sempre fechar com o total da linha.
const dobra = (s: any) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function agruparItens(lista: any[], chave: (x: any) => string, detalhe: (x: any) => string, valor: (x: any) => number) {
  const m: any = {};
  lista.forEach(x => { const k = chave(x) || "(sem nome)"; const v = valor(x) || 0;
    if (!m[k]) m[k] = { nome: k, valor: 0, qtd: 0, detalhe: "" }; m[k].valor += v; m[k].qtd++; m[k].detalhe = detalhe(x) || m[k].detalhe; });
  return Object.values(m).sort((a: any, b: any) => b.valor - a.valor);
}
function composicao(db: any, per: Per, fn: any) {
  const pm = (v: any) => (fn.parseMoney ? fn.parseMoney(v) : Number(v) || 0) || 0;
  const rg = { inicio: per.ini, fim: per.fim };
  const dentro = (d: any) => d && d >= rg.inicio && d <= rg.fim;
  const vendas = (db?.vendas || []).filter((v: any) => dentro(v.data));
  const compras = (db?.compras || []).filter((c: any) => dentro(c.data));
  const out: any = {};

  // Receita por forma de recebimento; itens = dias
  const canais: [string, (v: any) => number][] = [["Maquininha", v => v.maquininha || 0], ["Dinheiro", v => v.dinheiro || 0],
    ["iFood", v => v.ifood || 0], ["99Food", v => v["99food"] || 0], ["Delivery próprio", v => v.delivery || 0]];
  out.receita = canais.map(([nome, f]) => ({ nome, valor: vendas.reduce((s: number, v: any) => s + f(v), 0),
    itens: vendas.filter((v: any) => f(v) > 0).map((v: any) => ({ nome: v.data.split("-").reverse().join("/"), valor: f(v) })).sort((a: any, b: any) => b.valor - a.valor) }))
    .filter((g: any) => g.valor > 0.005);

  // Taxas por plataforma
  out.taxas = [["iFood", (v: any) => (v.ifood || 0) - (v.ifoodLiq ?? v.ifood ?? 0)], ["99Food", (v: any) => (v["99food"] || 0) - (v.nfoodLiq ?? v["99food"] ?? 0)]]
    .map(([nome, f]: any) => ({ nome, valor: vendas.reduce((s: number, v: any) => s + f(v), 0),
      itens: vendas.filter((v: any) => f(v) > 0).map((v: any) => ({ nome: v.data.split("-").reverse().join("/"), valor: f(v) })) }))
    .filter((g: any) => Math.abs(g.valor) > 0.005);

  // CMV: categorias de matéria-prima (valor exato pelo gastoCategoria do app) + Financeiro sem nota
  const cats: string[] = fn.CATS_CMV || [];
  out.cmv = cats.map(cat => {
    const doCat = compras.filter((c: any) => dobra(c.categoria) === dobra(cat));
    const valor = fn.gastoCategoria ? fn.gastoCategoria(db.compras, cat, rg.inicio, rg.fim) : doCat.reduce((s: number, c: any) => s + pm(c.valor), 0);
    return { nome: cat, valor, itens: agruparItens(doCat, c => c.nomeProduto, c => c.fornecedor, c => pm(c.valor)) };
  });
  if (fn.viaFinanceiro && fn.TIPOS_CMV_FIN) out.cmv.push({ nome: "Insumos pagos pelo Financeiro (sem nota)", valor: fn.viaFinanceiro(db, rg.inicio, rg.fim, fn.TIPOS_CMV_FIN), itens: [] });
  out.cmv = out.cmv.filter((g: any) => Math.abs(g.valor) > 0.005);

  // Despesas: contas pagas (pela classificação da DRE) + Financeiro sem nota + compras fora do CMV
  const destino = (cat: string) => (fn.resolverDestinoDre ? fn.resolverDestinoDre(db, cat) : "despesa");
  const contas = (db?.contas || []).filter((c: any) => c.vencimento >= rg.inicio && c.vencimento <= rg.fim && c.status === "pago" && c.tipo === "saida"
    && c.origem !== "adiantamento_rh" && !["fora", "pendente"].includes(destino(c.categoria)));
  const porCat: any = {};
  contas.forEach((c: any) => { const k = c.categoria || "Sem categoria"; (porCat[k] = porCat[k] || []).push(c); });
  out.despesas = Object.entries(porCat).map(([cat, l]: any) => ({ nome: cat, tag: destino(cat) === "folha" ? "folha" : "",
    valor: l.reduce((s: number, c: any) => s + pm(c.valor), 0),
    itens: l.map((c: any) => ({ nome: c.descricao || cat, detalhe: String(c.vencimento || "").split("-").reverse().join("/"), valor: pm(c.valor) })).sort((a: any, b: any) => b.valor - a.valor) }));
  if (fn.viaFinanceiro && fn.TIPOS_DESP_FIN) out.despesas.push({ nome: "Pagas pelo Financeiro (sem nota)", valor: fn.viaFinanceiro(db, rg.inicio, rg.fim, fn.TIPOS_DESP_FIN), itens: [] });
  if (fn.ehCategoriaCmv) {
    const fora = compras.filter((c: any) => !fn.ehCategoriaCmv(c.categoria || "Outros")), pc: any = {};
    fora.forEach((c: any) => { const k = "Compras · " + (c.categoria || "Outros"); (pc[k] = pc[k] || []).push(c); });
    Object.entries(pc).forEach(([k, l]: any) => out.despesas.push({ nome: k, valor: l.reduce((s: number, c: any) => s + pm(c.valor), 0),
      itens: agruparItens(l, c => c.nomeProduto, c => c.fornecedor, c => pm(c.valor)) }));
  }
  out.despesas = out.despesas.filter((g: any) => Math.abs(g.valor) > 0.005).sort((a: any, b: any) => b.valor - a.valor);
  return out;
}
// Fecha a soma com o total oficial da linha e marca a maior alta contra o mês anterior.
function prepararGrupos(grupos: any[], total: number, anteriores: any[] | null) {
  const g = (grupos || []).map(x => ({ ...x }));
  const soma = g.reduce((s, x) => s + x.valor, 0);
  if (Math.abs(total - soma) > 1) g.push({ nome: "Diferença (não classificado)", valor: total - soma, itens: [], dif: true });
  const ant: any = Object.fromEntries((anteriores || []).map(x => [x.nome, x.valor]));
  g.forEach(x => { x.pv = anteriores ? (ant[x.nome] ?? 0) : null; x.alta = x.pv !== null ? x.valor - x.pv : null; });
  const maior = g.filter(x => !x.dif && x.alta > 0).sort((a, b) => b.alta - a.alta)[0];
  if (maior && g.length > 1) maior.maiorAlta = true;
  return g;
}

// Paleta própria (clara e escura), calma e com contraste garantido.
// Saídas numa mesma família de tons de areia; o CMV, que é o que mais pesa
// na decisão, ganha o âmbar; receita em azul-ardósia; resultado em verde-sálvia.
const CSS = `
.dg[data-t="claro"]{--dg-txt:#1f2523;--dg-txt2:#5f6964;--dg-card:#ffffff;--dg-borda:#e3e6e2;--dg-fundo2:#f3f5f2;
  --dg-receita:#3e5c76;--dg-taxa:#d9cbbd;--dg-imposto:#b9a593;--dg-cmv:#c68b2f;--dg-desp:#8a7766;--dg-lucro:#5e8c61;--dg-prej:#b5524a;
  --dg-trilho:#d3dde5;--dg-bom:#3f7a4f;--dg-ruim:#b5524a;--dg-atn:#9a6a14;--dg-avisobg:#fbf3e2;--dg-ativo:#1f2523;--dg-ativotxt:#ffffff;
  --dg-l0:#8a5a3b;--dg-l1:#3e5c76}
.dg[data-t="escuro"]{--dg-txt:#eceeea;--dg-txt2:#a6afa9;--dg-card:#1e2321;--dg-borda:#323935;--dg-fundo2:#272d2a;
  --dg-receita:#7fa3c0;--dg-taxa:#6e6358;--dg-imposto:#8c7d6f;--dg-cmv:#e0ac55;--dg-desp:#a8968a;--dg-lucro:#8dbf8f;--dg-prej:#e08a80;
  --dg-trilho:#3a4853;--dg-bom:#8fcb9b;--dg-ruim:#e89a90;--dg-atn:#e2b566;--dg-avisobg:#3a3122;--dg-ativo:#eceeea;--dg-ativotxt:#1e2321;
  --dg-l0:#d0a07e;--dg-l1:#7fa3c0}
.dg{display:flex;flex-direction:column;gap:16px;font-variant-numeric:tabular-nums;color:var(--dg-txt)}
.dg h2{font-size:22px;font-weight:700;margin:0;color:var(--dg-txt)}.dg h3{font-size:15px;font-weight:700;margin:0 0 4px;color:var(--dg-txt)}
.dg .sub{color:var(--dg-txt2);font-size:13px;margin:2px 0 0}.dg .take{font-size:15px;margin:0;max-width:70ch;color:var(--dg-txt);line-height:1.5}
.dg .card{background:var(--dg-card);border:1px solid var(--dg-borda);border-radius:12px;padding:18px;min-width:0}
.dg .nota{font-size:12px;color:var(--dg-txt2);margin:0 0 12px}
.dg .barra-f{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dg .seg{display:inline-flex;border:1px solid var(--dg-borda);border-radius:8px;overflow:hidden}
.dg .seg button{font:inherit;font-size:13px;border:0;background:transparent;color:var(--dg-txt2);padding:7px 14px;cursor:pointer}
.dg .seg button.on{background:var(--dg-ativo);color:var(--dg-ativotxt);font-weight:700}
.dg .nav{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;color:var(--dg-txt)}
.dg .nav button{font:inherit;font-size:18px;line-height:1;width:32px;height:32px;border-radius:8px;border:1px solid var(--dg-borda);background:var(--dg-card);color:var(--dg-txt);cursor:pointer}
.dg .nav button:disabled{opacity:.35;cursor:default}
.dg input[type=date]{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--dg-borda);background:var(--dg-card);color:var(--dg-txt);color-scheme:light dark;margin-left:4px}
.dg .imp{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:8px;border:1px solid var(--dg-borda);background:var(--dg-card);color:var(--dg-txt);cursor:pointer}
.dg select{font:inherit;font-size:14px;padding:7px 10px;border-radius:8px;border:1px solid var(--dg-borda);background:var(--dg-card);color:var(--dg-txt)}
.dg .abas{display:flex;gap:22px;border-bottom:1px solid var(--dg-borda)}
.dg .abas button{font:inherit;font-size:14px;border:0;background:transparent;color:var(--dg-txt2);padding:8px 0;border-bottom:2px solid transparent;cursor:pointer}
.dg .abas button.on{color:var(--dg-txt);border-bottom-color:var(--dg-txt);font-weight:700}
.dg .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.dg .kpi p{margin:0}.dg .kpi .r{font-size:12px;color:var(--dg-txt2)}.dg .kpi .v{font-size:24px;font-weight:700;margin:6px 0;color:var(--dg-txt)}
.dg .kpi .d{font-size:12px;font-weight:600}.dg .kpi .n{font-size:12px;color:var(--dg-txt2);margin-top:6px}
.dg .bom{color:var(--dg-bom)}.dg .ruim{color:var(--dg-ruim)}.dg .atn{color:var(--dg-atn)}
.dg .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px}
.dg .casc,.dg .tend{display:flex;gap:10px;height:230px}
.dg .casc{height:252px;padding-top:22px}
.dg .casc .col,.dg .tend .col{flex:1;display:flex;flex-direction:column;min-width:0}
.dg .area{flex:1;position:relative}.dg .rot{font-size:12px;color:var(--dg-txt2);text-align:center;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dg .casc .b{position:absolute;left:0;right:0;border-radius:6px}
.dg .casc .vl{position:absolute;left:0;right:0;text-align:center;font-size:12px;font-weight:600;color:var(--dg-txt);transform:translateY(-4px);white-space:nowrap}
.dg .tend .fat{position:absolute;left:20%;right:20%;border-radius:6px 6px 0 0;background:var(--dg-trilho)}
.dg .tend .luc{position:absolute;left:28%;right:28%;height:4px;border-radius:2px;transform:translateY(2px)}
.dg .stack{display:flex;height:40px;gap:2px;border-radius:8px;overflow:hidden}
.dg .stack div{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;overflow:hidden}
.dg .leg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--dg-txt2);margin-top:10px}
.dg .leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.dg table{width:100%;border-collapse:collapse;font-size:14px;color:var(--dg-txt)}
.dg th{font-size:12px;font-weight:400;color:var(--dg-txt2);text-align:right;padding:8px;border-bottom:1px solid var(--dg-borda);white-space:nowrap}
.dg td{text-align:right;padding:8px;border-bottom:1px solid var(--dg-borda);white-space:nowrap}
.dg th:first-child,.dg td:first-child{text-align:left}.dg tr.t td{font-weight:700;background:var(--dg-fundo2)}
.dg .tab{overflow-x:auto}.dg .pill{font-size:11px;font-weight:600;border:1px solid currentColor;border-radius:999px;padding:1px 8px}
.dg ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;line-height:1.55;color:var(--dg-txt)}
.dg .orc{display:flex;flex-direction:column;gap:10px}
.dg .orc .l{display:grid;grid-template-columns:170px minmax(0,1fr) 90px;gap:10px;align-items:center;font-size:13px}
.dg .orc .tr{position:relative;height:16px;background:var(--dg-fundo2);border-radius:4px}
.dg .orc .re{position:absolute;top:3px;bottom:3px;left:0;border-radius:3px}
.dg .orc .al{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--dg-txt)}
.dg .aviso{margin:0;font-size:13px;border-radius:8px;padding:8px 12px;background:var(--dg-avisobg);color:var(--dg-atn)}
.dg tr.abre{cursor:pointer}.dg tr.abre:hover td{background:var(--dg-fundo2)}
.dg .chev{display:inline-block;width:14px;color:var(--dg-txt2);transition:transform .15s}.dg .chev.on{transform:rotate(90deg)}
.dg tr.sub td{font-size:13px;color:var(--dg-txt);background:transparent}.dg tr.sub td:first-child{padding-left:30px}
.dg tr.sub2 td{font-size:12px;color:var(--dg-txt2)}.dg tr.sub2 td:first-child{padding-left:52px}
.dg .mini{display:inline-block;width:70px;height:6px;border-radius:3px;background:var(--dg-fundo2);margin-left:10px;vertical-align:middle;overflow:hidden}
.dg .mini i{display:block;height:100%;border-radius:3px}
.dg .tag{font-size:10px;font-weight:700;border-radius:999px;padding:1px 7px;margin-left:8px;background:var(--dg-fundo2);color:var(--dg-txt2)}
.dg .tag.alta{background:var(--dg-avisobg);color:var(--dg-atn)}
.dg .acoes{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.dg .link{font:inherit;font-size:12px;background:none;border:0;color:var(--dg-txt2);cursor:pointer;text-decoration:underline}
@media (max-width:640px){.dg .mini{display:none}.dg .oc{display:none}.dg .orc .l{grid-template-columns:110px minmax(0,1fr) 70px}}
`;
const COR: any = { receita: "var(--dg-receita)", taxa: "var(--dg-taxa)", imposto: "var(--dg-imposto)", cmv: "var(--dg-cmv)", desp: "var(--dg-desp)", lucro: "var(--dg-lucro)", prejuizo: "var(--dg-prej)", l0: "var(--dg-l0)", l1: "var(--dg-l1)" };
// Texto dentro das fatias: escuro nas fatias claras, claro nas escuras.
const TXT_FATIA: any = { claro: { taxa: "#3b322a", imposto: "#2d241c", cmv: "#2a1d07", desp: "#ffffff", lucro: "#ffffff", prejuizo: "#ffffff" },
  escuro: { taxa: "#f1ebe5", imposto: "#1b1612", cmv: "#1f1606", desp: "#1b1612", lucro: "#10200f", prejuizo: "#2a0e0b" } };

// Descobre se o Gestão está em modo claro ou escuro pela cor de fundo real
// atrás da tela, e acompanha quando o tema é trocado.
function useTema(ref: any) {
  const [tema, setTema] = useState("claro");
  useEffect(() => {
    const ler = () => {
      let el = ref.current?.parentElement;
      while (el) {
        const c = getComputedStyle(el).backgroundColor, m = c.match(/[\d.]+/g);
        if (m && (m.length < 4 || +m[3] > 0.5)) {
          const lum = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
          setTema(lum < 0.5 ? "escuro" : "claro"); return;
        }
        el = el.parentElement;
      }
      setTema(window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "escuro" : "claro");
    };
    ler();
    const obs = new MutationObserver(() => setTimeout(ler, 50));
    [document.documentElement, document.body].forEach(n => obs.observe(n, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-tema"] }));
    return () => obs.disconnect();
  }, []);
  return tema;
}

export function DreAlternador({ classica, nova }: any) {
  const [modo, setModo] = useState(() => { try { return localStorage.getItem("dreModo") || "nova"; } catch { return "nova"; } });
  const troca = (m: string) => { setModo(m); try { localStorage.setItem("dreModo", m); } catch {} };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[["nova", "DRE gerencial"], ["classica", "DRE clássica"]].map(([k, r]) => (
          <button key={k} onClick={() => troca(k)} style={{ font: "inherit", fontSize: 13, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
            border: "1px solid #a8a29e", background: modo === k ? "#8a5a3b" : "transparent", color: modo === k ? "#ffffff" : "inherit", fontWeight: modo === k ? 700 : 400 }}>{r}</button>
        ))}
      </div>
      {modo === "nova" ? nova : classica}
    </div>
  );
}

export default function DreGerencial({ db, empresa, fn }: any) {
  const raiz = useRef<any>(null);
  const tema = useTema(raiz);
  const hoje = hojeLoja();
  const [tipo, setTipo] = useState("mes");
  const [base, setBase] = useState(hoje);
  const [de, setDe] = useState(addDias(hoje, -6));
  const [ate, setAte] = useState(hoje);
  const [erroPer, setErroPer] = useState("");
  const per: Per = useMemo(() => periodoDe(tipo, base, de, ate), [tipo, base, de, ate]);
  const pAnt = useMemo(() => deslocar(per, -1), [per]);
  const mes = per.ref;
  const navegar = (passo: number) => { if (tipo === "personalizado") { const q = deslocar(per, passo); setDe(q.ini); setAte(q.fim); } else setBase(passo < 0 ? addDias(per.ini, -1) : addDias(per.fim, 1)); };
  const mudarDatas = (nde: string, nate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nde) || !/^\d{4}-\d{2}-\d{2}$/.test(nate)) { setErroPer("Escolha as duas datas."); return; }
    if (nde > nate) { setErroPer("A data inicial precisa ser antes da final."); return; }
    if (nDias(nde, nate) > 366) { setErroPer("Escolha no máximo um ano."); return; }
    setErroPer(""); setDe(nde); setAte(nate);
  };
  const budgetModo = tipo === "mes" ? ["mes", per.ref] : tipo === "semana" ? ["semana", per.ref] : null;
  const [aba, setAba] = useState("visao");
  const outraEmp = /seama/i.test(String(empresa)) ? "confraria" : "seama";
  const [outraDb, setOutraDb] = useState<any>(null);
  const [outraErro, setOutraErro] = useState("");

  useEffect(() => {
    if (aba !== "lojas" || outraDb) return;
    fetch(`/api/dados/${outraEmp}?_=${Date.now()}`).then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then(setOutraDb).catch(e => setOutraErro(String(e.message || e)));
  }, [aba]);

  const calc = (d: any, q: Per) => { try { return calcularPeriodo(d, q, hoje, fn); } catch (e) { console.error("[DRE gerencial]", e); return null; } };
  const a = useMemo(() => calc(db, per), [db, per]);
  const p = useMemo(() => calc(db, pAnt), [db, pAnt]);
  const serie = useMemo(() => [-5, -4, -3, -2, -1, 0].map(i => calc(db, deslocar(per, i))).filter((s: any) => s && (s.receita > 0 || s.per.ref === per.ref)), [db, per]);
  const leituras = useMemo(() => (a ? leiturasDoMes(a, p) : []), [a, p]);
  const indicativos = useMemo(() => { try { return budgetModo ? fn.gerarIndicativos(db, budgetModo[0], budgetModo[1], hoje) || [] : []; } catch { return []; } }, [db, per]);
  const budget = useMemo(() => { try { return budgetModo ? fn.calcularBudget(db, budgetModo[0], budgetModo[1], hoje) : null; } catch { return null; } }, [db, per]);
  const comp = useMemo(() => { try { return composicao(db, per, fn); } catch (e) { console.error("[DRE gerencial] composição", e); return null; } }, [db, per]);
  const compAnt = useMemo(() => { try { return composicao(db, pAnt, fn); } catch { return null; } }, [db, pAnt]);
  const [aberto, setAberto] = useState<any>({});
  const alterna = (k: string) => setAberto((x: any) => ({ ...x, [k]: !x[k] }));

  if (!a) return (<div ref={raiz}><p>Não foi possível calcular a DRE deste período.</p>
    <button onClick={() => { setTipo("mes"); setBase(hoje); }}>Voltar para o mês atual</button></div>);
  const loja = nomeLoja(String(empresa));
  const emAndamento = per.ini <= hoje && per.fim >= hoje;

  const KPIS = [
    { r: "Receita", v: brl(a.receita), d: p?.receita ? a.receita / p.receita - 1 : null, df: dpct, bom: "sobe", n: `${new Set((db?.vendas || []).filter((v: any) => v.data >= per.ini && v.data <= per.fim).map((v: any) => v.data)).size} de ${nDias(per.ini, per.fim)} dias com venda lançada` },
    { r: "Resultado (lucro)", v: brl(a.lucro), d: p && p.lucro ? (a.lucro - p.lucro) / Math.abs(p.lucro) : null, df: dpct, bom: "sobe", n: "Depois de taxas, Simples, CMV e despesas" },
    { r: "Margem", v: pct(a.margem), d: p && ok(p.margem) ? a.margem! - p.margem! : null, df: dpp, bom: "sobe", n: "Quanto sobra de cada R$ 100" },
    { r: "CMV", v: pct(a.cmvPct), d: p && ok(p.cmvPct) ? a.cmvPct! - p.cmvPct! : null, df: dpp, bom: "desce", n: "Meta: até 30%" },
    { r: "Taxas de apps", v: pct(a.taxasPct), d: p && ok(p.taxasPct) ? a.taxasPct! - p.taxasPct! : null, df: dpp, bom: "desce", n: "iFood e 99Food · referência 5%" },
    { r: "Ponto de equilíbrio", v: brl(a.pontoEq), d: p && p.pontoEq && a.pontoEq ? a.pontoEq / p.pontoEq - 1 : null, df: dpct, bom: "desce", n: `Margem de segurança ${pct(a.margemSeg)}` },
  ];
  const cascata = [
    ["Receita", a.receita, "receita"], ["Taxas", -a.taxas, "taxa"], [`Simples ${Math.round(a.sn * 1000) / 10}%`, -a.imposto, "imposto"],
    ["CMV", -a.cmv, "cmv"], ["Despesas", -a.despesas, "desp"], ["Resultado", a.lucro, a.lucro >= 0 ? "lucro" : "prejuizo"],
  ] as [string, number, string][];
  let nivel = 0;
  const passos = cascata.map(([e, v, t], i) => {
    if (i === 0) { nivel = v; return { e, v, t, ini: 0, fim: v }; }
    if (i === cascata.length - 1) return { e, v, t, ini: 0, fim: v };
    const s = { e, v, t, ini: nivel, fim: nivel + v }; nivel += v; return s;
  });
  const mx = Math.max(...passos.map(x => Math.max(x.ini, x.fim)), 1), mn = Math.min(0, ...passos.map(x => x.fim));
  const esc = (v: number) => ((v - mn) / (mx - mn)) * 100;

  const linhas = [
    { l: "Receita bruta", v: a.receita, pv: p?.receita, t: 1, k: "receita" },
    { l: "(−) Taxas de apps", v: -a.taxas, pv: p ? -p.taxas : null, meta: "ref. 5%", st: a.taxasPct! <= META_TAXAS, k: "taxas" },
    { l: `(−) Simples Nacional (${Math.round(a.sn * 1000) / 10}%)`, v: -a.imposto, pv: p ? -p.imposto : null },
    { l: "= Receita líquida", v: a.receitaLiq, pv: p?.receitaLiq, t: 1 },
    { l: "(−) CMV", v: -a.cmv, pv: p ? -p.cmv : null, meta: "até 30%", st: a.cmvPct! <= META_CMV, k: "cmv" },
    { l: "= Lucro bruto", v: a.lucroBruto, pv: p?.lucroBruto, t: 1 },
    { l: "(−) Despesas operacionais", v: -a.despesas, pv: p ? -p.despesas : null, k: "despesas" },
    { l: "= Resultado", v: a.lucro, pv: p?.lucro, t: 1, meta: "mín. 10%", st: (a.margem ?? -1) >= META_MARGEM },
  ];
  const outraA = outraDb ? calc(outraDb, per) : null;
  // Impressão A4: monta os números da tela e usa o mesmo modelo do PDF do agente.
  const dadosRelatorio = () => {
    const totais: any = { receita: a.receita, taxas: a.taxas, cmv: a.cmv, despesas: a.despesas };
    const corDe: any = { receita: "receita", cmv: "cmv", taxas: "taxa", despesas: "desp" };
    return {
      loja, periodo: rotulo(per), comparado: rotuloCurto(pAnt), comparadoLongo: rotulo(pAnt),
      geradoEm: new Date().toLocaleString("pt-BR", { timeZone: TZ_LOJA, dateStyle: "short", timeStyle: "short" }),
      receita: a.receita, folha: a.folha, folhaPct: a.folhaPct,
      kpis: KPIS.map(k => ({ r: k.r, v: k.v, d: k.d, bom: k.bom, tipo: k.df === dpp ? "pp" : "pct", n: k.n })),
      cascata: cascata.map(([e, v, t]) => ({ e, v, t })),
      linhas: linhas.map((l: any) => {
        const k = l.k;
        const grupos = k && comp ? prepararGrupos(comp[k], totais[k], compAnt ? compAnt[k] : null)
          .map((g: any) => ({ ...g, share: div(Math.abs(g.valor), Math.abs(totais[k])), av: div(Math.abs(g.valor), a.receita) })) : [];
        const ah = ok(l.pv) && l.pv ? (l.l.startsWith("(−)") ? (Math.abs(l.v) - Math.abs(l.pv)) / Math.abs(l.pv) : (l.v - l.pv) / Math.abs(l.pv)) : null;
        return { l: l.l, v: l.v, av: div(Math.abs(l.v), a.receita), ah, meta: l.meta, st: l.st, t: l.t, grupos, cor: corDe[k] };
      }),
      leituras, indicativos: (indicativos || []).map((i: any) => ({ titulo: i.titulo, texto: i.texto })),
      avisos: [emAndamento ? `${NOME_PER[tipo][0].toUpperCase() + NOME_PER[tipo].slice(1)} em andamento: números parciais` : ""].filter(Boolean),
    };
  };
  const imprimir = () => {
    const html = htmlRelatorioDre(dadosRelatorio());
    const ifr = document.createElement("iframe");
    Object.assign(ifr.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    document.body.appendChild(ifr);
    const w: any = ifr.contentWindow; w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => ifr.remove(), 60000); }, 400);
  };
  const lojasCmp = [{ nome: loja, x: a }, ...(outraA ? [{ nome: nomeLoja(outraEmp), x: outraA }] : [])];

  return (
    <div className="dg" ref={raiz} data-t={tema}>
      <style>{CSS}</style>
      <div>
        <h2>DRE gerencial</h2>
        <p className="sub">{loja} · {rotulo(per)}</p>
      </div>
      <p className="take">{leituras[0]}</p>
      <div className="barra-f">
        <div className="seg" role="group" aria-label="Período">
          {[["semana", "Semana"], ["quinzena", "Quinzena"], ["mes", "Mês"], ["personalizado", "Personalizado"]].map(([k, r]) =>
            <button key={k} className={tipo === k ? "on" : ""} aria-pressed={tipo === k} onClick={() => { setTipo(k); setErroPer(""); if (k !== "personalizado") setBase(hoje); }}>{r}</button>)}
        </div>
        <div className="nav">
          <button aria-label="Período anterior" onClick={() => navegar(-1)}>‹</button>
          <span>{rotulo(per)}</span>
          <button aria-label="Próximo período" onClick={() => navegar(1)} disabled={per.fim >= hoje}>›</button>
        </div>
        <button className="imp" onClick={imprimir} title="Imprimir em A4 ou salvar como PDF">Imprimir A4</button>
        {!(per.ini <= hoje && per.fim >= hoje) ? <button className="link" onClick={() => { setTipo(tipo); setBase(hoje); if (tipo === "personalizado") { setDe(addDias(hoje, -6)); setAte(hoje); } }}>Hoje</button> : null}
      </div>
      {tipo === "personalizado" && <div className="barra-f">
        <label className="sub">De <input type="date" value={de} max={hoje} onChange={e => mudarDatas(e.target.value, ate)} /></label>
        <label className="sub">até <input type="date" value={ate} max={hoje} onChange={e => mudarDatas(de, e.target.value)} /></label>
        <span className="sub">{nDias(de, ate)} dias · compara com os {nDias(de, ate)} dias anteriores</span>
        {erroPer && <span className="ruim" style={{ fontSize: 13 }}>{erroPer}</span>}
      </div>}
      {emAndamento && <p className="aviso">{NOME_PER[tipo] === "mês" ? "Mês" : NOME_PER[tipo][0].toUpperCase() + NOME_PER[tipo].slice(1)} em andamento: os números ainda vão crescer até o fechamento.</p>}
      {tipo !== "mes" && <p className="sub">Folha de referência proporcional aos dias do período.{!budgetModo ? " Orçamento e alertas do Budget aparecem em semana e mês." : ""}</p>}
      <div className="abas">
        {[["visao", "Visão geral"], ["lojas", "Comparar lojas"], ["orcado", "Orçado × realizado"]].map(([k, r]) =>
          <button key={k} className={aba === k ? "on" : ""} onClick={() => setAba(k)}>{r}</button>)}
      </div>

      {aba === "visao" && <>
        <div className="kpis">{KPIS.map(k => {
          const bom = ok(k.d) ? (k.bom === "sobe" ? k.d! >= 0 : k.d! <= 0) : null;
          return (<div className="card kpi" key={k.r}><p className="r">{k.r}</p><p className="v">{k.v}</p>
            {ok(k.d) && <p className={"d " + (bom ? "bom" : "ruim")}>{k.df(k.d)} vs {rotuloCurto(pAnt)}</p>}<p className="n">{k.n}</p></div>);
        })}</div>

        <div className="card"><h3>Como a receita vira resultado</h3><p className="nota">Cada barra é uma saída, da receita até o que sobra</p>
          <div className="casc">{passos.map(x => {
            const topo = esc(Math.max(x.ini, x.fim)), base = esc(Math.min(x.ini, x.fim));
            return (<div className="col" key={x.e} title={`${x.e}: ${brl(x.v)}`}><div className="area">
              <span className="vl" style={{ bottom: `${topo}%` }}>{x.v < 0 ? "−" : ""}{compacto(Math.abs(x.v))}</span>
              <div className="b" style={{ bottom: `${base}%`, height: `${Math.max(topo - base, 0.5)}%`, background: (COR as any)[x.t] }} /></div>
              <span className="rot">{x.e}</span></div>);
          })}</div></div>

        <div className="grid">
          <div className="card"><h3>Para onde vai cada R$ 100</h3><p className="nota">A mesma conta, em reais por R$ 100 vendidos</p>
            {(() => {
              const it = passos.slice(1).map(x => ({ ...x, c: (Math.abs(x.v) / (a.receita || 1)) * 100 }));
              const tot = it.reduce((s, x) => s + x.c, 0) || 1;
              return (<><div className="stack">{it.map(x => <div key={x.e} title={`${x.e}: R$ ${x.c.toFixed(2).replace(".", ",")}`} style={{ width: `${(x.c / tot) * 100}%`, background: (COR as any)[x.t], color: TXT_FATIA[tema][x.t] }}>{x.c >= 7 ? `R$ ${Math.round(x.c)}` : ""}</div>)}</div>
                <div className="leg">{it.map(x => <span key={x.e}><i style={{ background: (COR as any)[x.t] }} />{x.e} R$ {Math.round(x.c)}</span>)}</div></>);
            })()}
          </div>
          <div className="card"><h3>Receita e resultado: últimos períodos</h3><p className="nota">Barras: receita · traço: resultado</p>
            {(() => {
              const mxr = Math.max(...serie.map((s: any) => s.receita), 1), mnr = Math.min(0, ...serie.map((s: any) => s.lucro));
              const e2 = (v: number) => ((v - mnr) / (mxr - mnr)) * 100;
              return (<><div className="tend">{serie.map((s: any) => (
                <div className="col" key={s.per.ref} title={`${rotulo(s.per)} · receita ${brl(s.receita)} · resultado ${brl(s.lucro)}`}><div className="area">
                  <div className="fat" style={{ bottom: `${e2(0)}%`, height: `${e2(s.receita) - e2(0)}%` }} />
                  <div className="luc" style={{ bottom: `${e2(s.lucro)}%`, background: s.lucro >= 0 ? COR.lucro : COR.prejuizo }} /></div>
                  <span className="rot">{rotuloCurto(s.per)}</span></div>))}</div>
                <div className="leg"><span><i style={{ background: "var(--dg-trilho)" }} />Receita</span><span><i style={{ background: COR.lucro }} />Resultado</span></div></>);
            })()}
          </div>
        </div>

        <div className="card"><div className="acoes"><h3>DRE do mês</h3>
            <button className="link" onClick={() => { const todos = Object.values(aberto).some(Boolean); setAberto(todos ? {} : { receita: true, taxas: true, cmv: true, despesas: true }); }}>
              {Object.values(aberto).some(Boolean) ? "Fechar tudo" : "Abrir tudo"}</button></div>
          <p className="sub" style={{ marginBottom: 8 }}>Clique numa linha com › para ver o que está dentro dela · AV = peso na receita · AH = variação contra o mês anterior</p>
          <div className="tab"><table>
            <thead><tr><th>Linha</th><th>Valor</th><th>AV</th><th className="oc">AH</th><th className="oc">Meta</th><th>Status</th></tr></thead>
            <tbody>{linhas.map(l => {
              const k = (l as any).k, totais: any = { receita: a.receita, taxas: a.taxas, cmv: a.cmv, despesas: a.despesas };
              const grupos = k && comp ? prepararGrupos(comp[k], totais[k], compAnt ? compAnt[k] : null) : [];
              const pode = grupos.length > 0, on = pode && aberto[k];
              const corBarra = k === "receita" ? COR.receita : k === "cmv" ? COR.cmv : k === "taxas" ? COR.taxa : COR.desp;
              const orc: any = k === "cmv" && budget?.linhas ? Object.fromEntries(budget.linhas.map((x: any) => [x.cat, x.orcado])) : {};
              return [
              <tr key={l.l} className={(l.t ? "t " : "") + (pode ? "abre" : "")} onClick={pode ? () => alterna(k) : undefined}
                aria-expanded={pode ? !!on : undefined} tabIndex={pode ? 0 : undefined} onKeyDown={pode ? (e: any) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alterna(k); } } : undefined}>
                <td>{pode && <span className={"chev " + (on ? "on" : "")}>›</span>}{l.l}</td><td>{brl(l.v)}</td><td>{pct(div(Math.abs(l.v), a.receita))}</td>
                <td className="oc">{ok(l.pv) && l.pv ? dpct(l.l.startsWith("(−)") ? (Math.abs(l.v) - Math.abs(l.pv!)) / Math.abs(l.pv!) : (l.v - l.pv!) / Math.abs(l.pv!)) : "—"}</td><td className="oc">{l.meta || ""}</td>
                <td>{l.st !== undefined && <span className={"pill " + (l.st ? "bom" : "atn")}>{l.st ? "ok" : "atenção"}</span>}</td></tr>,
              ...(on ? grupos.flatMap((g: any) => {
                const kk = k + "|" + g.nome, on2 = aberto[kk] && g.itens?.length, share = div(Math.abs(g.valor), Math.abs(totais[k])) || 0;
                return [
                  <tr key={kk} className={"sub" + (g.itens?.length ? " abre" : "")} onClick={g.itens?.length ? (e: any) => { e.stopPropagation(); alterna(kk); } : undefined}>
                    <td>{g.itens?.length ? <span className={"chev " + (on2 ? "on" : "")}>›</span> : <span className="chev" />}{g.nome}
                      {g.tag === "folha" && <span className="tag">folha</span>}{g.maiorAlta && <span className="tag alta">maior alta</span>}
                      <span className="mini"><i style={{ width: `${Math.min(share, 1) * 100}%`, background: corBarra }} /></span></td>
                    <td>{brl(g.valor)}</td><td>{pct(div(Math.abs(g.valor), a.receita))}</td>
                    <td className="oc">{g.pv ? dpct((g.valor - g.pv) / Math.abs(g.pv)) : g.pv === 0 && g.valor ? "novo" : "—"}</td>
                    <td className="oc">{orc[g.nome] ? `orç. ${brl(orc[g.nome])}` : ""}</td>
                    <td>{orc[g.nome] ? <span className={"pill " + (g.valor <= orc[g.nome] ? "bom" : "atn")}>{g.valor <= orc[g.nome] ? "ok" : "acima"}</span> : <span className="sub">{pct(share)}</span>}</td></tr>,
                  ...(on2 ? [...g.itens.slice(0, 15).map((it: any, i: number) => (
                    <tr key={kk + i} className="sub2"><td>{it.nome}{it.qtd > 1 ? ` · ${it.qtd}x` : ""}{it.detalhe ? ` · ${it.detalhe}` : ""}</td>
                      <td>{brl(it.valor)}</td><td>{pct(div(Math.abs(it.valor), a.receita))}</td><td className="oc" /><td className="oc" /><td /></tr>)),
                    ...(g.itens.length > 15 ? [<tr key={kk + "+"} className="sub2"><td>e mais {g.itens.length - 15} itens</td>
                      <td>{brl(g.itens.slice(15).reduce((s: number, x: any) => s + x.valor, 0))}</td><td /><td className="oc" /><td className="oc" /><td /></tr>] : [])] : []),
                ];
              }) : []),
              ];
            })}
              <tr><td style={{ color: "var(--dg-txt2)" }}>Folha (referência, já dentro das despesas pagas)</td><td>{brl(a.folha)}</td><td>{pct(a.folhaPct)}</td><td className="oc" /><td className="oc" /><td /></tr>
            </tbody></table></div></div>

        <div className="card"><h3>Leituras do mês</h3>
          <ol>{leituras.map(t => <li key={t}>{t}</li>)}
            {indicativos.map((i: any) => <li key={i.regra + i.titulo}><b>{i.titulo}.</b> {i.texto}</li>)}</ol></div>
      </>}

      {aba === "lojas" && <div className="card"><h3>{lojasCmp.map(x => x.nome).join(" × ")} · {rotulo(per)}</h3>
        {!outraDb && !outraErro && <p className="sub">Carregando a outra loja…</p>}
        {outraErro && <p className="aviso">Não foi possível carregar a {nomeLoja(outraEmp)}: {outraErro}</p>}
        <div className="tab"><table>
          <thead><tr><th>Loja</th><th>Receita</th><th>CMV</th><th className="oc">Taxas</th><th className="oc">Despesas</th><th>Resultado</th><th>Margem</th></tr></thead>
          <tbody>{lojasCmp.map(({ nome, x }: any) => (
            <tr key={nome}><td>{nome}</td><td>{brl(x.receita)}</td><td className={x.cmvPct > META_CMV ? "ruim" : "bom"}>{pct(x.cmvPct)}</td>
              <td className="oc">{pct(x.taxasPct)}</td><td className="oc">{pct(x.despPct)}</td>
              <td className={x.lucro < 0 ? "ruim" : "bom"}>{brl(x.lucro)}</td><td className={(x.margem ?? -1) < META_MARGEM ? "ruim" : "bom"}>{pct(x.margem)}</td></tr>))}
            {outraA && (() => { const t = { receita: a.receita + outraA.receita, cmv: a.cmv + outraA.cmv, taxas: a.taxas + outraA.taxas, desp: a.despesas + outraA.despesas, lucro: a.lucro + outraA.lucro };
              return <tr className="t"><td>Total</td><td>{brl(t.receita)}</td><td>{pct(div(t.cmv, t.receita))}</td><td className="oc">{pct(div(t.taxas, t.receita))}</td>
                <td className="oc">{pct(div(t.desp, t.receita))}</td><td>{brl(t.lucro)}</td><td>{pct(div(t.lucro, t.receita))}</td></tr>; })()}
          </tbody></table></div></div>}

      {aba === "orcado" && <div className="card"><h3>Orçado × realizado de compras (CMV) · {rotulo(per)}</h3>
        {!budget || !budget.linhas?.length ? <p className="sub">{budgetModo ? "Nenhum orçamento de compras cadastrado para este período. Cadastre no Budget do Gestão." : "O orçamento do Budget é por semana ou mês. Escolha Semana ou Mês para comparar."}</p> : <>
          <p className="sub" style={{ marginBottom: 12 }}>Barra: projeção do período · traço: orçado · total projetado {brl(budget.projecaoTotal)} de {brl(budget.orcadoTotal)} orçados</p>
          <div className="orc">{(() => {
            const mxo = Math.max(...budget.linhas.map((l: any) => Math.max(l.orcado || 0, l.projecao || 0)), 1);
            return budget.linhas.map((l: any) => { const estouro = (l.projecao || 0) > (l.orcado || 0) && l.orcado > 0;
              return (<div className="l" key={l.cat}><span>{l.cat}</span><div className="tr">
                <div className="re" style={{ width: `${((l.projecao || 0) / mxo) * 100}%`, background: estouro ? COR.prejuizo : COR.lucro }} />
                {l.orcado > 0 && <div className="al" style={{ left: `calc(${(l.orcado / mxo) * 100}% - 1px)` }} />}</div>
                <span className={estouro ? "ruim" : "bom"} style={{ textAlign: "right" }}>{l.orcado > 0 ? dpct((l.projecao - l.orcado) / l.orcado) : brl(l.projecao)}</span></div>); });
          })()}</div></>}
      </div>}
    </div>
  );
}
