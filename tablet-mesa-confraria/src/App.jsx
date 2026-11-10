import { useEffect, useState } from 'react';
import { useAppStore, iniciarMonitorDeInatividade } from './store/useAppStore';
import { useComandaStore } from './store/useComandaStore';
import { useMenuStore } from './store/useMenuStore';
import ComandaBar from './components/ComandaBar';
import RevisaoComanda from './components/RevisaoComanda';
import VitrineOverlay from './components/VitrineOverlay';
import GarcomToast from './components/GarcomToast';

import Abertura from './screens/Abertura';
import Cardapio from './screens/Cardapio';
import Sabores from './screens/Sabores';
import Adicionais from './screens/Adicionais';
import Busca from './screens/Busca';
import EscanearQR from './screens/EscanearQR';
import PedidoEnviado from './screens/PedidoEnviado';
import ErroEnvio from './screens/ErroEnvio';
import MeusPedidos from './screens/MeusPedidos';
import ContaSolicitada from './screens/ContaSolicitada';

const TELAS = {
  CARDAPIO: Cardapio,
  SABORES: Sabores,
  ADICIONAIS: Adicionais,
  BUSCA: Busca,
  ESCANEAR_QR: EscanearQR,
  PEDIDO_ENVIADO: PedidoEnviado,
  ERRO_ENVIO: ErroEnvio,
  MEUS_PEDIDOS: MeusPedidos,
  CONTA_SOLICITADA: ContaSolicitada,
};

// Telas que já têm sua própria comanda flutuante/rail — as demais (scan,
// sucesso, erro, sabores, adicionais) ocupam a tela toda, sem os dois juntos.
const TELAS_COM_COMANDA_BAR = new Set(['CARDAPIO']);

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const showVitrine = useAppStore((s) => s.showVitrine);
  const showGarcomToast = useAppStore((s) => s.showGarcomToast);
  const [revisaoAberta, setRevisaoAberta] = useState(false);
  const temItens = useComandaStore((s) => s.itens.length > 0);

  useEffect(() => iniciarMonitorDeInatividade(), []);
  useEffect(() => { useMenuStore.getState().carregar(); }, []);

  if (screen === 'BOOT') {
    return (
      <div className="w-screen h-screen bg-bg text-cream font-body overflow-hidden">
        <Abertura />
      </div>
    );
  }

  const Tela = TELAS[screen] || Cardapio;

  return (
    <div className="w-screen h-screen bg-bg text-cream font-body overflow-hidden relative flex flex-col">
      <Tela />

      {TELAS_COM_COMANDA_BAR.has(screen) && <ComandaBar onAbrirRevisao={() => setRevisaoAberta(true)} />}
      {/* Some sozinha ao sair de CARDAPIO ou quando a comanda esvazia (ex:
          depois do pedido confirmado) -- sem isso ficaria "aberta" e vazia
          por baixo da próxima vez que o cliente voltasse ao cardápio. */}
      {revisaoAberta && screen === 'CARDAPIO' && temItens && <RevisaoComanda onFechar={() => setRevisaoAberta(false)} />}
      {showVitrine && <VitrineOverlay />}
      {showGarcomToast && <GarcomToast />}
    </div>
  );
}
