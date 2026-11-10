import { useState } from 'react';
import Icon from '../components/Icon';
import { useAppStore } from '../store/useAppStore';
import { requestClose, ApiError } from '../lib/api';

function fmt(v) {
  return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}

// Histórico de verdade: vem de comanda.items, devolvido por
// /api/comandas/resolve/:code no momento do scan -- não é mais um log
// mantido localmente no tablet (isso não sobreviveria a um F5, e o mesmo
// cartão escaneado num tablet diferente não veria o pedido feito no outro).
export default function MeusPedidos() {
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  const goTo = useAppStore((s) => s.goTo);
  const comanda = useAppStore((s) => s.comandaResolvida);
  const [pedindoConta, setPedindoConta] = useState(false);
  const [erro, setErro] = useState('');

  if (!comanda) return null;
  const items = comanda.items || [];

  async function pedirConta() {
    setPedindoConta(true);
    setErro('');
    try {
      await requestClose(comanda.id);
      goTo('CONTA_SOLICITADA');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao solicitar a conta');
      setPedindoConta(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-4 px-[34px] pt-[26px] pb-[18px] border-b border-line">
        <button onClick={voltarAoCardapio} className="w-11 h-11 rounded-full bg-surface border border-line flex items-center justify-center text-cream shrink-0">
          <Icon path="M15 18l-6-6 6-6" strokeWidth={2} className="w-4 h-4" />
        </button>
        <div>
          <div className="font-display font-semibold text-[24px] text-cream">Meus pedidos</div>
          <div className="text-[12px] text-cream-soft mt-[3px]">Tudo que já foi enviado pra cozinha nesta visita</div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto px-[34px] py-2">
          {items.length === 0 ? (
            <div className="text-[13px] text-cream-soft mt-6">Nenhum pedido enviado ainda nesta visita.</div>
          ) : (
            items.map((it, i) => (
              <div key={i} className={`flex items-center justify-between py-2.5 ${i < items.length - 1 ? 'border-b border-line' : ''}`}>
                <div className="min-w-0">
                  <span className="font-display font-normal text-[15px] text-cream">{it.product_name}</span>
                  <span className="text-[12px] text-cream-soft ml-2">× {it.quantity}</span>
                  {it.addons?.length > 0 && (
                    <div className="text-[11.5px] text-cream-soft opacity-70 mt-0.5">{it.addons.map((a) => a.name).join(', ')}</div>
                  )}
                </div>
                <div className="font-price font-semibold [font-variant-numeric:tabular-nums] text-[14px] text-gold shrink-0 ml-3">{fmt(it.subtotal)}</div>
              </div>
            ))
          )}
        </div>

        <div className="w-[300px] shrink-0 bg-surface border-l border-line p-[26px] flex flex-col">
          <div className="text-[11.5px] text-cream-soft tracking-[.03em]">TOTAL CONSUMIDO</div>
          <div className="font-display font-semibold text-[32px] text-cream mt-2">{fmt(comanda.total)}</div>
          <div className="text-[12px] text-cream-soft mt-3.5 leading-relaxed">
            {items.length} {items.length === 1 ? 'item' : 'itens'} enviados. Quer fechar a conta agora?
          </div>
          {erro && <div className="text-[12px] text-err mt-2">{erro}</div>}
          {/* Sem novo scan aqui (seção 4.11): o cliente já escaneou o
              cartão pra chegar até "Meus pedidos". */}
          <button
            onClick={pedirConta}
            disabled={items.length === 0 || pedindoConta}
            className="mt-auto bg-gold border-none text-ink font-body font-semibold text-[14px] py-3.5 rounded-xl disabled:opacity-40 min-h-11"
          >
            {pedindoConta ? 'Solicitando…' : 'Pedir a conta'}
          </button>
        </div>
      </div>
    </div>
  );
}
