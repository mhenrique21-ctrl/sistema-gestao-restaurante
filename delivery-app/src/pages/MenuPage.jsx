import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProductModal from '../components/ProductModal'
import { useCart, itemLineTotal } from '../store/cart'
import { useNavigate } from 'react-router-dom'
import hero from '../assets/hero.png'
import { checkStoreOpen } from '../utils/storeStatus'
import { trackViewOferta } from '../utils/metaPixel'

const CAT_ICONS = {
  'Café': '☕', 'Cafés': '☕', 'Bebidas': '🥤', 'Bolos': '🍰', 'Bolos e Tortas': '🍰',
  'Tortas': '🍰', 'Salgados': '🥐', 'Doces': '🍬', 'Tapiocas': '🫓',
  'Crepiocas': '🥞', 'Croissant': '🥐', 'Cuscuz': '🌽', 'Sanduíches': '🥪',
  'Coffee Shake': '🥤', 'Adicionais': '🍽', 'Ofertas': '🔥', 'Lanches': '🍕', 'Refeições': '🍽',
}

function money(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function ProductCard({ product, catName, onClick }) {
  const [broken, setBroken] = useState(false)
  const hasImg = product.image_url && !broken
  const offPct = product.promo_price != null
    ? Math.round((1 - product.promo_price / product.price) * 100)
    : null

  return (
    <button onClick={onClick}
      className="press card-soft w-full text-left flex gap-4 p-4 mb-3">
      <div className="flex-1 min-w-0 flex flex-col">
        {product.promo_price != null && (
          <span className="badge-soft badge-offer self-start mb-1.5">
            {product.promo_label || 'Oferta'}
          </span>
        )}
        <p className="font-bold text-[15px] leading-snug" style={{ color: 'var(--cream)' }}>
          {product.name}
        </p>
        {product.description && (
          <p className="text-xs mt-1 line-clamp-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
            {product.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-auto pt-2">
          {product.promo_price != null ? (
            <>
              <span className="text-xs line-through" style={{ color: 'var(--muted)' }}>{money(product.price)}</span>
              <span className="font-black text-[15px]" style={{ color: 'var(--gold-dim)' }}>{money(product.promo_price)}</span>
              {offPct > 0 && <span className="badge-soft badge-off">−{offPct}%</span>}
            </>
          ) : (
            <span className="font-black text-[15px]" style={{ color: 'var(--brown)' }}>{money(product.price)}</span>
          )}
        </div>
      </div>
      <div className="relative flex-shrink-0 self-center">
        {hasImg ? (
          <img src={product.image_url} alt={product.name} onError={() => setBroken(true)} loading="lazy"
            className="w-24 h-24 rounded-2xl object-cover"
            style={{ border: '1px solid var(--border)' }} />
        ) : (
          <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            {CAT_ICONS[catName] || '🍽'}
          </div>
        )}
        <div className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full flex items-center justify-center press"
          style={{
            background: 'linear-gradient(135deg,#C89B5A,#A97142)', color: '#fff',
            boxShadow: '0 4px 12px rgba(169,113,66,0.4)',
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
      const hasOffers = data.some((c) => c.products.some((p) => p.promo_price != null))
      setActive(hasOffers ? 'ofertas' : data.find((c) => c.name !== 'Ofertas')?.id)
    }).catch(console.error).finally(() => setLoading(false))
    api.settings().then((s) => {
      if (s.store_name) setStoreName(s.store_name)
      if (s.logo_url) setLogoUrl(s.logo_url)
      // Banner do dia: adminIndex = (jsDay + 6) % 7
      const adminIdx = (new Date().getDay() + 6) % 7
      const dayBanner = s.business_hours?.[adminIdx]?.banner_url
      setBannerUrl(dayBanner || s.banner_image_url || null)
      setStoreStatus(checkStoreOpen(s.business_hours, s.special_dates))
    }).catch(() => {})
  }, [])

  function scrollTo(id) {
    setActive(id)
    catRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const menuSemOfertas = menu.filter((c) => c.name !== 'Ofertas')
  const filtered = search.trim()
    ? menuSemOfertas.map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) })).filter((c) => c.products.length > 0)
    : menuSemOfertas

  const offers = menu.flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name }))).filter((p) => p.promo_price != null)

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Header premium ── */}
      <div className="flex-shrink-0 safe-top" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="px-5 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="w-11 h-11 rounded-full object-cover"
                style={{ border: '2px solid var(--card)', boxShadow: 'var(--shadow-soft)' }} />
            ) : (
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl"
                style={{ background: 'var(--card)', boxShadow: 'var(--shadow-soft)' }}>☕</div>
            )}
            <div>
              <h1 className="font-display text-xl font-bold leading-tight" style={{ color: 'var(--brown)' }}>{storeName}</h1>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ color: storeStatus.open ? 'var(--green)' : 'var(--danger)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                {storeStatus.open ? 'Aberto agora' : (storeStatus.reason || 'Fechado')}
              </span>
            </div>
          </div>
          <button onClick={() => navigate('/orders')} title="Meus pedidos"
            className="press w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'var(--card)', color: 'var(--brown)', boxShadow: 'var(--shadow-soft)' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </button>
        </div>

        {/* ── Hero banner ── */}
        <div className="mx-5 mb-4 rounded-3xl overflow-hidden relative"
          style={{ height: 148, boxShadow: 'var(--shadow-lift)' }}>
          <img src={bannerUrl || hero} alt="" className="w-full h-full object-cover" />
        </div>

        {/* ── Busca + WhatsApp ── */}
        <div className="px-5 pb-4 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-3 px-5 rounded-full"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', height: 48, boxShadow: 'var(--shadow-soft)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar no cardápio"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--cream)' }} />
          </div>
          <a href="https://wa.me/5596974007410" target="_blank" rel="noopener noreferrer"
            title="Fale conosco no WhatsApp" className="press"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 48, height: 48, borderRadius: 999, flexShrink: 0,
              background: '#25D366', color: '#fff',
              boxShadow: '0 4px 14px rgba(37,211,102,0.35)',
            }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </a>
        </div>

        {/* ── Categorias ── */}
        {!search && (
          <div className="flex gap-2.5 px-5 pb-4 overflow-x-auto no-scrollbar">
            {offers.length > 0 && (
              <button onClick={() => scrollTo('ofertas')}
                className={`chip press ${active === 'ofertas' ? 'chip-active' : ''}`}>
                🔥 Ofertas
              </button>
            )}
            {menuSemOfertas.map((cat) => (
              <button key={cat.id} onClick={() => scrollTo(cat.id)}
                className={`chip press ${active === cat.id ? 'chip-active' : ''}`}>
                {CAT_ICONS[cat.name] || '🍽'} {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Aviso loja fechada */}
      {!storeStatus.open && (
        <div className="flex-shrink-0 mx-5 mt-4 rounded-3xl px-5 py-4 flex items-center gap-3 card-soft"
          style={{ borderColor: 'rgba(216,67,67,0.25)' }}>
          <span className="text-xl">🔒</span>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>Loja fechada no momento</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{storeStatus.reason || 'Fora do horário de funcionamento'}</p>
          </div>
        </div>
      )}

      {/* ── Produtos ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
        {loading ? (
          <div className="px-5 pt-5 space-y-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="skeleton h-28" />)}
          </div>
        ) : (
          <>
            {!search && offers.length > 0 && (
              <div ref={(el) => (catRefs.current['ofertas'] = el)} className="px-5 pt-6">
                <h2 className="font-display text-lg font-bold mb-3" style={{ color: 'var(--brown)' }}>🔥 Ofertas da semana</h2>
                {offers.map((p) => (
                  <ProductCard key={p.id} product={p} catName={p.categoryName} onClick={() => { trackViewOferta(p); setSelected({ product: p, category: p.categoryName }) }} />
                ))}
              </div>
            )}
            {filtered.map((cat) => (
              <div key={cat.id} ref={(el) => (catRefs.current[cat.id] = el)} className="px-5 pt-6">
                <h2 className="font-display text-lg font-bold mb-3" style={{ color: 'var(--brown)' }}>
                  {CAT_ICONS[cat.name] || '🍽'} {cat.name}
                </h2>
                {cat.products.map((p) => (
                  <ProductCard key={p.id} product={p} catName={cat.name} onClick={() => setSelected({ product: p, category: cat.name })} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Carrinho flutuante ── */}
      {count > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-md px-5 z-30">
          <button onClick={() => navigate('/cart')}
            className="btn-gold w-full py-3.5 flex items-center justify-between px-5 text-sm scale-in">
            <span className="relative">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
              <span className="absolute -top-2 -right-2 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
                style={{ background: '#fff', color: 'var(--brown)' }}>{count > 9 ? '9+' : count}</span>
            </span>
            <span className="flex flex-col items-center leading-tight">
              <span className="font-black">Ver carrinho</span>
              <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>{count} {count === 1 ? 'item' : 'itens'}</span>
            </span>
            <span className="flex items-center gap-1 font-black">
              {money(total)}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
          </button>
        </div>
      )}

      {selected && (
        <ProductModal product={selected.product} category={selected.category} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
