import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MenuPage from './pages/MenuPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import OrderStatusPage from './pages/OrderStatusPage'
import OrdersPage from './pages/OrdersPage'
import LoginPage from './pages/LoginPage'
import BottomNav from './components/BottomNav'
import { api } from './api'

export default function App() {
  useEffect(() => {
    api.settings().catch(() => {})
  }, [])

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col max-w-md mx-auto relative" style={{ background: 'var(--bg)' }}>
        <Routes>
          <Route path="/" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order/:id" element={<OrderStatusPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
