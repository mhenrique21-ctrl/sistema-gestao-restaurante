import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { MESA_ID, useComandaStore } from '../store/useComandaStore';
import { useAppStore } from '../store/useAppStore';
import { resolveComanda, enviarPedido, requestClose, ApiError } from '../lib/api';

const TEXTO_POR_PROPOSITO = {
  pedido: 'Aponte a câmera para o QR do seu cartão para confirmar o pedido',
  conta: 'Aponte a câmera para o QR do seu cartão para pedir a conta',
  'meus-pedidos': 'Aponte a câmera para o QR do seu cartão para ver seus pedidos',
};

// Câmera real (html5-qrcode, mesma lib do kiosk.html) lendo o QR do cartão
// físico -- sem campo de digitar o código à mão, de propósito: o código dá
// acesso à comanda de outra pessoa, e digitar não exige posse física do
// cartão (mesmo raciocínio já aplicado no kiosk.html real nesta sessão).
export default function EscanearQR() {
  const scanPurpose = useAppStore((s) => s.scanPurpose);
  const goTo = useAppStore((s) => s.goTo);
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  const itens = useComandaStore((s) => s.itens);
  const clearItens = useComandaStore((s) => s.clearItens);
  const idempotencyKey = useComandaStore((s) => s.idempotencyKey);

  const [erro, setErro] = useState('');
  const scannerRef = useRef(null);
  const resolvendoRef = useRef(false);

  async function processarCodigo(code) {
    if (!code || resolvendoRef.current) return;
    resolvendoRef.current = true;
    setErro('');
    try {
      const comanda = await resolveComanda(code);
      if (scanPurpose !== 'meus-pedidos' && comanda.status !== 'aberta') {
        setErro('Esta comanda já está fechada. Chame um atendente.');
        resolvendoRef.current = false;
        return;
      }

      if (scanPurpose === 'pedido') {
        try {
          const resultado = await enviarPedido(comanda.id, itens, MESA_ID, idempotencyKey);
          clearItens();
          goTo('PEDIDO_ENVIADO', { total: resultado.order_total });
        } catch (e) {
          // Itens continuam na comanda local (não limpamos o carrinho) --
          // comportamento crítico #6: nunca sugerir perda de dado. Guarda a
          // comanda já resolvida (comandaResolvida) pra tela de erro poder
          // reenviar DIRETO, sem pedir pra escanear o cartão de novo.
          if (e instanceof ApiError) {
            goTo('ERRO_ENVIO', { tipo: 'validacao', mensagem: e.message, comandaResolvida: comanda });
          } else {
            goTo('ERRO_ENVIO', { tipo: 'rede', comandaResolvida: comanda });
          }
        }
      } else if (scanPurpose === 'meus-pedidos') {
        goTo('MEUS_PEDIDOS', { comandaResolvida: comanda });
      } else if (scanPurpose === 'conta') {
        try {
          await requestClose(comanda.id);
          goTo('CONTA_SOLICITADA');
        } catch (e) {
          setErro(e instanceof ApiError ? e.message : 'Erro ao solicitar a conta');
          resolvendoRef.current = false;
        }
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Cartão não encontrado');
      resolvendoRef.current = false;
    }
  }

  useEffect(() => {
    let cancelado = false;
    const scanner = new window.Html5Qrcode('qr-reader-real');
    let cameraIniciada = false;
    scannerRef.current = scanner;
    scanner
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, (decodedText) => processarCodigo(decodedText), () => {})
      .then(() => { cameraIniciada = true; })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível abrir a câmera. Verifique a permissão do navegador.');
      });
    return () => {
      cancelado = true;
      // .stop() lança erro SÍNCRONO (não Promise rejeitada) quando a câmera
      // nunca chegou a iniciar (ex: permissão negada) -- só tentar parar o
      // que de fato começou, e ainda assim blindado com try/catch.
      if (!cameraIniciada) return;
      try {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      } catch (e) { /* já não estava rodando -- nada a fazer */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full h-full relative flex flex-col items-center justify-center bg-[#0f0b08]">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0px, rgba(255,255,255,.02) 1px, transparent 1px, transparent 3px), linear-gradient(160deg, #14100c, #1c1610 60%, #14100c)',
        }}
      />

      <div className="relative z-[2] w-full flex items-center justify-between px-[34px] pt-7 absolute top-0">
        <button onClick={voltarAoCardapio} className="min-h-11 flex items-center gap-2 text-[13px] text-cream-soft px-1">
          <Icon path="M15 18l-6-6 6-6" strokeWidth={2} className="w-4 h-4" />
          Voltar ao cardápio
        </button>
        <div className="text-[11.5px] text-cream border border-cream/30 px-3 py-1.5 rounded-full">Mesa {MESA_ID}</div>
      </div>

      <div className="relative z-[2] w-[340px] h-[340px]">
        {/* html5-qrcode injeta o <video> aqui dentro -- id fixo que a lib espera. */}
        <div id="qr-reader-real" className="absolute inset-0 overflow-hidden rounded-2xl" />
        <div className="absolute inset-0 pointer-events-none">
          <span className="absolute w-11 h-11 border-[3px] border-gold top-0 left-0 border-r-0 border-b-0 rounded-tl-2xl" />
          <span className="absolute w-11 h-11 border-[3px] border-gold top-0 right-0 border-l-0 border-b-0 rounded-tr-2xl" />
          <span className="absolute w-11 h-11 border-[3px] border-gold bottom-0 left-0 border-r-0 border-t-0 rounded-bl-2xl" />
          <span className="absolute w-11 h-11 border-[3px] border-gold bottom-0 right-0 border-l-0 border-t-0 rounded-br-2xl" />
        </div>
      </div>

      <div className="relative z-[2] text-center mt-9 px-6">
        <div className="font-display font-semibold text-[24px] text-cream">Escaneie seu cartão</div>
        <div className="text-[13px] text-cream-soft mt-2 max-w-[38ch] mx-auto">
          {TEXTO_POR_PROPOSITO[scanPurpose] || TEXTO_POR_PROPOSITO.pedido}
        </div>
        {erro && <div className="text-[13px] text-err mt-3 max-w-[38ch] mx-auto">{erro}</div>}
      </div>
    </div>
  );
}
