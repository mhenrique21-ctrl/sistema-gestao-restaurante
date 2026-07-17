import { NavLink } from 'react-router-dom'
import { useCart } from '../store/cart'

const NAV = [
  { to: '/', label: 'Cardápio', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? 'var(--brown)' : 'var(--muted)'} strokeWidth={a ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )},
  { to: '/cart', label: 'Carrinho', badge: true, icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? 'var(--brown)' : 'var(--muted)'} strokeWidth={a ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  )},
  { to: '/orders', label: 'Pedidos', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? 'var(--brown)' : 'var(--muted)'} strokeWidth={a ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )},
]

export default function BottomNav() {
  const count = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0))

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 safe-bottom"
      style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid var(--border)', boxShadow: '0 -4px 20px rgba(93,64,55,0.06)' }}>
      <div className="flex">
        {NAV.map(({ to, label, icon, badge }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className="flex-1 flex flex-col items-center pt-2.5 pb-2 gap-1 text-[10px] font-bold tracking-wide press"
            style={{ minHeight: 56 }}>
            {({ isActive }) => (
              <>
                <span className="relative">
                  {icon(isActive)}
                  {badge && count > 0 && (
                    <span className="absolute -top-1.5 -right-2 text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--brown)', color: '#fff' }}>
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </span>
                <span style={{ color: isActive ? 'var(--brown)' : 'var(--muted)' }}>{label}</span>
                <span className="rounded-full transition-all duration-300"
                  style={{ width: isActive ? 16 : 0, height: 3, background: 'var(--gold)', opacity: isActive ? 1 : 0 }} />
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
