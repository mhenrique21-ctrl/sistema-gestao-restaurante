import { useMemo, useState } from 'react'
import { useCart } from '../store/cart'
import { useNavigate } from 'react-router-dom'
import { trackAddToCart } from '../utils/metaPixel'

function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Grupos obrigatórios de escolha única e poucas opções (ex.: "Descartáveis")
// viram um seletor lado a lado — visualmente separado dos adicionais opcionais,
// que são somáveis e aparecem como lista vertical com stepper.
function isSegmented(group) {
  return group.required && group.max_select === 1 && group.options.length <= 3
}

function Stepper({ count, onDec, onInc, canInc }) {
  return (
    <div className="flex items-center flex-shrink-0 rounded-full"
      style={{ background: 'var(--bg)', border: '1px solid var(--border)', height: 44 }}>
      <button onClick={onDec} aria-label="Remover uma unidade"
        className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold press"
        style={{ color: 'var(--tan)' }}>−</button>
      <span className="w-6 text-center font-black text-sm" style={{ color: 'var(--espresso)' }}>{count}</span>
      <button onClick={onInc} disabled={!canInc} aria-label="Adicionar mais uma unidade"
        className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold press"
        style={{ color: canInc ? 'var(--gold)' : 'var(--tan)', opacity: canInc ? 1 : 0.35 }}>+</button>
    </div>
  )
}

export default function ProductModal({ product, onClose, onBack }) {
  const navigate = useNavigate()
  const addItem = useCart((s) => s.addItem)
  const cartItems = useCart((s) => s.items)
  const [qty, setQty] = useState(1)
  const [selected, setSelected] = useState({})
  const [notes, setNotes] = useState('')
  const [added, setAdded] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)

  const groups = useMemo(() => product.addon_groups || [], [product.addon_groups])

  function incOption(group, option) {
    setSelected((prev) => {
      const current = prev[group.id] || []
      // Escolha única com 1 unidade do produto: troca em vez de somar
      if (group.max_select === 1 && qty === 1) return { ...prev, [group.id]: [option.id] }
      if (current.length >= group.max_select * qty) return prev
      return { ...prev, [group.id]: [...current, option.id] }
    })
  }

  function decOption(group, option) {
    setSelected((prev) => {
      const current = prev[group.id] || []
      const idx = current.lastIndexOf(option.id)
      if (idx === -1) return prev
      return { ...prev, [group.id]: current.filter((_, i) => i !== idx) }
    })
  }

  const selectedAddons = useMemo(() => {
    const result = []
    for (const group of groups) {
      for (const id of selected[group.id] || []) {
        const opt = group.options.find((o) => o.id === id)
        if (opt) result.push(opt)
      }
    }
    return result
  }, [selected, groups])

  const missingRequired = groups.filter((g) => g.required && (selected[g.id] || []).length < g.min_select * qty)

  const promoLimit = product.promo_price != null ? product.promo_max_qty : null
  const alreadyInCart = promoLimit
    ? cartItems.filter((i) => i.product.id === product.id).reduce((s, i) => s + i.qty, 0)
    : 0
  const remainingPromo = promoLimit ? Math.max(0, promoLimit - alreadyInCart) : Infinity
  const qtyExceedsPromo = promoLimit != null && qty > remainingPromo
  const canAdd = missingRequired.length === 0 && !qtyExceedsPromo

  const unitPrice = (product.promo_price ?? product.price) + selectedAddons.reduce((s, a) => s + a.price, 0)
  const total = unitPrice * qty

  function handleAdd() {
    if (!canAdd) return
    addItem(product, qty, selectedAddons, notes)
    trackAddToCart(product, qty, unitPrice)
    setAdded(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(61,42,26,0.45)' }} />

      <div className="slide-up relative w-full max-w-md rounded-t-3xl flex flex-col"
        style={{ background: 'var(--surface)', maxHeight: '92vh', boxShadow: '0 -12px 40px rgba(61,42,26,0.20)' }}
        onClick={(e) => e.stopPropagation()}>

        {/* ── Corpo rolável ── */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
          </div>

          <div className="relative mx-5 mt-2">
            {product.image_url && !imgBroken ? (
              <div className="rounded-3xl overflow-hidden" style={{ height: 220, boxShadow: 'var(--shadow-soft)' }}>
                <img src={product.image_url} alt={product.name} onError={() => setImgBroken(true)}
                  className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="rounded-3xl h-36 flex items-center justify-center text-6xl"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>☕</div>
            )}
            {onBack && (
              <button onClick={onBack} aria-label="Voltar para os sabores"
                className="press absolute left-3 top-3 w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: 'var(--surface)', color: 'var(--espresso)', boxShadow: 'var(--shadow-lift)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
          </div>

          <div className="px-5 pt-4 pb-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="font-display text-2xl font-bold leading-tight flex-1" style={{ color: 'var(--espresso)' }}>{product.name}</h2>
              <button onClick={onClose} aria-label="Fechar"
                className="press w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--bg)', color: 'var(--tan)', border: '1px solid var(--border)' }}>✕</button>
            </div>

            {product.description && (
              <p className="text-sm mb-3" style={{ color: 'var(--tan)' }}>{product.description}</p>
            )}

            <div className="flex items-center gap-2 mb-6">
              {product.promo_price != null ? (
                <>
                  <span className="text-sm line-through" style={{ color: 'var(--tan-faint)' }}>{money(product.price)}</span>
                  <span className="text-2xl font-black" style={{ color: 'var(--gold)' }}>{money(product.promo_price)}</span>
                  <span className="badge-soft badge-offer">{product.promo_label || 'Oferta'}</span>
                </>
              ) : (
                <span className="text-2xl font-black" style={{ color: 'var(--espresso)' }}>{money(product.price)}</span>
              )}
            </div>

            {/* ── Grupos de adicionais ── */}
            {groups.map((group) => {
              const current = selected[group.id] || []
              const effectiveMax = group.max_select * qty
              const isMissing = group.required && current.length < group.min_select * qty
              const segmented = isSegmented(group)

              return (
                <div key={group.id} className="mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-sm font-bold" style={{ color: 'var(--espresso)' }}>{group.name}</p>
                    {group.required && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: isMissing ? 'rgba(216,67,67,0.15)' : 'rgba(67,160,71,0.15)', color: isMissing ? 'var(--danger)' : 'var(--green)' }}>
                        {isMissing ? 'Obrigatório' : '✓ Ok'}
                      </span>
                    )}
                    {!segmented && effectiveMax > 1 && (
                      <span className="text-[10px] ml-auto" style={{ color: 'var(--tan-faint)' }}>
                        {current.length}/{effectiveMax}
                      </span>
                    )}
                  </div>

                  {segmented ? (
                    /* Obrigatório de escolha única: opções lado a lado */
                    <div className="flex gap-2.5">
                      {group.options.map((opt) => {
                        const isSel = current.includes(opt.id)
                        return (
                          <button key={opt.id} onClick={() => setSelected((p) => ({ ...p, [group.id]: [opt.id] }))}
                            className="flex-1 rounded-2xl px-3 flex flex-col items-center justify-center gap-0.5 press"
                            style={{
                              minHeight: 56,
                              background: isSel ? 'var(--gold)' : 'var(--surface-2)',
                              color: isSel ? '#fff' : 'var(--tan)',
                              border: `1.5px solid ${isSel ? 'transparent' : 'var(--border)'}`,
                              boxShadow: isSel ? '0 4px 14px rgba(138,82,39,0.32)' : 'none',
                              transition: 'background .2s, color .2s, box-shadow .2s',
                            }}>
                            <span className="text-sm font-bold leading-tight text-center">{opt.name}</span>
                            {opt.price > 0 && (
                              <span className="text-[11px] font-semibold" style={{ color: isSel ? 'rgba(255,255,255,0.85)' : 'var(--tan-faint)' }}>
                                + {money(opt.price)}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    /* Opcionais: lista vertical de uma coluna com stepper */
                    <div className="flex flex-col gap-2">
                      {group.options.map((opt) => {
                        const count = current.filter((id) => id === opt.id).length
                        const canInc = current.length < effectiveMax || (group.max_select === 1 && qty === 1)
                        return (
                          <div key={opt.id}
                            className="flex items-center gap-3 rounded-2xl px-4 py-2.5"
                            style={{
                              background: count > 0 ? 'var(--gold-soft)' : 'var(--bg)',
                              border: `1px solid ${count > 0 ? 'rgba(138,82,39,0.28)' : 'var(--border)'}`,
                              minHeight: 60,
                              transition: 'background .2s, border-color .2s',
                            }}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--espresso)' }}>{opt.name}</p>
                              <p className="text-xs font-semibold mt-0.5" style={{ color: opt.price > 0 ? 'var(--gold)' : 'var(--tan-faint)' }}>
                                {opt.price > 0 ? `+ ${money(opt.price)}` : 'Grátis'}
                              </p>
                            </div>
                            {count > 0 ? (
                              <Stepper count={count} canInc={canInc}
                                onDec={() => decOption(group, opt)}
                                onInc={() => incOption(group, opt)} />
                            ) : (
                              <button onClick={() => incOption(group, opt)} aria-label={`Adicionar ${opt.name}`}
                                disabled={!canInc}
                                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 press"
                                style={{
                                  background: 'var(--surface)', color: 'var(--gold)',
                                  border: '1.5px solid var(--border)', opacity: canInc ? 1 : 0.35,
                                }}>
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Observação */}
            <div>
              <p className="text-sm font-bold mb-2" style={{ color: 'var(--espresso)' }}>Observação</p>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: sem açúcar, capricha no leite..."
                className="w-full text-sm px-5 rounded-2xl outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--espresso)', minHeight: 48 }} />
            </div>

            {promoLimit != null && (
              <p className="text-xs mt-3 text-center" style={{ color: remainingPromo > 0 ? 'var(--tan)' : 'var(--danger)' }}>
                {remainingPromo > 0
                  ? `Máx. ${promoLimit} unidade(s) no preço promocional${alreadyInCart > 0 ? ` (${alreadyInCart} já no carrinho)` : ''}`
                  : `Limite de ${promoLimit} unidade(s) na promoção já atingido no carrinho`}
              </p>
            )}
          </div>
        </div>

        {/* ── Rodapé fixo: quantidade + total ao vivo + adicionar ── */}
        <div className="flex-shrink-0 px-5 pt-3 pb-5 safe-bottom"
          style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', boxShadow: '0 -6px 20px rgba(61,42,26,0.06)' }}>
          {added ? (
            <div className="space-y-2.5 scale-in">
              <p className="text-center text-sm font-bold" style={{ color: 'var(--green)' }}>✓ Adicionado ao carrinho!</p>
              <button onClick={() => { onClose(); navigate('/checkout') }} className="btn-gold w-full" style={{ height: 56 }}>
                Finalizar Pedido
              </button>
              <button onClick={onClose} className="btn-outline press w-full" style={{ height: 48 }}>
                Continuar Comprando
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center flex-shrink-0 rounded-full"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', height: 56 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade"
                  className="w-11 h-11 ml-1 rounded-full flex items-center justify-center text-xl font-bold press"
                  style={{ color: 'var(--tan)' }}>−</button>
                <span className="w-7 text-center font-black text-base" style={{ color: 'var(--espresso)' }}>{qty}</span>
                <button onClick={() => setQty((q) => Math.min(remainingPromo, q + 1))}
                  disabled={qty >= remainingPromo} aria-label="Aumentar quantidade"
                  className="w-11 h-11 mr-1 rounded-full flex items-center justify-center text-xl font-bold press"
                  style={{ color: qty >= remainingPromo ? 'var(--tan)' : 'var(--gold)', opacity: qty >= remainingPromo ? 0.35 : 1 }}>+</button>
              </div>

              <button onClick={handleAdd} disabled={!canAdd}
                className="btn-gold flex-1 flex items-center justify-between px-5"
                style={{ height: 56 }}>
                {!canAdd && missingRequired.length ? (
                  <span className="text-sm font-black mx-auto">Escolha as opções obrigatórias</span>
                ) : qtyExceedsPromo ? (
                  <span className="text-sm font-black mx-auto">Limite da promoção atingido</span>
                ) : (
                  <>
                    <span className="text-sm font-black">Adicionar</span>
                    <span className="text-sm font-black">{money(total)}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
