// Relatório A4 da DRE gerencial — UM modelo para dois usos:
//  • Gestão: botão "Imprimir A4" (abre a impressão do navegador)
//  • Agente financeiro: o mesmo HTML vira PDF e é enviado pelo WhatsApp
// Recebe os números já calculados e devolve uma página HTML completa. Sem dependências.

const MOEDA = (v) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—");
const PCT = (v) => (Number.isFinite(v) ? (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "—");
const SINAL = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
const VAR = (v, tipo) => (!Number.isFinite(v) ? "—" : tipo === "pp" ? SINAL(v) + (Math.abs(v) * 100).toFixed(1).replace(".", ",") + " pp" : SINAL(v) + PCT(Math.abs(v)));
const COMPACTO = (v) => (Number.isFinite(v) ? new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v) : "—");
const ESC = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const COR = { receita: "#3e5c76", taxa: "#d9cbbd", imposto: "#b9a593", cmv: "#c68b2f", desp: "#8a7766", lucro: "#5e8c61", prejuizo: "#b5524a" };

function svgCascata(passos) {
  const W = 680, H = 190, topo = 18, base = 26, n = passos.length, gap = 14, bw = (W - gap * (n - 1)) / n;
  let nivel = 0;
  const pts = passos.map((p, i) => {
    if (i === 0) { nivel = p.v; return { ...p, ini: 0, fim: p.v }; }
    if (i === n - 1) return { ...p, ini: 0, fim: p.v };
    const r = { ...p, ini: nivel, fim: nivel + p.v }; nivel += p.v; return r;
  });
  const mx = Math.max(...pts.map((p) => Math.max(p.ini, p.fim)), 1), mn = Math.min(0, ...pts.map((p) => p.fim));
  const y = (v) => topo + (1 - (v - mn) / (mx - mn)) * (H - topo - base);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#cfd4d0" stroke-width="1"/>
    ${pts.map((p, i) => {
      const x = i * (bw + gap), a = y(Math.max(p.ini, p.fim)), b = y(Math.min(p.ini, p.fim));
      return `<rect x="${x}" y="${a}" width="${bw}" height="${Math.max(b - a, 1)}" rx="4" fill="${COR[p.t] || "#999"}"/>
        <text x="${x + bw / 2}" y="${a - 5}" text-anchor="middle" font-size="11" font-weight="600" fill="#1f2523">${p.v < 0 ? "−" : ""}${COMPACTO(Math.abs(p.v))}</text>
        <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#5f6964">${ESC(p.e)}</text>`;
    }).join("")}
  </svg>`;
}

function barraCem(passos, receita) {
  const it = passos.slice(1).map((p) => ({ ...p, c: receita ? (Math.abs(p.v) / receita) * 100 : 0 }));
  const tot = it.reduce((s, x) => s + x.c, 0) || 1;
  const claro = { taxa: 1, imposto: 1, cmv: 1 };
  return `<div class="cem">${it.map((x) => `<div style="width:${(x.c / tot) * 100}%;background:${COR[x.t]};color:${claro[x.t] ? "#2a1d07" : "#fff"}">${x.c >= 7 ? "R$ " + Math.round(x.c) : ""}</div>`).join("")}</div>
    <div class="leg">${it.map((x) => `<span><i style="background:${COR[x.t]}"></i>${ESC(x.e)} R$ ${Math.round(x.c)}</span>`).join("")}</div>`;
}

export function htmlRelatorioDre(d) {
  const kpis = d.kpis.map((k) => {
    const cls = !Number.isFinite(k.d) ? "" : (k.bom === "sobe" ? k.d >= 0 : k.d <= 0) ? "bom" : "ruim";
    return `<div class="kpi"><div class="r">${ESC(k.r)}</div><div class="v">${ESC(k.v)}</div>
      <div class="d ${cls}">${Number.isFinite(k.d) ? VAR(k.d, k.tipo) + " vs " + ESC(d.comparado) : "&nbsp;"}</div><div class="n">${ESC(k.n || "")}</div></div>`;
  }).join("");

  const linhas = d.linhas.map((l) => `<tr class="${l.t ? "t" : ""}"><td>${ESC(l.l)}</td><td>${MOEDA(l.v)}</td><td>${PCT(l.av)}</td><td>${VAR(l.ah)}</td><td>${ESC(l.meta || "")}</td>
      <td>${l.st === undefined || l.st === null ? "" : `<span class="pill ${l.st ? "bom" : "atn"}">${l.st ? "ok" : "atenção"}</span>`}</td></tr>`).join("")
    + (Number.isFinite(d.folha) ? `<tr class="ref"><td>Folha (referência, já dentro das despesas pagas)</td><td>${MOEDA(d.folha)}</td><td>${PCT(d.folhaPct)}</td><td></td><td></td><td></td></tr>` : "");

  const composicao = d.linhas.filter((l) => l.grupos && l.grupos.length).map((l) => `
    <div class="bloco"><h3>${ESC(l.l.replace(/^\(−\)\s*/, ""))} <small>${MOEDA(Math.abs(l.v))}</small></h3>
      <table class="comp"><thead><tr><th>Item</th><th>Valor</th><th>% da linha</th><th>% receita</th><th>vs ${ESC(d.comparado)}</th></tr></thead><tbody>
      ${l.grupos.map((g) => `<tr><td>${ESC(g.nome)}${g.tag ? ` <span class="tag">${ESC(g.tag)}</span>` : ""}${g.maiorAlta ? ' <span class="tag alta">maior alta</span>' : ""}
          <span class="mini"><i style="width:${Math.min(g.share || 0, 1) * 100}%;background:${COR[l.cor] || "#8a7766"}"></i></span>
          ${g.itens && g.itens.length ? `<div class="itens">${g.itens.slice(0, 5).map((i) => `${ESC(i.nome)}${i.qtd > 1 ? ` (${i.qtd}x)` : ""} ${MOEDA(i.valor)}`).join(" · ")}${g.itens.length > 5 ? ` · +${g.itens.length - 5} itens` : ""}</div>` : ""}</td>
        <td>${MOEDA(g.valor)}</td><td>${PCT(g.share)}</td><td>${PCT(g.av)}</td><td>${g.pv ? VAR((g.valor - g.pv) / Math.abs(g.pv)) : g.pv === 0 && g.valor ? "novo" : "—"}</td></tr>`).join("")}
      </tbody></table></div>`).join("");

  const leituras = [...(d.leituras || []).map((t) => ESC(t)), ...(d.indicativos || []).map((i) => `<b>${ESC(i.titulo)}.</b> ${ESC(i.texto)}`)];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DRE ${ESC(d.loja)} — ${ESC(d.periodo)}</title>
<style>
@page{size:A4 portrait;margin:12mm 12mm 14mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Inter","Segoe UI",Roboto,Arial,sans-serif;color:#1f2523;font-size:11.5px;line-height:1.45;font-variant-numeric:tabular-nums}
.pagina{width:186mm;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f2523;padding-bottom:6px;margin-bottom:10px}
header h1{font-size:20px;margin:0;letter-spacing:-.01em}header .sub{color:#5f6964;font-size:12px}
header .dir{text-align:right;color:#5f6964;font-size:10.5px}
.take{font-size:13px;margin:0 0 10px;padding:8px 10px;background:#f3f5f2;border-left:3px solid #3e5c76}
.avisos{font-size:10.5px;color:#9a6a14;margin:0 0 8px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
.kpi{border:1px solid #e3e6e2;border-radius:6px;padding:6px 8px}
.kpi .r,.kpi .n{font-size:10px;color:#5f6964}.kpi .v{font-size:16px;font-weight:700;margin:2px 0}.kpi .d{font-size:10.5px;font-weight:600}
.bom{color:#3f7a4f}.ruim{color:#b5524a}.atn{color:#9a6a14}
h2{font-size:13px;margin:12px 0 6px}h3{font-size:12px;margin:0 0 4px}h3 small{font-weight:400;color:#5f6964}
.duas{display:grid;grid-template-columns:1fr;gap:8px}
.cem{display:flex;height:22px;gap:2px;border-radius:4px;overflow:hidden}.cem div{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600}
.leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10px;color:#5f6964;margin-top:4px}.leg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
table{width:100%;border-collapse:collapse}th{font-size:10px;font-weight:400;color:#5f6964;text-align:right;padding:4px 6px;border-bottom:1px solid #cfd4d0}
td{text-align:right;padding:4px 6px;border-bottom:1px solid #eceeea;vertical-align:top}th:first-child,td:first-child{text-align:left}
tr.t td{font-weight:700;background:#f3f5f2}tr.ref td{color:#5f6964;font-size:10.5px}
.pill{font-size:9.5px;font-weight:600;border:1px solid currentColor;border-radius:999px;padding:0 6px}
.quebra{break-before:page}
.bloco{break-inside:avoid;margin-bottom:10px}
.comp td{font-size:10.5px}.itens{font-size:9.5px;color:#5f6964;margin-top:2px;white-space:normal}
.mini{display:inline-block;width:46px;height:5px;border-radius:3px;background:#eceeea;margin-left:6px;vertical-align:middle;overflow:hidden}.mini i{display:block;height:100%}
.tag{font-size:8.5px;font-weight:700;border-radius:999px;padding:0 5px;background:#eceeea;color:#5f6964}.tag.alta{background:#fbf3e2;color:#9a6a14}
ol{margin:0;padding-left:16px}ol li{margin-bottom:4px}
footer{margin-top:10px;font-size:9.5px;color:#8a938d;border-top:1px solid #e3e6e2;padding-top:4px}
</style></head><body><div class="pagina">
<header><div><h1>DRE gerencial · ${ESC(d.loja)}</h1><div class="sub">${ESC(d.periodo)} · comparado com ${ESC(d.comparadoLongo || d.comparado)}</div></div>
  <div class="dir">App Gestão<br>Gerado em ${ESC(d.geradoEm)}</div></header>
${d.leituras && d.leituras[0] ? `<p class="take">${ESC(d.leituras[0])}</p>` : ""}
${(d.avisos || []).length ? `<p class="avisos">${d.avisos.map(ESC).join(" · ")}</p>` : ""}
<div class="kpis">${kpis}</div>
<h2>Como a receita vira resultado</h2>${svgCascata(d.cascata)}
<h2>Para onde vai cada R$ 100 vendidos</h2>${barraCem(d.cascata, d.receita)}
<h2>DRE do período</h2>
<table><thead><tr><th>Linha</th><th>Valor</th><th>AV</th><th>AH</th><th>Meta</th><th>Status</th></tr></thead><tbody>${linhas}</tbody></table>
<div class="quebra"></div>
<header><div><h1>Composição da DRE</h1><div class="sub">${ESC(d.loja)} · ${ESC(d.periodo)}</div></div><div class="dir">O que está dentro de cada linha</div></header>
${composicao || "<p>Sem composição disponível para este período.</p>"}
${leituras.length ? `<div class="bloco"><h2>Leituras do período</h2><ol>${leituras.map((t) => `<li>${t}</li>`).join("")}</ol></div>` : ""}
<footer>AV = peso na receita · AH = variação contra o período anterior · Simples calculado pela alíquota da loja · CMV = compras das categorias de matéria-prima no período.</footer>
</div></body></html>`;
}
