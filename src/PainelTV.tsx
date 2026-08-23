import React, { useEffect, useRef, useState } from "react";

// Página pública (sem login) do "Painel Ao Vivo" — CONFRARIA + SEAMA lado a
// lado, pra ficar aberta numa TV do salão/produção. Fica em /painel-tv/<token>,
// carregada via import() dinâmico em main.jsx — bundle próprio, não carrega o
// app inteiro. O token vai embutido no link (gerado/copiado dentro do app,
// em Cardápio TV → Painel Ao Vivo) e é a única credencial: sem ele (ou com
// um token velho, já trocado), o servidor recusa os dados em /api/painel-tv-dados.

type Agregado = {
  totalHoje: number;
  totalOntem: number;
  porHora: { hora: number; valor: number }[];
  canais: Record<string, number>;
  nRecibos: number;
  ticketMedio: number;
  comprasHoje: number;
};

const POLL_MS = 20 * 1000;
const CANAIS_LABEL: [string, string][] = [
  ["maquininha", "Maquininha"], ["dinheiro", "Dinheiro"], ["ifood", "iFood"],
  ["99food", "99Food"], ["delivery", "Delivery"], ["entregasClientes", "Entregas"],
];

const fmtMoney = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function PainelEmpresa({ nome, cor, ag }: { nome: string; cor: string; ag: Agregado | null }) {
  if (!ag) return (
    <div style={{ background: "#12151D", borderRadius: 16, padding: "18px 20px", borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: cor }}>{nome}</div>
      <div style={{ fontSize: 12, color: "#666C82", marginTop: 10 }}>Sem dados ainda hoje.</div>
    </div>
  );

  const deltaPct = ag.totalOntem > 0 ? ((ag.totalHoje - ag.totalOntem) / ag.totalOntem) * 100 : null;
  const canais = CANAIS_LABEL.map(([k, label]) => ({ label, v: ag.canais?.[k] || 0 })).filter(c => c.v > 0);
  const maxCanal = Math.max(...canais.map(c => c.v), 1);
  const porHora = ag.porHora || [];
  const temHora = porHora.length > 0;
  const picoRow = temHora ? porHora.reduce((m, x) => (x.valor > m.valor ? x : m), porHora[0]) : null;

  const chartW = 300, chartH = 64;
  let pathLine = "", pathArea = "";
  if (temHora) {
    const maxV = Math.max(...porHora.map(p => p.valor), 1);
    const pts = porHora.map((p, i) => {
      const x = porHora.length > 1 ? (i / (porHora.length - 1)) * chartW : 0;
      const y = chartH - 6 - (p.valor / maxV) * (chartH - 14);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    pathLine = pts.join(" ");
    pathArea = `M${pts[0]} L${pts.join(" L")} L${chartW},${chartH} L0,${chartH} Z`;
  }

  return (
    <div style={{ background: "#12151D", borderRadius: 16, padding: "18px 20px", borderTop: `3px solid ${cor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1, color: cor, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: cor, display: "inline-block" }} />{nome}
        </div>
        <div style={{ fontSize: 10.5, color: "#666C82" }}>{ag.nRecibos} recibo{ag.nRecibos !== 1 ? "s" : ""} hoje</div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 32, fontWeight: 700, color: "#EEF0F6" }}>{fmtMoney(ag.totalHoje)}</span>
        {deltaPct !== null && (
          <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: deltaPct >= 0 ? "#4ADE80" : "#F87171", background: deltaPct >= 0 ? "#4ADE8016" : "#F8717116" }}>
            {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}% vs ontem
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#666C82", marginBottom: 14 }}>Faturamento hoje</div>

      {temHora ? (
        <div style={{ marginBottom: 14 }}>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" style={{ width: "100%", height: 64, display: "block" }}>
            <defs>
              <linearGradient id={`grad-${nome}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={cor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={cor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={pathArea} fill={`url(#grad-${nome})`} />
            <polyline points={pathLine} fill="none" stroke={cor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#666C82", marginTop: 3 }}>
            <span>{porHora[0]?.hora}h</span><span>vendas por hora</span><span>{porHora[porHora.length - 1]?.hora}h</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#666C82", background: "#171B25", borderRadius: 8, padding: "10px 12px", marginBottom: 14, textAlign: "center" }}>
          Sem dado de venda por hora nessa empresa.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "#171B25", border: "1px solid #232838", borderRadius: 10, padding: "9px 10px" }}>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 15, fontWeight: 700, color: "#EEF0F6" }}>{fmtMoney(ag.ticketMedio)}</div>
          <div style={{ fontSize: 9.5, color: "#666C82", textTransform: "uppercase", letterSpacing: 0.5 }}>Ticket médio</div>
        </div>
        <div style={{ background: "#171B25", border: "1px solid #232838", borderRadius: 10, padding: "9px 10px" }}>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 15, fontWeight: 700, color: "#EEF0F6" }}>{picoRow ? `${picoRow.hora}h` : "—"}</div>
          <div style={{ fontSize: 9.5, color: "#666C82", textTransform: "uppercase", letterSpacing: 0.5 }}>Horário de pico</div>
        </div>
        <div style={{ background: "#171B25", border: "1px solid #232838", borderRadius: 10, padding: "9px 10px" }}>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 15, fontWeight: 700, color: "#EEF0F6" }}>{fmtMoney(ag.comprasHoje)}</div>
          <div style={{ fontSize: 9.5, color: "#666C82", textTransform: "uppercase", letterSpacing: 0.5 }}>Compras hoje</div>
        </div>
      </div>

      {canais.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: "#666C82", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>Por canal</div>
          {canais.map(c => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 11.5 }}>
              <span style={{ width: 80, flexShrink: 0, color: "#9AA0B4" }}>{c.label}</span>
              <div style={{ flex: 1, height: 7, background: "#171B25", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(c.v / maxCanal) * 100}%`, background: cor, borderRadius: 4 }} />
              </div>
              <span style={{ fontFamily: "ui-monospace,monospace", width: 82, textAlign: "right", fontWeight: 600, color: "#EEF0F6" }}>{fmtMoney(c.v)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function PainelTV({ token }: { token: string }) {
  const [dados, setDados] = useState<{ CONFRARIA: Agregado; SEAMA: Agregado } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(new Date());
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const timerRef = useRef<any>(null);

  const buscar = async () => {
    try {
      const r = await fetch(`/api/painel-tv-dados?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d?.error || "Link inválido ou expirado.");
        return;
      }
      const d = await r.json();
      setDados(d);
      setAtualizadoEm(new Date());
      setErro(null);
    } catch {
      // mantém os últimos dados na tela — não apaga por causa de uma falha de rede passageira
    }
  };

  useEffect(() => {
    buscar();
    timerRef.current = setInterval(buscar, POLL_MS);
    const clockTimer = setInterval(() => setAgora(new Date()), 1000);
    (navigator as any).wakeLock?.request?.("screen")?.catch(() => {});
    return () => { clearInterval(timerRef.current); clearInterval(clockTimer); };
  }, [token]);

  const secsAtras = atualizadoEm ? Math.max(0, Math.round((agora.getTime() - atualizadoEm.getTime()) / 1000)) : null;
  const totalGeral = dados ? dados.CONFRARIA.totalHoje + dados.SEAMA.totalHoje : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0A0C11", color: "#EEF0F6", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>📊 Painel Ao Vivo</h1>
            <span style={{ fontSize: 11.5, color: "#666C82" }}>CONFRARIA + SEAMA · hoje</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "#9AA0B4" }}>
            <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 600 }}>
              {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7, background: "#12151D", border: "1px solid #232838", borderRadius: 20, padding: "6px 12px 6px 10px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: erro ? "#F87171" : "#4ADE80", display: "inline-block" }} />
              <b style={{ color: erro ? "#F87171" : "#4ADE80" }}>{erro ? "Sem conexão" : "Ao vivo"}</b>
              {!erro && secsAtras !== null && <span>· atualizado há {secsAtras}s</span>}
            </span>
          </div>
        </div>

        {erro ? (
          <div style={{ background: "#12151D", border: "1px solid #232838", borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
            <div style={{ fontSize: 14, color: "#9AA0B4" }}>{erro}</div>
          </div>
        ) : (
          <>
            <div style={{ background: "linear-gradient(135deg,#171B25,#12151D)", border: "1px solid #2E3448", borderRadius: 16, padding: "18px 22px", marginBottom: 20, display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: "#666C82", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Faturamento consolidado hoje</div>
                <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 34, fontWeight: 700 }}>{fmtMoney(totalGeral)}</div>
              </div>
              <div style={{ display: "flex", gap: 22, marginLeft: "auto", flexWrap: "wrap", fontSize: 13 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "#E0A860", display: "inline-block" }} />CONFRARIA <b style={{ fontFamily: "ui-monospace,monospace" }}>{fmtMoney(dados?.CONFRARIA.totalHoje || 0)}</b></span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: "#4FC3A1", display: "inline-block" }} />SEAMA <b style={{ fontFamily: "ui-monospace,monospace" }}>{fmtMoney(dados?.SEAMA.totalHoje || 0)}</b></span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
              <PainelEmpresa nome="CONFRARIA" cor="#E0A860" ag={dados?.CONFRARIA || null} />
              <PainelEmpresa nome="SEAMA" cor="#4FC3A1" ag={dados?.SEAMA || null} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
