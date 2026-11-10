import { useEffect } from 'react';
import Icon from '../components/Icon';
import { MESA_ID } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';

// Aparece só no ligar do tablet / reset de mesa pelo garçom (seção 4.1).
export default function Abertura() {
  const goTo = useAppStore((s) => s.goTo);

  useEffect(() => {
    const t = setTimeout(() => goTo('CARDAPIO'), 1800);
    return () => clearTimeout(t);
  }, [goTo]);

  return (
    <div
      className="w-full h-full flex items-center justify-center relative"
      style={{ backgroundImage: 'radial-gradient(ellipse at 50% 40%, rgba(207,154,79,.07), transparent 60%)' }}
    >
      <div className="absolute top-7 right-8 text-[11.5px] text-cream-soft border border-cream-soft/25 px-3 py-1.5 rounded-full">
        Mesa {MESA_ID}
      </div>

      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-[26px] border border-gold rounded-full flex items-center justify-center">
          <Icon path="M4 8h13a3 3 0 0 1 0 6h-1M4 8v7a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2M4 8V5" className="w-[26px] h-[26px] text-gold" />
        </div>
        <div className="font-display font-normal text-[15px] tracking-[.28em] text-cream-soft mb-2.5">CONFRARIA</div>
        <div className="font-display font-semibold text-[44px] text-cream">Café</div>
        <div className="mt-[46px] flex items-center justify-center gap-2">
          <span className="w-[5px] h-[5px] rounded-full bg-gold opacity-35" />
          <span className="w-[5px] h-[5px] rounded-full bg-gold opacity-65" />
          <span className="w-[5px] h-[5px] rounded-full bg-gold opacity-100" />
        </div>
      </div>
    </div>
  );
}
