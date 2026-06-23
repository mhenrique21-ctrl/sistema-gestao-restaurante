import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MenuPage from './pages/MenuPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import OrderStatusPage from './pages/OrderStatusPage'
import OrdersPage from './pages/OrdersPage'
import LoginPage from './pages/LoginPage'
import BottomNav from './components/BottomNav'
import { useAuth } from './store/auth'

function PrivateRoute({ children }) {
  const { customer } = useAuth()
  return customer ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto relative">
        <Routes>
          <Route path="/" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<PrivateRoute><CheckoutPage /></PrivateRoute>} />
          <Route path="/order/:id" element={<OrderStatusPage />} />
          <Route path="/orders" element={<PrivateRoute><OrdersPage /></PrivateRoute>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
