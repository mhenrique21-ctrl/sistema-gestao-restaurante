import { MESA_ID } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';

export default function ContaSolicitada() {
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center relative"
      style={{ backgroundImage: 'radial-gradient(ellipse at 50% 40%, rgba(207,154,79,.08), transparent 60%)' }}
    >
      <div className="absolute top-7 right-8 text-[11.5px] text-cream-soft border border-cream-soft/25 px-3 py-1.5 rounded-full">Mesa {MESA_ID}</div>
      <div className="w-[78px] h-[78px] rounded-full border-[1.5px] border-gold flex items-center justify-center mb-[26px] text-[30px]">🧾</div>
      <div className="font-display font-semibold text-[30px] text-cream">Conta solicitada!</div>
      <div className="text-[13.5px] text-cream-soft mt-2.5 text-center max-w-[38ch] leading-relaxed">
        O garçom já foi avisado e vai até sua mesa receber o pagamento 🙂
      </div>
      <button onClick={voltarAoCardapio} className="mt-9 bg-transparent border border-gold text-gold font-body font-semibold text-[13.5px] px-[26px] py-[13px] rounded-[11px]">
        Voltar ao cardápio
      </button>
    </div>
  );
}
