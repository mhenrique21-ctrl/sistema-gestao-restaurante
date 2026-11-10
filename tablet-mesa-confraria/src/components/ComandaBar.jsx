import { useComandaStore, totalDe } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';

function fmt(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// Pílula fixa no rodapé (PASSO 4). Some entirely quando a comanda está
// vazia -- a spec pede fundo neutro "não clicável" pro estado vazio, mas
// como não existe fluxo nenhum a fazer com comanda vazia, simplesmente não
// desenhar a barra é o equivalente direto e mais limpo.
export default function ComandaBar({ onAbrirRevisao }) {
  const itens = useComandaStore((s) => s.itens);
  const chamarGarcom = useAppStore((s) => s.chamarGarcom);
  if (!itens.length) return null;

  const total = totalDe(itens);

  return (
    <div className="absolute left-[216px] right-0 bottom-0 p-4 px-[34px] pb-5 flex justify-center">
      <div
        className="w-full max-w-[660px] rounded-2xl px-[14px] py-[13px] pl-5 flex items-center gap-3.5 shadow-[0_18px_40px_rgba(0,0,0,.5)]"
        style={{ background: 'linear-gradient(135deg, #cf9a4f, #a9793c)' }}
      >
        <button className="flex-1 text-left text-ink" onClick={onAbrirRevisao}>
          <div className="text-[11px] opacity-75 font-semibold">{itens.length} {itens.length === 1 ? 'item' : 'itens'} na comanda</div>
          <div className="font-display font-semibold text-[19px] mt-0.5">{fmt(total)}</div>
        </button>
        <button
          onClick={chamarGarcom}
          className="min-h-11 bg-ink/[.18] border border-ink/30 text-ink font-body font-semibold text-[13px] px-4 rounded-[11px] whitespace-nowrap"
        >
          🔔 Chamar garçom
        </button>
        <button
          onClick={onAbrirRevisao}
          className="min-h-11 bg-ink border-none text-cream font-body font-semibold text-[13.5px] px-5 rounded-[11px] whitespace-nowrap"
        >
          Enviar pedido
        </button>
      </div>
    </div>
  );
}
