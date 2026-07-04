import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Preço unitário do item já somando os adicionais escolhidos
export function itemUnitPrice(item) {
  const addonsTotal = (item.addons || []).reduce((s, a) => s + a.price, 0)
  const base = item.product.promo_price ?? item.product.price
  return base + addonsTotal
}

// Total da linha (preço unitário com adicionais × quantidade)
export function itemLineTotal(item) {
  return itemUnitPrice(item) * item.qty
}

export const useCart = create(
  persist(
    (set, get) => ({
      items: [],
      customer: null,
      deliveryType: 'delivery',
      address: null,

      // addons: [{ id, name, price }]
      addItem(product, qty = 1, addons = [], notes = '') {
        const addonsKey = addons.map((a) => a.id).sort().join(',')
        const key = `${product.id}-${addonsKey}-${notes}`
        const items = get().items
        const existing = items.find((i) => i.key === key)
        if (existing) {
          set({ items: items.map((i) => i.key === key ? { ...i, qty: i.qty + qty } : i) })
        } else {
          set({ items: [...items, { key, product, qty, addons, notes }] })
        }
      },

      updateQty(key, qty) {
        if (qty <= 0) {
          set({ items: get().items.filter((i) => i.key !== key) })
        } else {
          set({ items: get().items.map((i) => i.key === key ? { ...i, qty } : i) })
        }
      },

      removeItem(key) {
        set({ items: get().items.filter((i) => i.key !== key) })
      },

      clear() { set({ items: [] }) },

      setCustomer(c) { set({ customer: c }) },
      setDeliveryType(t) { set({ deliveryType: t }) },
      setAddress(a) { set({ address: a }) },

      get total() {
        return get().items.reduce((sum, i) => sum + itemLineTotal(i), 0)
      },

      get count() {
        return get().items.reduce((sum, i) => sum + i.qty, 0)
      },
    }),
    { name: 'confraria-cart', partialize: (s) => ({ items: s.items, customer: s.customer }) }
  )
)

// Garante que o carrinho salvo seja recarregado logo no início (hidratação automática
// do persist nem sempre dispara a tempo em carregamentos completos da página)
useCart.persist.rehydrate()
