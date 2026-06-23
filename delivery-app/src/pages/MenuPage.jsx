import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProductModal from '../components/ProductModal'
import { useCart } from '../store/cart'
import { useNavigate } from 'react-router-dom'

const EMOJI = { 'Café': '☕', 'Bebidas': '🥤', 'Bolos': '🎂', 'Salgados': '🥐' }

export default function MenuPage() {
  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(null)
  const [selected, setSelected] = useState(null) // { product, category }
  const [search, setSearch] = useState('')
  const catRefs = useRef({})
  const count = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0))
  const total = useCart((s) => s.items.reduce((sum, i) => sum + i.product.price * i.qty, 0))
  const navigate = useNavigate()

  useEffect(() => {
    api.menu().then((data) => {
      setMenu(data)
      setActive(data[0]?.id)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  function scrollTo(id) {
    setActive(id)
    catRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const filtered = search.trim()
    ? menu.map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) })).filter((c) => c.products.length > 0)
    : menu

  // Sugestões: primeiros 4 produtos com preço menor
  const suggestions = menu.flatMap((c) => c.products).sort((a, b) => a.price - b.price).slice(0, 4)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="bg-violet-600 safe-top text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-violet-200 text-xs">Bem-vindo à</p>
            <h1 className="text-2xl font-bold">☕ Confraria</h1>
          </div>
          <span className="text-2xl">🏪</span>
        </div>
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar no cardápio..."
            className="w-full bg-white/20 placeholder-white/70 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:bg-white/30"
          />
          <span className="absolute right-3 top-2.5 text-white/70">🔍</span>
        </div>
      </div>

      {/* Category nav */}
      {!search && (
        <div className="bg-white border-b border-gray-100 px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar">
          {menu.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollTo(cat.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all press ${
                active === cat.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              <span>{EMOJI[cat.name] || '🍽'}</span>
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-32 no-scrollbar">
        {loading ? (
          <div className="p-4 space-y-4">
            {[1,2,3,4].map((i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            {/* Sugestões */}
            {!search && suggestions.length > 0 && (
              <div className="px-4 pt-4 pb-2">
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">⚡ Sugestões</h2>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                  {suggestions.map((p) => {
                    const cat = menu.find((c) => c.products.some((x) => x.id === p.id))
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelected({ product: p, category: cat?.name })}
                        className="flex-shrink-0 w-36 bg-white rounded-2xl p-3 shadow-sm border border-gray-100 text-left press"
                      >
                        <div className="w-full h-16 bg-violet-50 rounded-xl flex items-center justify-center text-3xl mb-2">
                          {EMOJI[cat?.name] || '🍽'}
                        </div>
                        <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2">{p.name}</p>
                        <p className="text-violet-600 font-bold text-sm mt-1">
                          {p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Categories */}
            {filtered.map((cat) => (
              <div key={cat.id} ref={(el) => (catRefs.current[cat.id] = el)} className="px-4 pt-4">
                <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>{EMOJI[cat.name] || '🍽'}</span>
                  {cat.name}
                  <span className="text-xs font-normal text-gray-400 ml-auto">{cat.products.length} itens</span>
                </h2>
                <div className="space-y-2">
                  {cat.products.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => setSelected({ product, category: cat.name })}
                      className="w-full bg-white rounded-2xl p-3 flex items-center gap-3 shadow-sm border border-gray-100 text-left press"
                    >
                      <div className="w-16 h-16 bg-violet-50 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">
                        {EMOJI[cat.name] || '🍽'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">{product.name}</p>
                        <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{product.description}</p>
                        <p className="text-violet-600 font-bold text-sm mt-1">
                          {product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-xl flex-shrink-0">
                        +
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Floating cart button */}
      {count > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-30">
          <button
            onClick={() => navigate('/cart')}
            className="w-full bg-violet-600 text-white rounded-2xl p-4 flex items-center justify-between shadow-xl press active:bg-violet-700"
          >
            <span className="bg-violet-500 rounded-xl px-2 py-0.5 text-sm font-bold">{count}</span>
            <span className="font-bold">Ver carrinho</span>
            <span className="font-bold">
              {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </button>
        </div>
      )}

      {selected && (
        <ProductModal
          product={selected.product}
          category={selected.category}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
