function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Lista de sabores de uma categoria agrupada (Croissant, Tapioca, Crepioca).
 * Só nome + preço, sem foto individual — a foto representativa já apareceu
 * no card da categoria. Tocar um sabor abre o ProductModal daquele sabor.
 */
export default function FlavorSheet({ category, onPick, onClose }) {
  const products = category.products || []

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(61,42,26,0.45)' }} />

      <div className="slide-up relative w-full max-w-md rounded-t-3xl flex flex-col"
        style={{ background: 'var(--surface)', maxHeight: '86vh', boxShadow: '0 -12px 40px rgba(61,42,26,0.20)' }}
        onClick={(e) => e.stopPropagation()}>

        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-2xl font-bold leading-tight" style={{ color: 'var(--espresso)' }}>
              {category.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--tan)' }}>
              Escolha o sabor
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="press w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--bg)', color: 'var(--tan)', border: '1px solid var(--border)' }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-6">
          <div className="flex flex-col gap-2">
            {products.map((p) => {
              const price = p.promo_price ?? p.price
              return (
                <button key={p.id} onClick={() => onPick(p)}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left press w-full"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', minHeight: 60 }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--espresso)' }}>{p.name}</p>
                    {p.description && (
                      <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--tan-faint)' }}>{p.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      {p.promo_price != null && (
                        <p className="text-[11px] line-through leading-none" style={{ color: 'var(--tan-faint)' }}>{money(p.price)}</p>
                      )}
                      <p className="text-sm font-black" style={{ color: 'var(--gold)' }}>{money(price)}</p>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tan-faint)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
