import { MESA_ID } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';

// Comportamento crítico #6: nunca sugerir perda de dados — os itens
// continuam na comanda, o texto reforça isso explicitamente.
// Ainda não há um gatilho automático de falha real (câmera/envio não
// integrados nesta rodada, ver EscanearQR.jsx) — a tela existe pronta pra
// quando a integração real puder disparar esse estado.
export default function ErroEnvio() {
  const iniciarScan = useAppStore((s) => s.iniciarScan);
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center relative"
      style={{ backgroundImage: 'radial-gradient(ellipse at 50% 40%, rgba(165,69,63,.08), transparent 60%)' }}
    >
      <div className="absolute top-7 right-8 text-[11.5px] text-cream-soft border border-cream-soft/25 px-3 py-1.5 rounded-full">Mesa {MESA_ID}</div>
      <div className="w-[78px] h-[78px] rounded-full border-[1.5px] border-err flex items-center justify-center mb-[26px]">
        <svg viewBox="0 0 24 24" fill="none" stroke="#a5453f" strokeWidth="2" className="w-[30px] h-[30px]">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="font-display font-semibold text-[28px] text-cream text-center px-6">Não conseguimos enviar seu pedido</div>
      <div className="text-[13.5px] text-cream-soft mt-2.5 text-center max-w-[38ch] leading-relaxed">
        Pode ter sido a conexão. Seus itens continuam salvos na comanda — nada foi perdido.
      </div>
      <div className="mt-8 flex gap-3">
        <button onClick={voltarAoCardapio} className="bg-transparent border border-cream-soft/30 text-cream-soft font-body font-medium text-[14px] px-5 py-[14px] rounded-xl">
          Voltar à comanda
        </button>
        <button onClick={() => iniciarScan('pedido')} className="bg-gold border-none text-ink font-body font-semibold text-[14px] px-[26px] py-[14px] rounded-xl">
          Tentar novamente
        </button>
      </div>
      <div className="text-[11px] text-cream-soft opacity-60 mt-[22px]">Se continuar acontecendo, chame o garçom</div>
    </div>
  );
}
