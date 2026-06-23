import { NavLink } from 'react-router-dom'
import { useCart } from '../store/cart'

export default function BottomNav() {
  const count = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0))

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 flex safe-bottom z-40">
      {[
        { to: '/', icon: '🏠', label: 'Cardápio' },
        { to: '/cart', icon: '🛒', label: 'Carrinho', badge: count },
        { to: '/orders', icon: '📋', label: 'Pedidos' },
      ].map(({ to, icon, label, badge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors press ${
              isActive ? 'text-violet-600' : 'text-gray-400'
            }`
          }
        >
          <span className="relative text-xl leading-none mb-0.5">
            {icon}
            {badge > 0 && (
              <span className="absolute -top-1 -right-2 bg-violet-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </span>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
