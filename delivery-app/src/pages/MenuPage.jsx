import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProductModal from '../components/ProductModal'
import { useCart, itemLineTotal } from '../store/cart'
import { useNavigate } from 'react-router-dom'
import hero from '../assets/hero.png'
import { checkStoreOpen } from '../utils/storeStatus'

const CAT_ICONS = {
  'Café': '☕', 'Cafés': '☕', 'Bebidas': '🥤', 'Bolos': '🎂', 'Bolos e Tortas': '🎂',
  'Tortas': '🎂', 'Salgados': '🥐', 'Doces': '🍬', 'Tapiocas': '🫓',
  'Crepiocas': '🥞', 'Croissant': '🥐', 'Cuscuz': '🌽', 'Sanduíches': '🥪',
}

function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function ProductCard({ product, catName, onClick }) {
  const [broken, setBroken] = useState(false)
  const hasImg = product.image_url && !broken

  return (
    <button onClick={onClick} className="press w-full text-left flex items-center gap-3 py-4"
      style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex-1 min-w-0">
        {product.promo_price != null && (
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mb-1"
            style={{ background: 'rgba(201,162,94,0.15)', color: 'var(--gold)' }}>
            {product.promo_label || 'OFERTA'}
          </span>
        )}
        <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--cream)' }}>
          {product.name}
        </p>
        {product.description && (
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--muted)' }}>
            {product.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {product.promo_price != null ? (
            <>
              <span className="text-xs line-through" style={{ color: 'var(--muted)' }}>{money(product.price)}</span>
              <span className="font-bold text-sm" style={{ color: 'var(--gold)' }}>{money(product.promo_price)}</span>
            </>
          ) : (
            <span className="font-bold text-sm" style={{ color: 'var(--gold)' }}>{money(product.price)}</span>
          )}
        </div>
      </div>
      <div className="relative flex-shrink-0">
        {hasImg ? (
          <img src={product.image_url} alt={product.name} onError={() => setBroken(true)}
            className="w-20 h-20 rounded-2xl object-cover"
            style={{ border: '1px solid var(--border)' }} />
        ) : (
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            {CAT_ICONS[catName] || '🍽'}
          </div>
        )}
        <div className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-sm font-black shadow-lg press"
          style={{ background: 'var(--gold)', color: '#0F0F0F' }}>
          +
        </div>
      </div>
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
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [storeStatus, setStoreStatus] = useState({ open: true })
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
      setStoreStatus(checkStoreOpen(s.business_hours, s.special_dates))
    }).catch(() => {})
  }, [])

  function scrollTo(id) {
    setActive(id)
    catRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const filtered = search.trim()
    ? menu.map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) })).filter((c) => c.products.length > 0)
    : menu

  const offers = menu.flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name }))).filter((p) => p.promo_price != null)

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="flex-shrink-0 safe-top" style={{ background: 'var(--surface)' }}>
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Bem-vindo ao</p>
            <h1 className="text-lg font-black tracking-tight" style={{ color: 'var(--cream)' }}>{storeName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: storeStatus.open ? 'rgba(76,175,128,0.15)' : 'rgba(224,82,82,0.15)', color: storeStatus.open ? 'var(--green)' : 'var(--danger)' }}>
              ● {storeStatus.open ? 'Aberto' : (storeStatus.reason || 'Fechado')}
            </span>
            {logoUrl && (
              <img src={logoUrl} alt="" className="w-9 h-9 rounded-full object-cover" style={{ border: '1.5px solid var(--gold-dim)' }} />
            )}
          </div>
        </div>

        {/* Banner */}
        <div className="mx-4 mb-3 rounded-2xl overflow-hidden relative h-32">
          <img src={bannerUrl || hero} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(15,10,5,0.7) 0%, transparent 60%)' }} />
          <div className="absolute bottom-3 left-4">
            <p className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>Cardápio completo</p>
            <p className="text-sm font-black" style={{ color: 'var(--cream)' }}>Peça agora 🛵</p>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar no cardápio..."
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--cream)' }} />
          </div>
        </div>

        {/* Category pills */}
        {!search && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
            {offers.length > 0 && (
              <button onClick={() => scrollTo('ofertas')}
                className="flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold press transition-all"
                style={{ background: active === 'ofertas' ? 'var(--gold)' : 'var(--card)', color: active === 'ofertas' ? '#0F0F0F' : 'var(--muted)', border: '1px solid var(--border)' }}>
                🔥 Ofertas
              </button>
            )}
            {menu.map((cat) => (
              <button key={cat.id} onClick={() => scrollTo(cat.id)}
                className="flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold press transition-all"
                style={{ background: active === cat.id ? 'var(--gold)' : 'var(--card)', color: active === cat.id ? '#0F0F0F' : 'var(--muted)', border: '1px solid var(--border)' }}>
                {CAT_ICONS[cat.name] || '🍽'} {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Banner loja fechada */}
      {!storeStatus.open && (
        <div className="flex-shrink-0 mx-4 mt-3 rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid rgba(224,82,82,0.3)' }}>
          <span className="text-xl">🔒</span>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>Loja fechada no momento</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{storeStatus.reason || 'Fora do horário de funcionamento'}</p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-28">
        {loading ? (
          <div className="px-4 pt-4 space-y-4">
            {[1,2,3,4,5].map((i) => <div key={i} className="skeleton h-24" />)}
          </div>
        ) : (
          <>
            {!search && offers.length > 0 && (
              <div ref={(el) => (catRefs.current['ofertas'] = el)} className="px-4 pt-4">
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>🔥 Ofertas</p>
                {offers.map((p) => (
                  <ProductCard key={p.id} product={p} catName={p.categoryName} onClick={() => setSelected({ product: p, category: p.categoryName })} />
                ))}
              </div>
            )}
            {filtered.map((cat) => (
              <div key={cat.id} ref={(el) => (catRefs.current[cat.id] = el)} className="px-4 pt-4">
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>
                  {CAT_ICONS[cat.name] || '🍽'} {cat.name}
                </p>
                {cat.products.map((p) => (
                  <ProductCard key={p.id} product={p} catName={cat.name} onClick={() => setSelected({ product: p, category: cat.name })} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Floating cart */}
      {count > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-30">
          <button onClick={() => navigate('/cart')}
            className="btn-gold w-full py-4 flex items-center justify-between px-5 text-sm">
            <span className="w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs"
              style={{ background: 'rgba(0,0,0,0.2)' }}>{count}</span>
            <span className="font-black">Ver carrinho</span>
            <span className="font-bold">{money(total)}</span>
          </button>
        </div>
      )}

      {selected && (
        <ProductModal product={selected.product} category={selected.category} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
