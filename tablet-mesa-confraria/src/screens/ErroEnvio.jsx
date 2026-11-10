import { useState } from 'react';
import { MESA_ID, useComandaStore } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';
import { enviarPedido, ApiError } from '../lib/api';

// tipo === 'rede': esgotou os 3 retries do enviarPedido (ver api.js) — erro
// de conexão, não dá pra saber se o pedido chegou ou não. "Tentar de novo"
// reenvia DIRETO (mesma Idempotency-Key, mesma comanda já resolvida no scan
// anterior), sem pedir pra escanear o cartão de novo: é seguro reenviar
// porque o backend deduplica pela chave (ver comanda_orders).
// tipo === 'validacao': já veio uma resposta real do servidor (comanda
// fechada, produto indisponível etc.) — reenviar não muda o resultado, por
// isso não tem botão de "tentar de novo" automático aqui.
export default function ErroEnvio() {
  const iniciarScan = useAppStore((s) => s.iniciarScan);
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  const goTo = useAppStore((s) => s.goTo);
  const tipo = useAppStore((s) => s.tipo) || 'rede';
  const mensagem = useAppStore((s) => s.mensagem);
  const comandaResolvida = useAppStore((s) => s.comandaResolvida);
  const itens = useComandaStore((s) => s.itens);
  const clearItens = useComandaStore((s) => s.clearItens);
  const idempotencyKey = useComandaStore((s) => s.idempotencyKey);

  const [reenviando, setReenviando] = useState(false);

  async function tentarDeNovo() {
    if (!comandaResolvida) return iniciarScan('pedido'); // sem comanda guardada, só resta reescanear
    setReenviando(true);
    try {
      const resultado = await enviarPedido(comandaResolvida.id, itens, MESA_ID, idempotencyKey);
      clearItens();
      goTo('PEDIDO_ENVIADO', { total: resultado.order_total });
    } catch (e) {
      if (e instanceof ApiError) {
        goTo('ERRO_ENVIO', { tipo: 'validacao', mensagem: e.message, comandaResolvida });
      } else {
        goTo('ERRO_ENVIO', { tipo: 'rede', comandaResolvida });
      }
      setReenviando(false);
    }
  }

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
        {tipo === 'validacao'
          ? mensagem || 'Não foi possível confirmar seu pedido.'
          : 'Não conseguimos confirmar. Não peça de novo: chame o atendente.'}
      </div>
      <div className="mt-8 flex gap-3">
        <button onClick={voltarAoCardapio} className="bg-transparent border border-cream-soft/30 text-cream-soft font-body font-medium text-[14px] px-5 py-[14px] rounded-xl">
          Voltar à comanda
        </button>
        {tipo !== 'validacao' && (
          <button
            onClick={tentarDeNovo}
            disabled={reenviando}
            className="bg-gold border-none text-ink font-body font-semibold text-[14px] px-[26px] py-[14px] rounded-xl disabled:opacity-40 min-h-11"
          >
            {reenviando ? 'Tentando…' : 'Tentar de novo'}
          </button>
        )}
      </div>
      <div className="text-[11px] text-cream-soft opacity-60 mt-[22px]">Se continuar acontecendo, chame o garçom</div>
    </div>
  );
}
