import React, { useEffect, useRef, useState } from "react";

// Página pública que a TV abre uma única vez e deixa aberta — sem login, sem
// o resto do app (que pesa ~1MB de bundle). Fica em /tv/<empresa> e é
// carregada via import() dinâmico em main.jsx, então o bundle dela sozinha é
// o único código que a TV baixa.

type Banner = {
  id: string;
  nome: string;
  arquivo: string;
  tipo?: "imagem" | "video";
  duracaoSeg: number;
  ativo: boolean;
  ordem: number;
  duasTelas?: boolean;
};

const DURACAO_PADRAO = 15;
const DURACAO_MAX_VIDEO_SEG = 90; // segurança: se onEnded/onError nunca disparar (vídeo travado), avança mesmo assim
const POLL_MS = 5 * 60 * 1000; // rede de segurança — o canal ao vivo (SSE) já cobre o caso normal em ~1s

export default function CardapioTV({ empresa, tela }: { empresa: string, tela?: string }) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [idx, setIdx] = useState(0);
  const [carregado, setCarregado] = useState(false);
  // Só vem preenchido quando esta tela está PAREADA com outra (ver Cardápio
  // TV → Telas → 🔗 Parear, no app) — diz qual metade de um banner "2 telas"
  // desenhar aqui.
  const [ladoPar, setLadoPar] = useState<"esquerda" | "direita" | null>(null);
  const timerRef = useRef<any>(null);

  const empLower = empresa.toLowerCase();
  const empLabel = empresa.toUpperCase();
  // "_default" nunca bate com o id de tela nenhuma — o servidor cai pra
  // primeira tela cadastrada, o que faz o link antigo sem tela continuar valendo.
  const telaId = tela || "_default";

  const buscar = async () => {
    try {
      const r = await fetch(`/api/cardapio-tv/${empLabel}/${telaId}`, { cache: "no-store" });
      const data = await r.json();
      const ativos = ((data?.banners || []) as Banner[])
        .filter(b => b.ativo)
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      setBanners(ativos);
      setLadoPar(data?.ladoPar || null);
    } catch {
      // mantém a lista anterior em caso de falha de rede — não apaga o que já estava passando
    } finally {
      setCarregado(true);
    }
  };

  useEffect(() => {
    buscar();
    const poll = setInterval(buscar, POLL_MS);
    // best-effort: evita a tela apagar em navegadores/TVs que suportam a API
    (navigator as any).wakeLock?.request?.("screen")?.catch(() => {});

    // Canal ao vivo: o servidor escreve aqui assim que o painel salva um
    // banner novo — busca a lista na hora, em vez de esperar o próximo poll.
    // EventSource reconecta sozinho se a conexão cair (comportamento nativo).
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/cardapio-tv-events/${empLabel}`);
      es.onmessage = () => buscar();
    } catch {}

    return () => { clearInterval(poll); es?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empLabel, telaId]);

  useEffect(() => {
    if (idx >= banners.length) setIdx(0);
  }, [banners, idx]);

  const pareada = !!ladoPar;
  const atual = banners[idx];
  const avancar = () => setIdx(i => (banners.length ? (i + 1) % banners.length : 0));

  // Modo normal (tela avulsa): imagem avança sozinha após duracaoSeg; vídeo
  // avança no onEnded (com teto de segurança, caso o vídeo trave sem terminar).
  useEffect(() => {
    if (pareada) return;
    clearTimeout(timerRef.current);
    if (!atual) return;
    const isVideo = atual.tipo === "video";
    const seg = isVideo ? DURACAO_MAX_VIDEO_SEG
      : ((atual.duracaoSeg && atual.duracaoSeg > 0) ? atual.duracaoSeg : DURACAO_PADRAO);
    timerRef.current = setTimeout(avancar, seg * 1000);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, banners, pareada]);

  // Modo pareado: esta TV e a parceira precisam mostrar o MESMO banner ao
  // mesmo tempo (uma desenha a metade esquerda de um banner "2 telas", a
  // outra a direita) — em vez de cada TV contar o próprio tempo a partir de
  // quando ligou (o que cedo ou tarde desencontra as duas), a posição atual
  // é calculada só a partir do relógio: Date.now() % duração total do ciclo.
  // Como as duas usam a MESMA lista de banners (espelhada no servidor ao
  // parear) e o mesmo relógio, chegam ao mesmo resultado sem trocar nenhuma
  // mensagem entre si.
  useEffect(() => {
    if (!pareada || !banners.length) return;
    const dur = (b: Banner) => ((b.duracaoSeg && b.duracaoSeg > 0) ? b.duracaoSeg : DURACAO_PADRAO) * 1000;
    const totalMs = banners.reduce((s, b) => s + dur(b), 0);
    if (!totalMs) return;
    const calcular = () => {
      let t = Date.now() % totalMs;
      for (let i = 0; i < banners.length; i++) {
        const d = dur(banners[i]);
        if (t < d) return i;
        t -= d;
      }
      return 0;
    };
    setIdx(calcular());
    const t = setInterval(() => setIdx(i => { const n = calcular(); return n === i ? i : n; }), 500);
    return () => clearInterval(t);
  }, [pareada, banners]);

  // "contain" mostra a imagem/vídeo INTEIRO, sem cortar nada — quando a
  // proporção não bate exatamente com a da TV, sobra uma faixa preta nas
  // bordas (que se confunde com o fundo #000 do container) em vez de cortar
  // pedaço da imagem como "cover" fazia.
  const mediaStyle: React.CSSProperties = {
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
    animation: "cardapiotv-fadein .6s ease",
  };
  // Banner "2 telas": a imagem/vídeo é o dobro da largura da tela, deslocado
  // meio-a-meio — cada lado do par mostra só sua metade (mesmo truque do
  // mockup aprovado: width 200% + left 0%/-100%). Aqui continua "cover" de
  // propósito: um banner panorâmico precisa preencher a largura dupla sem
  // faixa preta no meio, senão o corte no meio da tela fica visível.
  const ocupaDuas = pareada && !!atual?.duasTelas;
  const cropStyle: React.CSSProperties = {
    position: "absolute", top: 0, height: "100%", width: "200%",
    left: ladoPar === "esquerda" ? "0%" : "-100%",
    objectFit: "cover", animation: "cardapiotv-fadein .6s ease",
  };

  // ?debug=1 no link mostra o estado real que ESTA tela recebeu do servidor
  // — sem isso, numa TV de verdade não tem como abrir o DevTools pra
  // conferir se o pareamento/flag "2 telas" chegou certinho.
  const debug = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000", overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <style>{`@keyframes cardapiotv-fadein{from{opacity:0}to{opacity:1}}`}</style>
      {atual && (
        atual.tipo === "video"
          ? <video key={atual.id} src={`/banners/${empLower}/${atual.arquivo}`}
              autoPlay muted playsInline loop={pareada}
              onEnded={pareada ? undefined : avancar} onError={pareada ? undefined : avancar}
              style={ocupaDuas ? cropStyle : mediaStyle} />
          : <img key={atual.id} src={`/banners/${empLower}/${atual.arquivo}`} alt={atual.nome} style={ocupaDuas ? cropStyle : mediaStyle} />
      )}
      {carregado && !banners.length && (
        <div style={{ color: "#fff", textAlign: "center", fontFamily: "-apple-system,sans-serif" }}>
          <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 10, opacity: 0.9 }}>{empLabel}</div>
          <div style={{ fontSize: 16, opacity: 0.5 }}>Nenhum banner cadastrado ainda — suba um em Cardápio TV, no app de gestão.</div>
        </div>
      )}
      {banners.length > 1 && (
        <div style={{ position: "absolute", bottom: 24, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 8 }}>
          {banners.map((b, i) => (
            <div key={b.id} style={{
              width: 36, height: 4, borderRadius: 2,
              background: i === idx ? "#fff" : "rgba(255,255,255,0.3)", transition: "background .2s",
            }} />
          ))}
        </div>
      )}
      {debug && (
        <div style={{
          position: "absolute", top: 10, left: 10, background: "#000000cc", color: "#0f0",
          fontFamily: "ui-monospace,monospace", fontSize: 13, lineHeight: 1.6, padding: "10px 12px",
          borderRadius: 8, border: "1px solid #0f04", zIndex: 999, whiteSpace: "pre",
        }}>
          {`empresa: ${empLabel}\ntela: ${telaId}\npareada: ${pareada ? "sim" : "não"}\nladoPar: ${ladoPar || "—"}\nbanners: ${banners.length}\nidx atual: ${idx}\nbanner atual: ${atual?.nome || "—"}\nduasTelas: ${atual?.duasTelas ? "sim" : "não"}\nocupaDuas (renderizando cortado): ${ocupaDuas ? "SIM" : "não"}`}
        </div>
      )}
    </div>
  );
}
