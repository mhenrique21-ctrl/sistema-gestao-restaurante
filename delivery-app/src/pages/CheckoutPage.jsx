import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { useCart, itemLineTotal } from '../store/cart'
import { api } from '../api'
import { trackPurchase } from '../utils/metaPixel'

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null

function PaymentIcon({ id }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (id === 'pix') return (
    <svg {...common}>
      <rect x="7" y="7" width="10" height="10" rx="3" transform="rotate(45 12 12)" />
    </svg>
  )
  if (id === 'dinheiro') return (
    <svg {...common}>
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M5.5 9v0M18.5 15v0" />
    </svg>
  )
  if (id === 'cartao_credito') return (
    <svg {...common}>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </svg>
  )
  if (id === 'cartao_debito') return (
    <svg {...common}>
      <path d="M12 3l9 6.5H3L12 3z" />
      <path d="M4 21h16" />
      <path d="M6 10v8M11 10v8M13 10v8M18 10v8" />
    </svg>
  )
  if (id === 'apple_pay') return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.462 2.16-1.203 2.883-.813.822-2.13 1.446-3.246 1.362-.14-1.107.437-2.269 1.145-2.966.79-.833 2.144-1.474 3.304-1.279zm4.632 16.18c-.518 1.176-1.145 2.352-2.03 3.394-.782.918-1.607 1.82-2.878 1.845-1.246.024-1.652-.72-3.081-.72-1.43 0-1.884.696-3.06.744-1.226.048-2.16-1.014-2.946-1.926-1.607-1.87-2.833-5.293-1.19-7.598.814-1.14 2.266-1.865 3.845-1.89 1.203-.024 2.335.792 3.06.792.727 0 2.098-.98 3.539-.836.603.024 2.297.24 3.386 1.82-.088.06-2.023 1.19-2 3.517.024 2.78 2.43 3.71 2.455 3.858z" />
    </svg>
  )
  return null
}

const PAYMENT_METHODS = [
  { id: 'pix',            label: 'PIX Online / Automático', desc: 'Pague via PIX após confirmar' },
  { id: 'dinheiro',       label: 'Dinheiro',          desc: 'Pague na entrega / retirada' },
  { id: 'cartao_credito', label: 'Cartão de Crédito', desc: 'Maquininha na entrega' },
  { id: 'cartao_debito',  label: 'Cartão de Débito',  desc: 'Maquininha na entrega' },
  { id: 'apple_pay',      label: 'Apple Pay',         desc: 'Cobrança online, na hora' },
]

function brl(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function onlyDigits(v) { return (v || '').replace(/\D/g, '') }

const INPUT = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  color: 'var(--cream)',
  borderRadius: 12,
  padding: '10px 14px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
}
const LABEL = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, display: 'block' }
const CARD = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, marginBottom: 12 }

function Section({ title, children }) {
  return (
    <div style={CARD}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginBottom: 14, letterSpacing: 1, textTransform: 'uppercase' }}>{title}</p>
      {children}
    </div>
  )
}

function PixBox({ pixKey, total }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(pixKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000) })
  }
  return (
    <div style={{ background: 'rgba(201,162,94,0.08)', border: '1px solid rgba(201,162,94,0.25)', borderRadius: 12, padding: 14, marginTop: 12 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>⚡ Chave PIX para pagamento</p>
      {total && <p style={{ fontSize: 18, fontWeight: 900, color: 'var(--gold)', marginBottom: 10 }}>{brl(total)}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', borderRadius: 10, padding: '8px 12px', border: '1px solid var(--border)' }}>
        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, color: 'var(--cream)', wordBreak: 'break-all' }}>{pixKey}</span>
        <button onClick={copy} className="press" style={{ background: 'var(--gold)', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
          {copied ? '✅ Copiado!' : '📋 Copiar'}
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Chave CNPJ — copie e cole no seu banco</p>
    </div>
  )
}

function StripePixBox({ qrCodeUrl, qrCodeData, total }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(qrCodeData).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000) })
  }
  return (
    <div style={{ background: 'rgba(201,162,94,0.08)', border: '1px solid rgba(201,162,94,0.25)', borderRadius: 12, padding: 14, marginTop: 12 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>⚡ Pague com PIX</p>
      {total && <p style={{ fontSize: 18, fontWeight: 900, color: 'var(--gold)', marginBottom: 10 }}>{brl(total)}</p>}
      {qrCodeUrl && (
        <img src={qrCodeUrl} alt="QR Code PIX" style={{ width: 200, height: 200, margin: '0 auto 10px', display: 'block', borderRadius: 8, background: '#fff', padding: 8 }} />
      )}
      {qrCodeData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', borderRadius: 10, padding: '8px 12px', border: '1px solid var(--border)' }}>
          <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, color: 'var(--cream)', wordBreak: 'break-all', maxHeight: 60, overflow: 'auto' }}>{qrCodeData}</span>
          <button onClick={copy} className="press" style={{ background: 'var(--gold)', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
            {copied ? '✅ Copiado!' : '📋 Copiar código'}
          </button>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Escaneie o QR ou copie o código — a confirmação é automática</p>
    </div>
  )
}

function buildWhatsAppMessage({ order, items, deliveryType, address, payment, total, deliveryFee, storeName, customerName, customerPhone }) {
  const sep = '─────────────────────'
  const lines = [
    `☕ *${storeName || 'Novo Pedido'}*`,
    `🧾 *Pedido #${order.order_number}*`, sep,
    `👤 *Cliente:* ${customerName}`,
    customerPhone ? `📱 *WhatsApp:* ${customerPhone}` : null, sep,
    '🛒 *Itens:*',
    ...items.map(i => [
      `  • *${i.qty}x* ${i.product.name}  →  ${brl(itemLineTotal(i))}`,
      ...(i.addons || []).map(a => `      ➕ ${a.name}`),
      i.notes ? `      📝 _${i.notes}_` : null,
    ]).flat().filter(Boolean),
    sep,
    deliveryType === 'retirada' ? '🏪 *Retirada no local*' : [
      '🛵 *Endereço de Entrega:*',
      `  📍 ${address.street}, ${address.number || 's/n'}`,
      `  🏘️ ${address.neighborhood}`,
      address.complement ? `  🏠 ${address.complement}` : null,
      `  🚚 Taxa: ${brl(deliveryFee)}`,
    ].filter(Boolean).join('\n'),
    sep,
    `💳 *Pagamento:* ${PAYMENT_METHODS.find(m => m.id === payment)?.label || payment}`, sep,
    `💰 *Total: ${brl(total)}*`,
    '', '_Confraria Café — obrigado! ☕_',
  ].flat().filter(v => v !== null)
  return lines.join('\n')
}

export default function CheckoutPage() {
  const navigate = useNavigate()
  const { items, clear } = useCart()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [payment, setPayment] = useState('pix')
  const [deliveryType, setDeliveryType] = useState('delivery')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [complement, setComplement] = useState('')
  const [notes, setNotes] = useState('')
  const [troco, setTroco] = useState('')
  const [coupon, setCoupon] = useState('')
  const [couponApplied, setCouponApplied] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [neighborhoods, setNeighborhoods] = useState([])
  const [settings, setSettings] = useState({ store_whatsapp_number: '', pix_key: '', store_name: '' })
  const [foundCustomer, setFoundCustomer] = useState(null)
  const [savedAddresses, setSavedAddresses] = useState([])
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [addingNewAddress, setAddingNewAddress] = useState(false)
  const [applePayError, setApplePayError] = useState('')
  const [applePayAvailable, setApplePayAvailable] = useState(null)
  const applePayButtonRef = useRef(null)
  const paymentRequestRef = useRef(null)
  const stripeRef = useRef(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [activePromo, setActivePromo] = useState(null)
  const [enabledCodes, setEnabledCodes] = useState(null) // null = ainda não carregou (mostra tudo)

  useEffect(() => {
    api.neighborhoods().then(setNeighborhoods).catch(() => setNeighborhoods([]))
    api.settings().then(setSettings).catch(() => {})
    api.getPromotions().then(setActivePromo).catch(() => {})
    api.paymentMethods()
      .then(list => setEnabledCodes(list.filter(m => m.active && m.code).map(m => m.code)))
      .catch(() => setEnabledCodes(null))
  }, [])

  // Na tela de sucesso do PIX, o pedido fica "aguardando_pagamento" até o webhook da
  // Asaas confirmar — sem isso o cliente via o QR parado, sem saber que já pagou.
  useEffect(() => {
    if (!success?.id || success.payment_method !== 'pix' || success.status !== 'aguardando_pagamento') return
    const poll = setInterval(() => {
      api.getOrder(success.id).then((fresh) => {
        if (fresh.status !== 'aguardando_pagamento') setSuccess((prev) => prev ? { ...prev, status: fresh.status } : prev)
      }).catch(() => {})
    }, 5000)
    return () => clearInterval(poll)
  }, [success?.id, success?.payment_method, success?.status])

  const availableMethods = enabledCodes === null
    ? PAYMENT_METHODS
    : PAYMENT_METHODS.filter(m => enabledCodes.includes(m.id))

  // "pix_auto" não é um método selecionável — é só um toggle admin pra ligar/desligar
  // o QR dinâmico da Asaas. Com ele desativado, o PIX usa só a chave manual.
  const pixAutoEnabled = enabledCodes?.includes('pix_auto') ?? false

  // Se a forma selecionada foi desativada pelo admin, troca pra primeira disponível
  useEffect(() => {
    if (availableMethods.length && !availableMethods.some(m => m.id === payment)) {
      setPayment(availableMethods[0].id)
    }
  }, [enabledCodes]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookupByPhone(phoneVal) {
    const digits = phoneVal.replace(/\D/g, '')
    if (digits.length < 8) { setFoundCustomer(null); setSavedAddresses([]); return }
    setLookingUp(true)
    try {
      const BASE = import.meta.env.VITE_API_URL || ''
      const r = await fetch(`${BASE}/api/delivery/lookup?phone=${digits}`)
      const data = await r.json()
      if (!data) { setFoundCustomer(null); setSavedAddresses([]); return }
      setFoundCustomer(data.customer)
      setSavedAddresses(data.addresses || [])
      const parts = (data.customer.name || '').split(' ')
      setFirstName(parts[0] || '')
      setLastName(parts.slice(1).join(' ') || '')
      if (data.addresses?.length > 0) {
        const first = data.addresses[0]
        setSelectedAddressId(first.id); setStreet(first.street || '')
        setNumber(first.number || ''); setNeighborhood(first.neighborhood || '')
        setComplement(first.complement || ''); setAddingNewAddress(false)
      }
    } catch (_) { setFoundCustomer(null) }
    finally { setLookingUp(false) }
  }

  function applyAddress(addr) {
    setSelectedAddressId(addr.id); setStreet(addr.street || '')
    setNumber(addr.number || ''); setNeighborhood(addr.neighborhood || '')
    setComplement(addr.complement || ''); setAddingNewAddress(false)
  }

  const bairrosPorZona = useMemo(() => {
    const g = {}
    for (const n of neighborhoods) { if (!g[n.zone]) g[n.zone] = []; g[n.zone].push(n) }
    return g
  }, [neighborhoods])

  function getTaxa(nome) {
    const found = neighborhoods.find(n => n.name === nome)
    return found ? found.delivery_fee : 0
  }

  const subtotal = items.reduce((s, i) => s + itemLineTotal(i), 0)
  // Subtotal apenas dos itens SEM promoção ativa (base para desconto de cupom)
  const subtotalSemPromo = items.reduce((s, i) => {
    if (i.product.promo_price != null) return s
    return s + itemLineTotal(i)
  }, 0)
  const deliveryFee = deliveryType === 'delivery' ? getTaxa(neighborhood) : 0

  // Verifica promoção aplicável agora (lado cliente, tempo real)
  const nowDay = new Date().getDay()
  const selectedNeighborhood = neighborhoods.find(n => n.name === neighborhood)
  const selectedZone = selectedNeighborhood?.zone?.toUpperCase() || null
  const applicablePromo = Array.isArray(activePromo) ? activePromo.find(p => {
    if (p.day_of_week?.length && !p.day_of_week.includes(nowDay)) return false
    if (subtotal < parseFloat(p.min_order_value)) return false
    if (p.zones?.length && selectedZone && !p.zones.includes(selectedZone)) return false
    return true
  }) : null
  const promoDiscount = applicablePromo
    ? applicablePromo.discount_type === 'free_delivery' ? deliveryFee
      : applicablePromo.discount_type === 'percent' ? subtotal * parseFloat(applicablePromo.discount_value) / 100
      : parseFloat(applicablePromo.discount_value)
    : 0

  const discount = couponApplied ? (couponApplied.discount ?? 0) : promoDiscount
  const total = subtotal + deliveryFee - discount
  const totalRef = useRef(total)

  async function applyCoupon() {
    setCouponError('')
    const code = coupon.trim().toUpperCase()
    if (!code) return
    try {
      const res = await api.validateCoupon(code, subtotalSemPromo, deliveryFee)
      setCouponApplied({
        code: res.coupon.code,
        type: res.coupon.discount_type,
        value: res.coupon.discount_value,
        label: res.coupon.description || code,
        discount: res.discount,
      })
    } catch (err) {
      setCouponError(err.message)
    }
  }

  function validateFields() {
    if (!firstName.trim()) return 'Informe seu nome'
    if (!lastName.trim()) return 'Informe seu sobrenome'
    if (!phone.trim()) return 'Informe seu WhatsApp'
    if (deliveryType === 'delivery' && !neighborhood) return 'Selecione o bairro'
    if (deliveryType === 'delivery' && !street.trim()) return 'Informe a rua'
    return ''
  }

  async function finishOrder(stripePaymentIntentId) {
    try {
      const order = await api.guestOrder({
        name: `${firstName.trim()} ${lastName.trim()}`,
        phone: phone.replace(/\D/g, ''),
        delivery_type: deliveryType,
        delivery_address: deliveryType === 'delivery' ? { street, number, neighborhood, complement } : null,
        payment_method: payment,
        delivery_fee: deliveryFee,
        notes: [notes, payment === 'dinheiro' && troco ? `Troco para R$ ${troco}` : ''].filter(Boolean).join(' | ') || null,
        coupon_code: couponApplied?.code || undefined,
        coupon_subtotal: couponApplied ? subtotalSemPromo : undefined,
        stripe_payment_intent_id: stripePaymentIntentId,
        items: items.map(i => ({ product_id: i.product.id, quantity: i.qty, notes: i.notes || null, addons: (i.addons || []).map(a => ({ addon_option_id: a.id, quantity: 1 })) })),
      })
      clear()
      const BASE = import.meta.env.VITE_API_URL || ''
      // Meta Pixel — browser
      const eventId = trackPurchase(order.id, parseFloat(order.total) || 0, items)
      // Meta CAPI — servidor (dedup pelo mesmo eventId)
      fetch(`${BASE}/api/meta/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          order_id: order.id,
          total: order.total,
          currency: 'BRL',
          content_ids: items.map(i => i.product.id),
          num_items: items.reduce((s, i) => s + i.qty, 0),
          phone: phone.replace(/\D/g, ''),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      }).catch(() => {})
      if (deliveryType === 'delivery') {
        const customerId = foundCustomer?.id || order.customer_id
        if (customerId && (addingNewAddress || !selectedAddressId || !foundCustomer)) {
          fetch(`${BASE}/api/delivery/save-address`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: customerId, street, number, neighborhood, complement }) }).catch(() => {})
        }
      }
      setSuccess(order)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleSubmit() {
    setError('')
    const fieldError = validateFields()
    if (fieldError) return setError(fieldError)
    setLoading(true)
    await finishOrder(undefined)
  }

  // Botão Apple Pay (Stripe Payment Request Button) — cria uma única vez ao entrar nessa forma de pagamento
  useEffect(() => {
    if (payment !== 'apple_pay' || !stripePromise || !applePayButtonRef.current) return
    let cancelled = false
    let mountedButton = null
    setApplePayError('')
    setApplePayAvailable(null)
    stripePromise.then(stripe => {
      if (cancelled || !stripe) return
      stripeRef.current = stripe
      const paymentRequest = stripe.paymentRequest({
        country: 'BR',
        currency: 'brl',
        total: { label: 'Confraria Café', amount: Math.round(totalRef.current * 100) },
        requestPayerName: true,
        requestPayerPhone: true,
      })

      paymentRequest.on('paymentmethod', async (ev) => {
        const fieldError = validateFields()
        if (fieldError) { ev.complete('fail'); setApplePayError(fieldError); return }
        setLoading(true)
        try {
          const intentRes = await api.createCardIntent(totalRef.current)
          const { paymentIntent, error: confirmError } = await stripe.confirmCardPayment(
            intentRes.clientSecret,
            { payment_method: ev.paymentMethod.id },
            { handleActions: false }
          )
          if (confirmError) { ev.complete('fail'); setApplePayError(confirmError.message || 'Pagamento recusado'); setLoading(false); return }
          ev.complete('success')
          if (paymentIntent.status !== 'succeeded') { setApplePayError('Pagamento não foi aprovado'); setLoading(false); return }
          await finishOrder(paymentIntent.id)
        } catch (e) {
          ev.complete('fail')
          setApplePayError(e.message)
          setLoading(false)
        }
      })

      paymentRequestRef.current = paymentRequest

      paymentRequest.canMakePayment().then(result => {
        if (cancelled) return
        setApplePayAvailable(!!result)
        if (!result || !applePayButtonRef.current) return
        const elements = stripe.elements()
        const prButton = elements.create('paymentRequestButton', {
          paymentRequest,
          style: { paymentRequestButton: { type: 'default', theme: 'dark', height: '48px' } },
        })
        prButton.mount(applePayButtonRef.current)
        mountedButton = prButton
      }).catch(e => { if (!cancelled) setApplePayError('canMakePayment: ' + e.message) })

      paymentRequest.on('cancel', () => setApplePayError('Folha do Apple Pay foi cancelada/fechada'))
    }).catch(e => setApplePayError('Erro ao carregar Stripe: ' + e.message))
    return () => {
      cancelled = true
      if (mountedButton) mountedButton.unmount()
      paymentRequestRef.current = null
    }
  }, [payment])

  // Mantém o valor do pedido sincronizado no botão do Apple Pay sem recriar o botão
  useEffect(() => {
    totalRef.current = total
    if (paymentRequestRef.current) {
      paymentRequestRef.current.update({ total: { label: 'Confraria Café', amount: Math.round(total * 100) } })
    }
  }, [total])

  // Tela de sucesso
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-5" style={{ background: 'var(--bg)' }}>
        <div className="w-full max-w-sm rounded-3xl p-7 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-black mb-2" style={{ color: 'var(--cream)' }}>Pedido enviado!</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            Pedido <span style={{ color: 'var(--gold)', fontWeight: 800 }}>#{success.id?.slice(-6).toUpperCase()}</span> recebido!
          </p>

          <div className="rounded-2xl p-4 mb-5 space-y-2 text-left" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            {[
              { label: 'Pagamento', value: PAYMENT_METHODS.find(m => m.id === success.payment_method)?.label },
              { label: 'Total', value: brl(parseFloat(success.total)), gold: true },
              { label: 'Tipo', value: success.delivery_type === 'retirada' ? '🏪 Retirada' : '🛵 Entrega' },
            ].map(row => (
              <div key={row.label} className="flex justify-between text-sm">
                <span style={{ color: 'var(--muted)' }}>{row.label}</span>
                <span style={{ fontWeight: 700, color: row.gold ? 'var(--gold)' : 'var(--cream)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {success.payment_method === 'pix' && success.status !== 'aguardando_pagamento' && (
            <div className="rounded-2xl p-4 mb-2 text-center" style={{ background: 'rgba(76,175,128,0.1)', border: '1px solid rgba(76,175,128,0.3)' }}>
              <p className="font-black text-sm" style={{ color: 'var(--green)' }}>✅ Pagamento confirmado!</p>
            </div>
          )}
          {success.payment_method === 'pix' && success.status === 'aguardando_pagamento' && pixAutoEnabled && success.pix?.qrCode && (
            <StripePixBox qrCodeUrl={success.pix.qrCodeUrl} qrCodeData={success.pix.qrCode} total={parseFloat(success.total)} />
          )}
          {success.payment_method === 'pix' && success.status === 'aguardando_pagamento' && settings.pix_key && (
            <div style={{ marginTop: 10 }}>
              <PixBox pixKey={settings.pix_key} total={parseFloat(success.total)} />
            </div>
          )}

          <a href="https://wa.me/5596974007410" target="_blank" rel="noopener noreferrer"
            className="press flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-bold text-sm mb-3 no-underline"
            style={{ background: 'rgba(76,175,128,0.12)', border: '1px solid rgba(76,175,128,0.3)', color: 'var(--green)' }}>
            💬 Falar com a loja
          </a>

          <button onClick={() => navigate('/')} className="btn-gold w-full py-3 text-sm">
            Voltar ao cardápio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="safe-top flex-shrink-0" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-4">
          <button onClick={() => navigate('/cart')} className="press w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--card)', color: 'var(--cream)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h1 className="flex-1 text-lg font-black" style={{ color: 'var(--cream)' }}>Finalizar Pedido</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-40">

        {/* Seus dados */}
        <Section title="👤 Seus dados">
          <label style={LABEL}>WhatsApp *</label>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <input type="tel" value={phone} style={INPUT}
              onChange={e => {
                const d = e.target.value.replace(/\D/g, '').slice(0, 11)
                let m = d
                if (d.length > 2) m = `(${d.slice(0,2)}) ${d.slice(2)}`
                if (d.length > 7) m = `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
                setPhone(m)
                if (d.length >= 10) lookupByPhone(d)
              }}
              onBlur={e => lookupByPhone(e.target.value)}
              placeholder="(96) 99999-0000" maxLength={15}
            />
            {lookingUp && <span style={{ position: 'absolute', right: 12, top: 10, fontSize: 12, color: 'var(--muted)' }}>🔍</span>}
          </div>

          {foundCustomer ? (
            <div className="flex items-center gap-3 fade-in" style={{ background: 'rgba(76,175,128,0.1)', border: '1px solid rgba(76,175,128,0.25)', borderRadius: 12, padding: '10px 14px' }}>
              <span style={{ color: 'var(--green)', fontSize: 18 }}>✅</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--cream)' }}>{foundCustomer.name}</p>
                <p style={{ fontSize: 11, color: 'var(--green)' }}>Cliente encontrado</p>
              </div>
              <button onClick={() => { setFoundCustomer(null); setFirstName(''); setLastName('') }}
                className="press" style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          ) : phone.replace(/\D/g,'').length >= 10 && !lookingUp ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }} className="fade-in">
              <div>
                <label style={LABEL}>Nome *</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="João" style={INPUT} />
              </div>
              <div>
                <label style={LABEL}>Sobrenome *</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Silva" style={INPUT} />
              </div>
            </div>
          ) : null}
        </Section>

        {/* Como receber */}
        <Section title="🚀 Como quer receber?">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[{ id: 'delivery', label: '🛵 Entrega', desc: 'Taxa por bairro' }, { id: 'retirada', label: '🏪 Retirada', desc: 'Sem taxa' }].map(opt => (
              <button key={opt.id} onClick={() => setDeliveryType(opt.id)} className="press"
                style={{
                  padding: 12, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                  background: deliveryType === opt.id ? 'rgba(201,162,94,0.12)' : 'var(--surface)',
                  border: `2px solid ${deliveryType === opt.id ? 'var(--gold)' : 'var(--border)'}`,
                }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--cream)' }}>{opt.label}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{opt.desc}</p>
              </button>
            ))}
          </div>
        </Section>

        {/* Endereço */}
        {deliveryType === 'delivery' && (
          <Section title="📍 Endereço de entrega">
            {savedAddresses.length > 0 && !addingNewAddress && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>Endereços salvos:</p>
                {savedAddresses.map(addr => (
                  <button key={addr.id} onClick={() => applyAddress(addr)} className="press w-full"
                    style={{ textAlign: 'left', padding: 12, borderRadius: 12, marginBottom: 6, cursor: 'pointer',
                      background: selectedAddressId === addr.id ? 'rgba(201,162,94,0.1)' : 'var(--surface)',
                      border: `2px solid ${selectedAddressId === addr.id ? 'var(--gold)' : 'var(--border)'}` }}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--cream)' }}>{addr.street}{addr.number ? `, ${addr.number}` : ''}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>{[addr.neighborhood, addr.complement].filter(Boolean).join(' · ')}</p>
                  </button>
                ))}
                <button onClick={() => { setSelectedAddressId(null); setStreet(''); setNumber(''); setNeighborhood(''); setComplement(''); setAddingNewAddress(true) }}
                  className="press w-full" style={{ padding: 10, borderRadius: 12, border: '2px dashed var(--border)', background: 'none', color: 'var(--gold)', fontSize: 13, fontWeight: 700, cursor: 'pointer', textAlign: 'center' }}>
                  ➕ Usar outro endereço
                </button>
              </div>
            )}

            {(savedAddresses.length === 0 || addingNewAddress) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="fade-in">
                {addingNewAddress && (
                  <button onClick={() => { setAddingNewAddress(false); if (savedAddresses[0]) applyAddress(savedAddresses[0]) }}
                    className="press" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
                    ← Voltar aos salvos
                  </button>
                )}
                <div>
                  <label style={LABEL}>Bairro *</label>
                  <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                    style={{ ...INPUT, appearance: 'none' }}>
                    <option value="">— Selecione o bairro —</option>
                    {Object.entries(bairrosPorZona).map(([zona, bairros]) => (
                      <optgroup key={zona} label={`── ${zona} ──`}>
                        {bairros.map(b => (
                          <option key={b.id} value={b.name}>{b.name} — R$ {b.delivery_fee.toFixed(2).replace('.', ',')}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {neighborhood && <p style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginTop: 4 }}>🛵 Taxa: R$ {getTaxa(neighborhood).toFixed(2).replace('.', ',')}</p>}
                </div>
                <div>
                  <label style={LABEL}>Rua / Avenida *</label>
                  <input value={street} onChange={e => setStreet(e.target.value)} placeholder="Av. Duque de Caxias" style={INPUT} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={LABEL}>Número</label>
                    <input value={number} onChange={e => setNumber(e.target.value)} placeholder="123" inputMode="numeric" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Complemento</label>
                    <input value={complement} onChange={e => setComplement(e.target.value)} placeholder="Apto 12" style={INPUT} />
                  </div>
                </div>
              </div>
            )}

            {savedAddresses.length > 0 && !addingNewAddress && (
              <div style={{ marginTop: 10 }}>
                <label style={LABEL}>Bairro (para calcular taxa) *</label>
                <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)} style={{ ...INPUT, appearance: 'none' }}>
                  <option value="">— Selecione o bairro —</option>
                  {Object.entries(bairrosPorZona).map(([zona, bairros]) => (
                    <optgroup key={zona} label={`── ${zona} ──`}>
                      {bairros.map(b => (
                        <option key={b.id} value={b.name}>{b.name} — R$ {b.delivery_fee.toFixed(2).replace('.', ',')}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {neighborhood && <p style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginTop: 4 }}>🛵 Taxa: R$ {getTaxa(neighborhood).toFixed(2).replace('.', ',')}</p>}
              </div>
            )}
          </Section>
        )}

        {/* Pagamento */}
        <Section title="💳 Forma de pagamento">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {availableMethods.map(m => (
              <div key={m.id}>
                <button onClick={() => setPayment(m.id)} className="press"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, cursor: 'pointer', textAlign: 'left', width: '100%',
                    background: payment === m.id ? 'rgba(201,162,94,0.1)' : 'var(--surface)',
                    border: `2px solid ${payment === m.id ? 'var(--gold)' : 'var(--border)'}` }}>
                  <span style={{ display: 'flex', color: payment === m.id ? 'var(--gold)' : 'var(--muted)', flexShrink: 0 }}>
                    <PaymentIcon id={m.id} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--cream)' }}>{m.label}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>{m.desc}</p>
                  </div>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${payment === m.id ? 'var(--gold)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {payment === m.id && <div style={{ width: 10, height: 10, background: 'var(--gold)', borderRadius: '50%' }} />}
                  </div>
                </button>

                {m.id === 'apple_pay' && payment === 'apple_pay' && (
                  <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div ref={applePayButtonRef} />
                    {applePayAvailable === false && (
                      <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>Apple Pay não está disponível neste dispositivo/navegador. Use o Safari num iPhone/Mac com cartão configurado.</p>
                    )}
                    {applePayError && <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{applePayError}</p>}
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>🔒 Pagamento processado com segurança pela Stripe</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {payment === 'dinheiro' && (
            <div style={{ marginTop: 10 }}>
              <label style={LABEL}>Troco para quanto? (opcional)</label>
              <input type="number" inputMode="numeric" value={troco} onChange={e => setTroco(e.target.value)} placeholder="Ex: 50" style={INPUT} />
            </div>
          )}
        </Section>

        {/* Observações */}
        <Section title="📝 Observações">
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Alguma instrução especial?" rows={2}
            style={{ ...INPUT, resize: 'none', fontFamily: 'inherit' }} />
        </Section>

        {/* Cupom */}
        <Section title="🎟️ Cupom de desconto">
          {couponApplied ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(76,175,128,0.1)', border: '1px solid rgba(76,175,128,0.25)', borderRadius: 12, padding: '10px 14px' }}>
              <div>
                <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--green)' }}>{couponApplied.code}</span>
                <span style={{ fontSize: 11, color: 'var(--green)', marginLeft: 6 }}>— {couponApplied.label}</span>
              </div>
              <button onClick={() => { setCouponApplied(null); setCoupon('') }} className="press"
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={coupon} onChange={e => { setCoupon(e.target.value.toUpperCase()); setCouponError('') }}
                onKeyDown={e => e.key === 'Enter' && applyCoupon()}
                placeholder="Digite o código" style={{ ...INPUT, textTransform: 'uppercase', flex: 1 }} />
              <button onClick={applyCoupon} className="btn-gold press" style={{ padding: '10px 16px', fontSize: 13, borderRadius: 12, whiteSpace: 'nowrap' }}>
                Aplicar
              </button>
            </div>
          )}
          {couponError && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{couponError}</p>}
        </Section>

        {/* Banner promoções disponíveis hoje */}
        {Array.isArray(activePromo) && (() => {
          const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
          const todayPromos = activePromo.filter(p => !p.day_of_week?.length || p.day_of_week.includes(nowDay))
          if (!todayPromos.length) return null
          return todayPromos.map(p => {
            const meetsMin = subtotal >= parseFloat(p.min_order_value)
            const meetsZone = !p.zones?.length || !selectedZone || p.zones.includes(selectedZone)
            const applied = meetsMin && meetsZone && deliveryType === 'delivery'
            const zonaLabel = p.zones?.length ? `Zona ${p.zones.join(', ')}` : null
            return (
              <div key={p.id} style={{
                borderRadius: 14, padding: '12px 14px', marginBottom: 4,
                background: applied ? 'rgba(22,163,74,0.1)' : 'rgba(201,162,94,0.07)',
                border: `1px solid ${applied ? 'rgba(22,163,74,0.4)' : 'rgba(201,162,94,0.25)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>🎉</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: applied ? 'var(--green)' : 'var(--gold)', margin: 0 }}>
                      {p.name}{applied ? ' — APLICADO!' : ''}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                      {parseFloat(p.min_order_value) > 0 ? `Pedidos acima de ${brl(parseFloat(p.min_order_value))}` : 'Qualquer valor'}
                      {zonaLabel ? ` · ${zonaLabel}` : ''}
                      {!meetsMin ? ` · faltam ${brl(parseFloat(p.min_order_value) - subtotal)}` : ''}
                      {!meetsZone && selectedZone ? ` · não disponível para ${selectedZone}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            )
          })
        })()}

        {/* Resumo */}
        <Section title="🧾 Resumo">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(i => (
              <div key={i.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>
                  {i.qty}x {i.product.name}
                  {(i.addons || []).length > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{i.addons.map(a => a.name).join(', ')}</span>}
                </span>
                <span style={{ color: 'var(--cream)', fontWeight: 600 }}>{brl(itemLineTotal(i))}</span>
              </div>
            ))}
            <div className="gold-line" />
            {[
              { label: 'Subtotal', value: brl(subtotal) },
              { label: 'Entrega', value: deliveryFee === 0 ? 'Grátis' : brl(deliveryFee) },
              applicablePromo && !couponApplied ? { label: `🎉 ${applicablePromo.name}`, value: `- ${brl(promoDiscount)}`, green: true } : null,
              couponApplied ? { label: `🎟️ ${couponApplied.code}`, value: `- ${brl(discount)}`, green: true } : null,
            ].filter(Boolean).map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>{row.label}</span>
                <span style={{ color: row.green ? 'var(--green)' : 'var(--cream)', fontWeight: 600 }}>{row.value}</span>
              </div>
            ))}
            <div className="gold-line" />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--cream)' }}>Total</span>
              <span style={{ fontWeight: 900, fontSize: 16, color: 'var(--gold)' }}>{brl(total)}</span>
            </div>
          </div>
        </Section>

        {error && (
          <div style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid rgba(224,82,82,0.3)', borderRadius: 12, padding: 12, textAlign: 'center', fontSize: 13, color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Botão fixo */}
      {payment !== 'apple_pay' && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-4 pb-4 safe-bottom z-50"
          style={{ background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button onClick={handleSubmit} disabled={loading} className="btn-gold w-full py-4 flex items-center justify-between px-5">
            <span className="text-sm font-black">{loading ? '⏳ Enviando...' : '✅ Confirmar pedido'}</span>
            <span className="text-sm font-black">{brl(total)}</span>
          </button>
        </div>
      )}
    </div>
  )
}
