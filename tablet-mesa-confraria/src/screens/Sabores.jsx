import Icon from '../components/Icon';
import { useAppStore } from '../store/useAppStore';

function fmt(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// Comportamento crítico #4: lista SEM foto, texto puro. A foto só volta na
// tela de Adicionais, depois de escolher o sabor.
export default function Sabores() {
  const group = useAppStore((s) => s.activeGroup);
  const abrirAdicionais = useAppStore((s) => s.abrirAdicionais);
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);

  if (!group) return null;
  const disponiveis = (group.products || []).filter((p) => p.available);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-4 px-[34px] pt-[26px] pb-[18px] border-b border-line">
        <button onClick={voltarAoCardapio} className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-cream shrink-0">
          <Icon path="M15 18l-6-6 6-6" strokeWidth={2} className="w-4 h-4" />
        </button>
        <div>
          <div className="font-display font-semibold text-[24px] text-cream">{group.name}</div>
          <div className="text-[12px] text-cream-soft mt-[3px]">Escolha o sabor para personalizar</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[34px] pt-2 pb-6">
        {disponiveis.map((p, i) => (
          <button
            key={p.id}
            onClick={() => abrirAdicionais({ ...p, categoryId: group.id }, group)}
            className={`w-full flex items-center gap-4 py-4 px-1.5 text-left ${i < disponiveis.length - 1 ? 'border-b border-line' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-display font-medium text-[16px] text-cream">{p.name}</div>
              <div className="text-[12px] text-cream-soft opacity-75 mt-[3px]">{p.description}</div>
            </div>
            <div className="flex items-center gap-3.5 shrink-0">
              <span className="font-price font-semibold [font-variant-numeric:tabular-nums] text-[15px] text-gold whitespace-nowrap">{fmt(p.promo_price ?? p.price)}</span>
              <Icon path="M9 18l6-6-6-6" strokeWidth={2} className="w-4 h-4 text-cream-soft opacity-60" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
