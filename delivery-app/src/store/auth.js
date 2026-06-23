import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuth = create(
  persist(
    (set) => ({
      token: null,
      customer: null,

      login(token, customer) {
        localStorage.setItem('token', token)
        set({ token, customer })
      },

      logout() {
        localStorage.removeItem('token')
        set({ token: null, customer: null })
      },

      setCustomer(customer) { set({ customer }) },
    }),
    { name: 'confraria-auth' }
  )
)
