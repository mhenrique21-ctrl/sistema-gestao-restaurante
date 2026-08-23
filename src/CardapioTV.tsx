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
};

const DURACAO_PADRAO = 15;
const DURACAO_MAX_VIDEO_SEG = 90; // segurança: se onEnded/onError nunca disparar (vídeo travado), avança mesmo assim
const POLL_MS = 3 * 60 * 1000; // rebusca a lista a cada 3min — banner novo aparece sem tocar na TV

export default function CardapioTV({ empresa }: { empresa: string }) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [idx, setIdx] = useState(0);
  const [carregado, setCarregado] = useState(false);
  const timerRef = useRef<any>(null);

  const empLower = empresa.toLowerCase();
  const empLabel = empresa.toUpperCase();

  const buscar = async () => {
    try {
      const r = await fetch(`/api/cardapio-tv/${empLabel}`, { cache: "no-store" });
      const data = await r.json();
      const ativos = ((data?.banners || []) as Banner[])
        .filter(b => b.ativo)
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      setBanners(ativos);
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
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empLabel]);

  useEffect(() => {
    if (idx >= banners.length) setIdx(0);
  }, [banners, idx]);

  const atual = banners[idx];
  const avancar = () => setIdx(i => (banners.length ? (i + 1) % banners.length : 0));

  // Imagem: avança sozinha após duracaoSeg. Vídeo: quem avança é onEnded (com
  // um teto de segurança aqui embaixo, caso o vídeo trave sem nunca terminar).
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!atual) return;
    const isVideo = atual.tipo === "video";
    const seg = isVideo ? DURACAO_MAX_VIDEO_SEG
      : ((atual.duracaoSeg && atual.duracaoSeg > 0) ? atual.duracaoSeg : DURACAO_PADRAO);
    timerRef.current = setTimeout(avancar, seg * 1000);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, banners]);

  const mediaStyle: React.CSSProperties = {
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
    animation: "cardapiotv-fadein .6s ease",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000", overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <style>{`@keyframes cardapiotv-fadein{from{opacity:0}to{opacity:1}}`}</style>
      {atual && (
        atual.tipo === "video"
          ? <video key={atual.id} src={`/banners/${empLower}/${atual.arquivo}`}
              autoPlay muted playsInline onEnded={avancar} onError={avancar} style={mediaStyle} />
          : <img key={atual.id} src={`/banners/${empLower}/${atual.arquivo}`} alt={atual.nome} style={mediaStyle} />
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
    </div>
  );
}
