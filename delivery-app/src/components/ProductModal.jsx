import { useMemo, useState } from 'react'
import { useCart } from '../store/cart'
import { useNavigate } from 'react-router-dom'
import { trackAddToCart } from '../utils/metaPixel'

function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ProductModal({ product, onClose }) {
  const navigate = useNavigate()
  const addItem = useCart((s) => s.addItem)
  const cartItems = useCart((s) => s.items)
  const [qty, setQty] = useState(1)
  const [selected, setSelected] = useState({})
  const [notes, setNotes] = useState('')
  const [added, setAdded] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)

  const groups = product.addon_groups || []

  function toggleOption(group, option) {
    const effectiveMax = group.max_select * qty
    setSelected((prev) => {
      const current = prev[group.id] || []
      const countThis = current.filter((id) => id === option.id).length
      if (qty === 1) {
        // Comportamento original: single-choice quando max=1
        if (group.max_select === 1) return { ...prev, [group.id]: countThis > 0 ? [] : [option.id] }
        if (countThis > 0) return { ...prev, [group.id]: current.filter((id) => id !== option.id) }
        if (current.length >= group.max_select) return prev
        return { ...prev, [group.id]: [...current, option.id] }
      }
      // Multi-unit: cada clique adiciona/remove uma instância da opção
      if (countThis > 0) {
        const idx = current.lastIndexOf(option.id)
        return { ...prev, [group.id]: current.filter((_, i) => i !== idx) }
      }
      if (current.length >= effectiveMax) return prev
      return { ...prev, [group.id]: [...current, option.id] }
    })
  }

  const selectedAddons = useMemo(() => {
    const result = []
    for (const group of groups) {
      const ids = selected[group.id] || []
      for (const id of ids) {
        const opt = group.options.find((o) => o.id === id)
        if (opt) result.push(opt)
      }
    }
    return result
  }, [selected, groups])

  const missingRequired = groups.filter((g) => g.required && (selected[g.id] || []).length < g.min_select)

  const promoLimit = product.promo_price != null ? product.promo_max_qty : null
  const alreadyInCart = promoLimit
    ? cartItems.filter((i) => i.product.id === product.id).reduce((s, i) => s + i.qty, 0)
    : 0
  const remainingPromo = promoLimit ? Math.max(0, promoLimit - alreadyInCart) : Infinity
  const qtyExceedsPromo = promoLimit != null && qty > remainingPromo

  const canAdd = missingRequired.length === 0 && !qtyExceedsPromo

  function handleAdd() {
    if (!canAdd) return
    addItem(product, qty, selectedAddons, notes)
    trackAddToCart(product, qty, unitPrice)
    setAdded(true)
  }

  const unitPrice = (product.promo_price ?? product.price) + selectedAddons.reduce((s, a) => s + a.price, 0)
  const total = (unitPrice * qty)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(46,42,38,0.45)' }} />
      <div className="slide-up relative w-full max-w-md rounded-t-3xl max-h-[92vh] overflow-y-auto no-scrollbar"
        style={{ background: 'var(--card)', boxShadow: '0 -12px 40px rgba(93,64,55,0.18)' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* Product image */}
        {product.image_url && !imgBroken ? (
          <div className="mx-5 mt-2 rounded-3xl overflow-hidden" style={{ height: 220, boxShadow: 'var(--shadow-soft)' }}>
            <img src={product.image_url} alt={product.name} onError={() => setImgBroken(true)}
              className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="mx-5 mt-2 rounded-3xl h-36 flex items-center justify-center text-6xl"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>☕</div>
        )}

        <div className="px-5 pt-4 pb-6">
          {/* Title + price */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="font-display text-2xl font-bold leading-tight flex-1" style={{ color: 'var(--brown)' }}>{product.name}</h2>
            <button onClick={onClose} className="press w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>✕</button>
          </div>

          {product.description && (
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>{product.description}</p>
          )}

          <div className="flex items-center gap-2 mb-5">
            {product.promo_price != null ? (
              <>
                <span className="text-sm line-through" style={{ color: 'var(--muted)' }}>{money(product.price)}</span>
                <span className="text-2xl font-black" style={{ color: 'var(--gold-dim)' }}>{money(product.promo_price)}</span>
                <span className="badge-soft badge-offer">{product.promo_label || 'Oferta'}</span>
              </>
            ) : (
              <span className="text-2xl font-black" style={{ color: 'var(--brown)' }}>{money(product.price)}</span>
            )}
          </div>

          {/* Addon groups */}
          {groups.map((group) => {
            const current = selected[group.id] || []
            const effectiveMax = group.max_select * qty
            const effectiveMin = group.min_select * qty
            const isMissing = group.required && current.length < effectiveMin
            return (
              <div key={group.id} className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-sm font-bold" style={{ color: 'var(--cream)' }}>{group.name}</p>
                  {group.required && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: isMissing ? 'rgba(224,82,82,0.15)' : 'rgba(76,175,128,0.15)', color: isMissing ? 'var(--danger)' : 'var(--green)' }}>
                      {isMissing ? 'Obrigatório' : '✓ Ok'}
                    </span>
                  )}
                  {qty > 1 && (
                    <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      {current.length}/{effectiveMax} bebidas
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((opt) => {
                    const countThis = current.filter((id) => id === opt.id).length
                    const isSel = countThis > 0
                    return (
                      <button key={opt.id} onClick={() => toggleOption(group, opt)}
                        className="px-4 py-2.5 rounded-full text-xs font-semibold press"
                        style={{
                          background: isSel ? 'linear-gradient(135deg,#C89B5A,#A97142)' : 'var(--bg)',
                          color: isSel ? '#fff' : 'var(--cream)',
                          border: `1px solid ${isSel ? 'transparent' : 'var(--border)'}`,
                          boxShadow: isSel ? '0 4px 12px rgba(169,113,66,0.3)' : 'none',
                          transition: 'background .2s, color .2s, box-shadow .2s, transform .15s',
                          minHeight: 44,
                        }}>
                        {opt.name}{countThis > 1 ? ` ×${countThis}` : ''}
                        {opt.price > 0 && (
                          <span style={{ color: isSel ? 'rgba(255,255,255,0.85)' : 'var(--muted)' }}> +{money(opt.price)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Notes */}
          <div className="mb-5">
            <p className="text-sm font-bold mb-2" style={{ color: 'var(--cream)' }}>Observação</p>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: sem açúcar, capricha no leite..."
              className="w-full text-sm px-5 py-3.5 rounded-2xl outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--cream)', minHeight: 48 }} />
          </div>

          {/* Qty + Add */}
          {added ? (
            <div className="space-y-3 scale-in">
              <p className="text-center text-sm font-bold" style={{ color: 'var(--green)' }}>✓ Adicionado ao carrinho!</p>
              <button onClick={() => { onClose(); navigate('/checkout') }} className="btn-gold w-full py-4 text-sm">
                Finalizar Pedido
              </button>
              <button onClick={onClose} className="btn-outline press w-full py-3.5 text-sm">
                Continuar Comprando
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-2 rounded-full"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', height: 52 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold press"
                  style={{ color: 'var(--muted)' }}>−</button>
                <span className="w-6 text-center font-black text-base" style={{ color: 'var(--brown)' }}>{qty}</span>
                <button onClick={() => setQty((q) => Math.min(remainingPromo, q + 1))}
                  disabled={qty >= remainingPromo}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold press"
                  style={{ color: qty >= remainingPromo ? 'var(--muted)' : 'var(--gold-dim)', opacity: qty >= remainingPromo ? 0.4 : 1 }}>+</button>
              </div>
              <button onClick={handleAdd} disabled={!canAdd}
                className="btn-gold flex-1 py-4 flex items-center justify-between px-5 text-sm">
                <span>{!canAdd && missingRequired.length ? 'Escolha opções' : qtyExceedsPromo ? 'Limite da promoção' : 'Adicionar'}</span>
                <span className="font-black">{money(total)}</span>
              </button>
            </div>
          )}
          {promoLimit != null && !added && (
            <p className="text-xs mt-2 text-center" style={{ color: remainingPromo > 0 ? 'var(--muted)' : 'var(--danger)' }}>
              {remainingPromo > 0
                ? `Máx. ${promoLimit} unidade(s) no preço promocional${alreadyInCart > 0 ? ` (${alreadyInCart} já no carrinho)` : ''}`
                : `Limite de ${promoLimit} unidade(s) na promoção já atingido no carrinho`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
