import { useNavigate } from 'react-router-dom'
import { useCart, itemLineTotal, itemUnitPrice } from '../store/cart'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { checkStoreOpen } from '../utils/storeStatus'
import { trackInitiateCheckout } from '../utils/metaPixel'

function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function CartPage() {
  const { items, updateQty, removeItem, clear } = useCart()
  const navigate = useNavigate()
  const subtotal = items.reduce((s, i) => s + itemLineTotal(i), 0)
  const [storeStatus, setStoreStatus] = useState({ open: true })

  useEffect(() => {
    api.settings().then((s) => setStoreStatus(checkStoreOpen(s.business_hours, s.special_dates))).catch(() => {})
  }, [])

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-5 px-8 pb-24" style={{ background: 'var(--bg)' }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl" style={{ background: 'var(--card)' }}>🛒</div>
        <h2 className="text-xl font-black" style={{ color: 'var(--cream)' }}>Carrinho vazio</h2>
        <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>Adicione itens do cardápio para continuar</p>
        <button onClick={() => navigate('/')} className="btn-gold px-8 py-3 text-sm">Ver cardápio</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="safe-top flex-shrink-0" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-4">
          <button onClick={() => navigate('/')} className="press w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--card)', color: 'var(--cream)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h1 className="flex-1 text-lg font-black" style={{ color: 'var(--cream)' }}>Meu Carrinho</h1>
          <button onClick={clear} className="text-xs font-semibold press" style={{ color: 'var(--danger)' }}>Limpar</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-52">
        <div className="px-4 pt-4 space-y-3">
          {items.map((item) => (
            <div key={item.key} className="rounded-2xl p-4 fade-in"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="flex gap-3">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: 'var(--surface)' }}>
                  {item.product.image_url
                    ? <img src={item.product.image_url} alt="" className="w-full h-full object-cover rounded-xl" />
                    : '☕'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm leading-snug" style={{ color: 'var(--cream)' }}>{item.product.name}</p>
                  {(item.addons || []).length > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--gold-dim)' }}>
                      {item.addons.map((a) => a.name).join(' · ')}
                    </p>
                  )}
                  {item.notes && (
                    <p className="text-xs mt-0.5 italic" style={{ color: 'var(--muted)' }}>"{item.notes}"</p>
                  )}
                  <p className="font-black text-sm mt-1" style={{ color: 'var(--gold)' }}>
                    {money(itemLineTotal(item))}
                  </p>
                </div>
                <button onClick={() => removeItem(item.key)} className="press flex-shrink-0" style={{ color: 'var(--muted)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{money(itemUnitPrice(item))} cada</span>
                <div className="flex items-center gap-3 px-2 py-1 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <button onClick={() => updateQty(item.key, item.qty - 1)}
                    className="w-7 h-7 flex items-center justify-center press text-lg font-bold"
                    style={{ color: 'var(--muted)' }}>−</button>
                  <span className="w-5 text-center font-black text-sm" style={{ color: 'var(--cream)' }}>{item.qty}</span>
                  <button onClick={() => updateQty(item.key, item.qty + 1)}
                    className="w-7 h-7 flex items-center justify-center press text-lg font-bold"
                    style={{ color: 'var(--gold)' }}>+</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Resumo */}
        <div className="mx-4 mt-4 rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="font-bold text-sm mb-3" style={{ color: 'var(--cream)' }}>Resumo do pedido</p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm" style={{ color: 'var(--muted)' }}>
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs" style={{ color: 'var(--muted)' }}>
              <span>Taxa de entrega</span>
              <span>Calculada no checkout</span>
            </div>
            <div className="gold-line" />
            <div className="flex justify-between font-black text-sm pt-1">
              <span style={{ color: 'var(--cream)' }}>Total</span>
              <span style={{ color: 'var(--gold)' }}>{money(subtotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-4 pb-4 safe-bottom z-50"
        style={{ background: 'var(--bg)' }}>
        {!storeStatus.open && (
          <div className="mb-2 rounded-xl px-4 py-2.5 flex items-center gap-2"
            style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid rgba(224,82,82,0.3)' }}>
            <span>🔒</span>
            <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
              Loja fechada — {storeStatus.reason || 'Fora do horário'}
            </p>
          </div>
        )}
        <button
          onClick={() => { if (!storeStatus.open) return; trackInitiateCheckout(items, subtotal); navigate('/checkout') }}
          disabled={!storeStatus.open}
          className="btn-gold w-full py-4 flex items-center justify-between px-5"
          style={!storeStatus.open ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>
          <span className="text-sm font-black">Finalizar pedido</span>
          <span className="text-sm font-black">{money(subtotal)}</span>
        </button>
      </div>
    </div>
  )
}
