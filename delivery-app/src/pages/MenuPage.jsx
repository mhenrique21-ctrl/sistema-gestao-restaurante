import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProductModal from '../components/ProductModal'
import { useCart, itemLineTotal } from '../store/cart'
import { useNavigate } from 'react-router-dom'
import hero from '../assets/hero.png'

const EMOJI = { 'Café': '☕', 'Bebidas': '🥤', 'Bolos': '🎂', 'Salgados': '🥐' }

function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function ProductThumb({ product, emoji }) {
  const [broken, setBroken] = useState(false)
  if (product.image_url && !broken) {
    return (
      <img
        src={product.image_url}
        alt={product.name}
        onError={() => setBroken(true)}
        className="w-16 h-16 rounded-xl object-cover flex-shrink-0 bg-gray-100"
      />
    )
  }
  return (
    <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0 text-gray-300">
      {emoji || '🍽'}
    </div>
  )
}

function ProductRow({ product, emoji, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-start gap-3 py-3 text-left press border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {product.promo_price != null && (
            <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">
              {product.promo_label || 'OFERTA'}
            </span>
          )}
          <p className="font-semibold text-gray-900 text-sm truncate">{product.name}</p>
        </div>
        {product.description && (
          <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{product.description}</p>
        )}
        {product.promo_price != null ? (
          <div className="flex items-center gap-1.5 mt-1">
            <p className="text-gray-400 text-xs line-through">{money(product.price)}</p>
            <p className="text-violet-600 font-bold text-sm">{money(product.promo_price)}</p>
          </div>
        ) : (
          <p className="text-gray-900 font-bold text-sm mt-1">{money(product.price)}</p>
        )}
      </div>
      <ProductThumb product={product} emoji={emoji} />
    </button>
  )
}

export default function MenuPage() {
  const [menu, setMenu] = useState([])
  const [storeName, setStoreName] = useState('Confraria Café')
  const [bannerUrl, setBannerUrl] = useState(null)
  const [logoUrl, setLogoUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(null)
  const [selected, setSelected] = useState(null) // { product, category }
  const [search, setSearch] = useState('')
  const catRefs = useRef({})
  const count = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0))
  const total = useCart((s) => s.items.reduce((sum, i) => sum + itemLineTotal(i), 0))
  const navigate = useNavigate()

  useEffect(() => {
    api.menu().then((data) => {
      setMenu(data)
      setActive(data[0]?.id)
    }).catch(console.error).finally(() => setLoading(false))
    api.settings().then((s) => {
      if (s.store_name) setStoreName(s.store_name)
      if (s.banner_image_url) setBannerUrl(s.banner_image_url)
      if (s.logo_url) setLogoUrl(s.logo_url)
    }).catch(() => {})
  }, [])

  function scrollTo(id) {
    setActive(id)
    catRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const filtered = search.trim()
    ? menu.map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) })).filter((c) => c.products.length > 0)
    : menu

  // Ofertas: produtos com preço promocional, exibidos como uma seção fixa no topo
  const offers = menu.flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name }))).filter((p) => p.promo_price != null)

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      {/* Capa + cartão da loja */}
      <div className="relative flex-shrink-0">
        <div className="h-28 w-full overflow-hidden safe-top">
          <img src={bannerUrl || hero} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        </div>
        <div className="relative -mt-6 mx-4 bg-white rounded-2xl shadow-md border border-gray-100 px-4 py-3 flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0 bg-gray-100" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-violet-600 text-white flex items-center justify-center text-xl flex-shrink-0">☕</div>
          )}
          <div className="min-w-0">
            <h1 className="font-bold text-gray-900 text-base truncate">{storeName}</h1>
            <p className="text-emerald-600 text-xs font-medium">● Aberto para pedidos</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar no cardápio..."
            className="w-full bg-gray-100 placeholder-gray-400 text-gray-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:bg-gray-50 focus:ring-2 focus:ring-violet-200"
          />
          <span className="absolute right-3 top-2.5 text-gray-400">🔍</span>
        </div>
      </div>

      {/* Category nav */}
      {!search && (
        <div className="bg-white px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
          {offers.length > 0 && (
            <button
              onClick={() => scrollTo('ofertas')}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all press ${
                active === 'ofertas' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              🔥 Ofertas
            </button>
          )}
          {menu.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollTo(cat.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all press ${
                active === cat.id ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'
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
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {/* Ofertas */}
            {!search && offers.length > 0 && (
              <div ref={(el) => (catRefs.current['ofertas'] = el)} className="px-4 pt-3">
                <h2 className="text-base font-bold text-gray-900 mb-1">Ofertas</h2>
                <div>
                  {offers.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      emoji={EMOJI[product.categoryName]}
                      onClick={() => setSelected({ product, category: product.categoryName })}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Categories */}
            {filtered.map((cat) => (
              <div key={cat.id} ref={(el) => (catRefs.current[cat.id] = el)} className="px-4 pt-3">
                <h2 className="text-base font-bold text-gray-900 mb-1">{cat.name}</h2>
                <div>
                  {cat.products.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      emoji={EMOJI[cat.name]}
                      onClick={() => setSelected({ product, category: cat.name })}
                    />
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
            <span className="font-bold">{money(total)}</span>
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
