import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useCart = create(
  persist(
    (set, get) => ({
      items: [],
      customer: null,
      deliveryType: 'delivery',
      address: null,

      addItem(product, qty = 1, extras = [], notes = '') {
        const key = `${product.id}-${extras.join(',')}-${notes}`
        const items = get().items
        const existing = items.find((i) => i.key === key)
        if (existing) {
          set({ items: items.map((i) => i.key === key ? { ...i, qty: i.qty + qty } : i) })
        } else {
          set({ items: [...items, { key, product, qty, extras, notes }] })
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
        return get().items.reduce((sum, i) => sum + i.product.price * i.qty, 0)
      },

      get count() {
        return get().items.reduce((sum, i) => sum + i.qty, 0)
      },
    }),
    { name: 'confraria-cart', partialize: (s) => ({ items: s.items, customer: s.customer }) }
  )
)
