import { create } from 'zustand';
import { useComandaStore } from './useComandaStore';

// State machine da spec (seção 2). VITRINE por inatividade e o toast de
// garçom NÃO fazem parte disso — são overlays sobre a tela atual, não
// substituem `screen` (ver seção 3.1 e 3.5: "não navega").
export const useAppStore = create((set, get) => ({
  screen: 'BOOT', // BOOT | CARDAPIO | SABORES | ADICIONAIS | BUSCA | ESCANEAR_QR | PEDIDO_ENVIADO | ERRO_ENVIO | MEUS_PEDIDOS | CONTA_SOLICITADA
  activeCategoryId: 'cafes',
  activeGroup: null, // categoria "sabores" aberta (Croissants & Tapiocas)
  activeProduct: null, // produto/sabor aberto na tela de Adicionais
  scanPurpose: null, // 'pedido' | 'conta' | 'meus-pedidos'
  comandaResolvida: null, // comanda real devolvida por /api/comandas/resolve/:code após o scan
  searchQuery: '',

  showVitrine: false, // overlay de inatividade
  showGarcomToast: false, // overlay do toast "Garçom chamado"

  goTo: (screen, patch = {}) => set({ screen, ...patch }),

  selectCategory: (id) => set({ activeCategoryId: id, searchQuery: '' }),

  abrirSabores: (group) => set({ activeGroup: group, screen: 'SABORES' }),

  // `group` só deve vir preenchido quando a chamada partiu da tela de
  // Sabores -- sem isso, um `activeGroup` de uma visita anterior ficava
  // "grudado" e mandava o cliente de volta pro grupo errado depois de
  // adicionar um item aberto pela Busca ou pela grade normal.
  abrirAdicionais: (product, group = null) => set({ activeProduct: product, activeGroup: group, screen: 'ADICIONAIS' }),

  voltarAoCardapio: () =>
    set({
      screen: 'CARDAPIO', activeGroup: null, activeProduct: null, scanPurpose: null,
      comandaResolvida: null, searchQuery: '',
      // Limpa o que ERRO_ENVIO/PEDIDO_ENVIADO guardaram via goTo(screen, patch)
      // -- sem isso, um valor de uma visita anterior "vazava" pra próxima vez
      // que essas telas aparecessem.
      tipo: null, mensagem: null, total: null,
    }),

  iniciarBusca: () => set({ screen: 'BUSCA', searchQuery: '' }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  // Gera a Idempotency-Key AQUI (uma vez por tentativa de pedido), antes de
  // escanear -- cobre tanto o scan novo quanto o "Tentar de novo" da tela de
  // erro, que também passa por aqui (ensureIdempotencyKey só gera se ainda
  // não tiver uma; ver useComandaStore).
  iniciarScan: (purpose) => {
    if (purpose === 'pedido') useComandaStore.getState().ensureIdempotencyKey();
    set({ scanPurpose: purpose, screen: 'ESCANEAR_QR' });
  },

  dispensarVitrine: () => set({ showVitrine: false }),

  chamarGarcom: () => {
    set({ showGarcomToast: true });
    setTimeout(() => set({ showGarcomToast: false }), 4000);
  },
}));

// Vitrine reaparece em loop de inatividade (45-60s), mesmo com comanda em
// andamento — decisão explícita do dono (seção 3.1). Roda fora da store
// (setInterval simples) e só ativa quando ninguém está no meio do fluxo de
// scan/QR, pra não interromper o cliente com a câmera aberta.
const IDLE_MS = 50_000; // meio-termo da faixa 45-60s pedida; ajustar quando o dono confirmar (pendência seção 6)
let idleTimer = null;

export function iniciarMonitorDeInatividade() {
  const resetar = () => {
    clearTimeout(idleTimer);
    const { screen } = useAppStore.getState();
    if (screen === 'ESCANEAR_QR' || screen === 'BOOT') return; // não interrompe scan em andamento
    idleTimer = setTimeout(() => {
      useAppStore.setState({ showVitrine: true });
    }, IDLE_MS);
  };
  ['pointerdown', 'touchstart'].forEach((ev) => window.addEventListener(ev, resetar));
  resetar();
  return () => {
    clearTimeout(idleTimer);
    ['pointerdown', 'touchstart'].forEach((ev) => window.removeEventListener(ev, resetar));
  };
}
