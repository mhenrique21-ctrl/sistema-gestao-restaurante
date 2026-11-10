import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Carrinho de mesa é INSTÂNCIA SEPARADA do carrinho de delivery — chave de
// persist própria por mesa, pra nunca misturar comanda de mesas diferentes
// no mesmo tablet (ex: tablet reaproveitado, ou testes lado a lado).
function storageKeyForMesa(mesaId) {
  return `confraria-cart-mesa-${mesaId}`;
}

// A mesa é fixa por tablet (configurada uma vez, não muda a cada pedido) —
// ver PASSO 1 da spec. Por enquanto lida de uma constante; trocar pela
// config real do tablet quando o provisionamento for definido (URL ?mesa=N
// + localStorage, mesmo padrão do kiosk.html real).
export const MESA_ID = '07';

export const useComandaStore = create(
  persist(
    (set) => ({
      // { id, product_id, name, unitPrice, qty,
      //   addons: [{ addon_option_id, name, price, quantity }], subtotal }
      // addons carrega name/price pra recalcular localmente (ex: mudar
      // quantidade na revisão) -- na hora de enviar pro backend, api.js
      // reduz cada addon só a { addon_option_id, quantity }.
      itens: [],

      addItem: (item) => set((state) => ({ itens: [...state.itens, item] })),

      removeItem: (idx) => set((state) => ({ itens: state.itens.filter((_, i) => i !== idx) })),

      updateQty: (idx, qty) =>
        set((state) => ({
          itens: state.itens.map((it, i) => (i === idx ? { ...it, qty, subtotal: (it.unitPrice + addonsTotal(it.addons)) * qty } : it)),
        })),

      clearItens: () => set({ itens: [] }),
    }),
    { name: storageKeyForMesa(MESA_ID) }
  )
);

function addonsTotal(addons) {
  return (addons || []).reduce((s, a) => s + a.price * a.quantity, 0);
}

export function totalDe(itens) {
  return itens.reduce((s, it) => s + it.subtotal, 0);
}
