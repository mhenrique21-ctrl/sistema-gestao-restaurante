import { useComandaStore, totalDe } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';
import Icon from './Icon';

function fmt(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// Não existe mockup próprio pra essa tela — a spec descreve a transição
// ("comanda flutuante → expande para revisão → Enviar pedido") em prosa, sem
// arquivo visual dedicado. Montada seguindo o mesmo sistema (superfície,
// Fraunces nos nomes, JetBrains Mono nos preços) em vez de inventar um estilo novo.
export default function RevisaoComanda({ onFechar }) {
  const itens = useComandaStore((s) => s.itens);
  const updateQty = useComandaStore((s) => s.updateQty);
  const removeItem = useComandaStore((s) => s.removeItem);
  const iniciarScan = useAppStore((s) => s.iniciarScan);
  const total = totalDe(itens);

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/50" onClick={onFechar}>
      <div
        className="w-full max-w-[660px] bg-surface border border-line rounded-t-2xl max-h-[70%] flex flex-col mb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-[26px] pt-6 pb-4 border-b border-line">
          <div className="font-display font-semibold text-[22px] text-cream">Sua comanda</div>
          <div className="text-[12px] text-cream-soft mt-1">Revise antes de enviar pra cozinha</div>
        </div>

        <div className="flex-1 overflow-y-auto px-[26px] py-3">
          {itens.map((it, idx) => (
            <div key={idx} className="flex items-center justify-between py-3 border-b border-line last:border-none">
              <div className="min-w-0">
                <div className="font-display font-medium text-[15.5px] text-cream truncate">{it.name}</div>
                {it.addons?.length > 0 && (
                  <div className="text-[11.5px] text-cream-soft mt-0.5 truncate">
                    {it.addons.map((a) => (a.quantity > 1 ? `${a.quantity}x ${a.name}` : a.name)).join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 shrink-0 ml-3">
                <div className="flex items-center gap-1 bg-surface-2 rounded-full p-1">
                  <button className="w-11 h-11 rounded-full text-gold text-[15px]" onClick={() => (it.qty > 1 ? updateQty(idx, it.qty - 1) : removeItem(idx))}>−</button>
                  <span className="font-display font-semibold text-[14px] text-cream min-w-[14px] text-center">{it.qty}</span>
                  <button className="w-11 h-11 rounded-full text-gold text-[15px]" onClick={() => updateQty(idx, it.qty + 1)}>+</button>
                </div>
                <span className="font-price font-semibold [font-variant-numeric:tabular-nums] text-gold text-[14.5px] w-16 text-right">{fmt(it.subtotal)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="px-[26px] py-[18px] border-t border-line flex items-center justify-between">
          <div>
            <div className="text-[11px] text-cream-soft">TOTAL</div>
            <div className="font-display font-semibold text-[20px] text-cream mt-0.5">{fmt(total)}</div>
          </div>
          <div className="flex gap-3">
            <button onClick={onFechar} className="border border-cream-soft/30 text-cream-soft font-body font-medium text-[14px] px-5 py-[14px] rounded-xl">
              Continuar pedindo
            </button>
            <button
              onClick={() => iniciarScan('pedido')}
              className="bg-gold border-none text-ink font-body font-semibold text-[14px] px-6 py-[14px] rounded-xl flex items-center gap-2"
            >
              Enviar pedido
              <Icon path="M5 12h14M13 6l6 6-6 6" strokeWidth={2} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
