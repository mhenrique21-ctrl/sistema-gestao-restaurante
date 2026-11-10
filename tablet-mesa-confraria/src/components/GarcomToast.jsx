// Toast não-bloqueante (PASSO 5 / seção 3.5): nunca tela cheia, desliza do
// topo e some sozinho — o cardápio continua visível atrás.
export default function GarcomToast() {
  return (
    <div
      className="absolute top-[26px] left-1/2 -translate-x-1/2 z-50 bg-gold text-ink px-[22px] py-[13px] rounded-xl flex items-center gap-2.5 shadow-[0_14px_30px_rgba(0,0,0,.4)] animate-slideDown"
    >
      <span className="text-base">🔔</span>
      <div>
        <div className="font-body font-semibold text-[13.5px]">Garçom chamado!</div>
        <div className="text-[11.5px] opacity-75 font-medium">Ele chega até sua mesa em instantes</div>
      </div>
    </div>
  );
}
