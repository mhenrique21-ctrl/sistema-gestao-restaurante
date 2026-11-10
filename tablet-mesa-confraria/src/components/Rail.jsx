import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { MESA_ID } from '../store/useComandaStore';

// Rail de 216px com as categorias — ver PASSO 3 da spec: ícones lineares
// empilhados, categoria ativa com barra dourada de 2px + fundo surface-2.
// O indicador de overflow (seção 4.3 / totem_acabamento_detalhes.html) só
// aparece quando a lista realmente não cabe, nunca por decoração.
// `categories` vem de fora (useMenuStore) -- dado real, não mock local.
export default function Rail({ activeCategoryId, categories, onSelect, dimmed = false }) {
  const scrollRef = useRef(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const checar = () => {
      const faltaRolar = el.scrollHeight - el.clientHeight - el.scrollTop;
      setHasOverflow(faltaRolar > 4);
    };
    checar();
    el.addEventListener('scroll', checar);
    window.addEventListener('resize', checar);
    return () => {
      el.removeEventListener('scroll', checar);
      window.removeEventListener('resize', checar);
    };
  }, []);

  return (
    <div className="w-[216px] shrink-0 bg-surface border-r border-line flex flex-col pt-[30px] pb-5 relative">
      <div className="font-display font-medium text-[14.5px] text-cream px-[26px] pb-5 border-b border-line mb-2">
        Mesa {MESA_ID}
        <span className="block font-body text-[10.5px] text-gold mt-1 tracking-[.03em]">CONFRARIA CAFÉ</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {categories.map((cat) => {
          const active = cat.id === activeCategoryId;
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`w-full flex items-center gap-[11px] font-display font-normal text-[15.5px] text-left px-[26px] py-[13px] relative transition-opacity
                ${active ? 'text-cream bg-surface-2' : 'text-cream-soft'}
                ${dimmed && !active ? 'opacity-55' : ''}`}
            >
              {active && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-gold" />}
              <Icon path={cat.iconPath} className="w-[17px] h-[17px] opacity-80 shrink-0" />
              {cat.name}
            </button>
          );
        })}
      </div>

      {hasOverflow && (
        <div className="pointer-events-none absolute left-0 right-0 bottom-[52px] h-11 bg-gradient-to-b from-transparent to-surface flex items-end justify-center pb-1.5">
          <Icon path="M6 9l6 6 6-6" strokeWidth={2} className="w-4 h-4 text-gold opacity-80 animate-railBounce" />
        </div>
      )}

      <div className="mt-auto pt-[18px] px-[26px] border-t border-line">
        <div className="text-[10px] text-cream-soft opacity-60 tracking-[.04em]">TORRA PRÓPRIA · CONFRARIA</div>
      </div>
    </div>
  );
}
