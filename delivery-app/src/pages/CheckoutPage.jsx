import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart, itemLineTotal } from '../store/cart'
import { api } from '../api'

const PAYMENT_METHODS = [
  { id: 'pix',            label: 'PIX',             icon: '⚡', desc: 'Pague via PIX após confirmar' },
  { id: 'dinheiro',       label: 'Dinheiro',         icon: '💵', desc: 'Pague na entrega / retirada' },
  { id: 'cartao_credito', label: 'Cartão de Crédito',icon: '💳', desc: 'Maquininha na entrega' },
  { id: 'cartao_debito',  label: 'Cartão de Débito', icon: '🏦', desc: 'Maquininha na entrega' },
]

function onlyDigits(v) {
  return (v || '').replace(/\D/g, '')
}

function buildWhatsAppMessage({ order, items, deliveryType, address, payment, total, deliveryFee, storeName, customerName, customerPhone }) {
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const sep = '─────────────────────'
  const lines = []

  lines.push(`☕ *${storeName || 'Novo Pedido'}*`)
  lines.push(`🧾 *Pedido #${order.order_number}*`)
  lines.push(sep)

  lines.push(`👤 *Cliente:* ${customerName}`)
  if (customerPhone) lines.push(`📱 *WhatsApp:* ${customerPhone}`)
  lines.push(sep)

  lines.push('🛒 *Itens do Pedido:*')
  for (const i of items) {
    lines.push(`  • *${i.qty}x* ${i.product.name}  →  ${brl(itemLineTotal(i))}`)
    for (const a of i.addons || []) lines.push(`      ➕ ${a.name}`)
    if (i.notes) lines.push(`      📝 _${i.notes}_`)
  }
  lines.push(sep)

  if (deliveryType === 'retirada') {
    lines.push('🏪 *Retirada no local*')
  } else {
    lines.push('🛵 *Endereço de Entrega:*')
    lines.push(`  📍 ${address.street}, ${address.number || 's/n'}`)
    lines.push(`  🏘️ ${address.neighborhood}`)
    if (address.complement) lines.push(`  🏠 ${address.complement}`)
    lines.push(`  🚚 Taxa de entrega: ${brl(deliveryFee)}`)
  }
  lines.push(sep)

  const payLabel = PAYMENT_METHODS.find((m) => m.id === payment)?.label || payment
  lines.push(`💳 *Pagamento:* ${payLabel}`)
  lines.push(sep)

  lines.push(`💰 *Total: ${brl(total)}*`)
  lines.push('')
  lines.push('_Confraria Café — obrigado pelo pedido! ☕_')

  return lines.join('\n')
}

function PixCopyBox({ pixKey, total }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(pixKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    })
  }
  return (
    <div className="bg-violet-50 rounded-2xl p-4 mb-6 text-sm text-violet-700">
      <p className="font-bold mb-2">⚡ Pague via PIX para confirmar</p>
      {total && <p className="text-violet-600 font-bold text-base mb-3">{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
      <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-violet-200 mb-2">
        <span className="flex-1 font-mono text-sm text-gray-800 break-all">{pixKey}</span>
        <button
          onClick={copy}
          className="flex-shrink-0 bg-violet-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg press active:bg-violet-700"
        >
          {copied ? '✅ Copiado!' : '📋 Copiar'}
        </button>
      </div>
      <p className="text-xs text-violet-500">Chave CNPJ — copie e cole no seu banco</p>
    </div>
  )
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
  const [couponApplied, setCouponApplied] = useState(null) // { code, type, value }
  const [couponError, setCouponError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  const [neighborhoods, setNeighborhoods] = useState([])
  const [settings, setSettings] = useState({ store_whatsapp_number: '', pix_key: '', store_name: '' })

  // Lookup de cliente por telefone
  const [foundCustomer, setFoundCustomer] = useState(null)
  const [savedAddresses, setSavedAddresses] = useState([])
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [addingNewAddress, setAddingNewAddress] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)

  useEffect(() => {
    api.neighborhoods().then(setNeighborhoods).catch(() => setNeighborhoods([]))
    api.settings().then(setSettings).catch(() => {})
  }, [])

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
      // preenche nome automaticamente
      const parts = (data.customer.name || '').split(' ')
      setFirstName(parts[0] || '')
      setLastName(parts.slice(1).join(' ') || '')
      // seleciona primeiro endereço se delivery
      if (data.addresses && data.addresses.length > 0) {
        const first = data.addresses[0]
        setSelectedAddressId(first.id)
        setStreet(first.street || '')
        setNumber(first.number || '')
        setNeighborhood(first.neighborhood || '')
        setComplement(first.complement || '')
        setAddingNewAddress(false)
      }
    } catch (_) {
      setFoundCustomer(null)
    } finally {
      setLookingUp(false)
    }
  }

  function applyAddress(addr) {
    setSelectedAddressId(addr.id)
    setStreet(addr.street || '')
    setNumber(addr.number || '')
    setNeighborhood(addr.neighborhood || '')
    setComplement(addr.complement || '')
    setAddingNewAddress(false)
  }

  function startNewAddress() {
    setSelectedAddressId(null)
    setStreet('')
    setNumber('')
    setNeighborhood('')
    setComplement('')
    setAddingNewAddress(true)
  }

  const bairrosPorZona = useMemo(() => {
    const groups = {}
    for (const n of neighborhoods) {
      if (!groups[n.zone]) groups[n.zone] = []
      groups[n.zone].push(n)
    }
    return groups
  }, [neighborhoods])

  function getTaxa(bairroNome) {
    const found = neighborhoods.find((n) => n.name === bairroNome)
    return found ? found.delivery_fee : 0
  }

  const subtotal = items.reduce((s, i) => s + itemLineTotal(i), 0)
  const deliveryFee = deliveryType === 'delivery' ? getTaxa(neighborhood) : 0
  const discount = couponApplied
    ? (couponApplied.type === 'percent' ? subtotal * couponApplied.value / 100 : couponApplied.value)
    : 0
  const total = subtotal + deliveryFee - discount

  function applyCoupon() {
    setCouponError('')
    const code = coupon.trim().toUpperCase()
    if (!code) return
    // Cupons locais — adicione mais aqui ou conecte a uma API futura
    const COUPONS = {
      'BEMVINDO10': { type: 'percent', value: 10, label: '10% de desconto' },
      'FRETE0':     { type: 'fixed',   value: deliveryFee, label: 'Frete grátis' },
    }
    const found = COUPONS[code]
    if (!found) { setCouponError('Cupom inválido ou expirado'); return }
    setCouponApplied({ code, ...found })
  }

  function sendToWhatsApp(order) {
    const storeNumber = onlyDigits(settings.store_whatsapp_number)
    if (!storeNumber) return false
    const message = buildWhatsAppMessage({
      order,
      items,
      deliveryType,
      address: { street, number, neighborhood, complement },
      payment,
      total,
      deliveryFee,
      storeName: settings.store_name,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone: phone,
    })
    window.open(`https://wa.me/${storeNumber}?text=${encodeURIComponent(message)}`, '_blank')
    return true
  }

  async function handleSubmit() {
    setError('')
    if (!firstName.trim()) return setError('Informe seu nome')
    if (!lastName.trim()) return setError('Informe seu sobrenome')
    if (!phone.trim()) return setError('Informe seu WhatsApp')
    if (deliveryType === 'delivery' && !neighborhood) return setError('Selecione o bairro de entrega')
    if (deliveryType === 'delivery' && !street.trim()) return setError('Informe a rua de entrega')

    setLoading(true)
    try {
      const order = await api.guestOrder({
        name: `${firstName.trim()} ${lastName.trim()}`,
        phone: phone.replace(/\D/g, ''),
        delivery_type: deliveryType,
        delivery_address: deliveryType === 'delivery'
          ? { street, number, neighborhood, complement }
          : null,
        payment_method: payment,
        delivery_fee: deliveryFee,
        notes: [notes, payment === 'dinheiro' && troco ? `Troco para R$ ${troco}` : '', couponApplied ? `Cupom: ${couponApplied.code}` : ''].filter(Boolean).join(' | ') || null,
        discount: discount > 0 ? discount : undefined,
        items: items.map(i => ({
          product_id: i.product.id,
          quantity: i.qty,
          notes: i.notes || null,
          addons: (i.addons || []).map((a) => ({ addon_option_id: a.id, quantity: 1 })),
        })),
      })
      clear()
      const BASE = import.meta.env.VITE_API_URL || ''
      // Primeira compra: salva cliente e endereço automaticamente
      if (deliveryType === 'delivery') {
        const customerId = foundCustomer?.id || order.customer_id
        if (customerId && (addingNewAddress || !selectedAddressId || !foundCustomer)) {
          fetch(`${BASE}/api/delivery/save-address`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_id: customerId, street, number, neighborhood, complement }),
          }).catch(() => {})
        }
      }
      setSuccess(order)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Tela de confirmação
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-50">
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-lg text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Pedido enviado!</h2>
          <p className="text-gray-500 text-sm mb-4">
            Recebemos seu pedido <strong className="text-violet-600">#{success.id?.slice(-6).toUpperCase()}</strong>
          </p>

          <div className="bg-gray-50 rounded-2xl p-4 text-left space-y-2 mb-6 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Pagamento</span>
              <span className="font-semibold">{PAYMENT_METHODS.find(m => m.id === success.payment_method)?.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-violet-600">
                {parseFloat(success.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tipo</span>
              <span className="font-semibold">{success.delivery_type === 'retirada' ? '🏪 Retirada' : '🛵 Entrega'}</span>
            </div>
          </div>

          {success.payment_method === 'pix' && settings.pix_key && (
            <PixCopyBox pixKey={settings.pix_key} total={parseFloat(success.total)} />
          )}

          <a
            href="https://wa.me/5596974007410"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-white border-2 border-emerald-500 text-emerald-600 rounded-2xl py-3 font-bold mb-3 press flex items-center justify-center gap-2 no-underline"
          >
            💬 Falar com a loja
          </a>

          <button
            onClick={() => navigate('/')}
            className="w-full bg-violet-600 text-white rounded-2xl py-3 font-bold press"
          >
            Voltar ao cardápio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="bg-white safe-top px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/cart')} className="text-gray-400 text-xl press">←</button>
          <h1 className="text-lg font-bold text-gray-900">Finalizar Pedido</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-48">

        {/* Seus dados */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">👤 Seus dados</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-500 font-medium">WhatsApp *</label>
              <div className="relative">
                <input
                  type="tel" value={phone}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 11)
                    let masked = digits
                    if (digits.length > 2) masked = `(${digits.slice(0,2)}) ${digits.slice(2)}`
                    if (digits.length > 7) masked = `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`
                    setPhone(masked)
                    if (digits.length >= 10) lookupByPhone(digits)
                  }}
                  onBlur={e => lookupByPhone(e.target.value)}
                  placeholder="(96) 99999-0000"
                  maxLength={15}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                />
                {lookingUp && <span className="absolute right-3 top-3 text-xs text-gray-400">🔍</span>}
              </div>
              {foundCustomer && (
                <p className="text-xs text-emerald-600 mt-1 font-medium">✅ Cliente encontrado: {foundCustomer.name}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 font-medium">Nome *</label>
                <input
                  value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder="João"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Sobrenome *</label>
                <input
                  value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder="Silva"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Entrega ou Retirada */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">🚀 Como quer receber?</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'delivery', label: '🛵 Entrega', desc: 'Taxa por bairro' },
              { id: 'retirada', label: '🏪 Retirada', desc: 'Sem taxa' },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => setDeliveryType(opt.id)}
                className={`p-3 rounded-xl border-2 text-left transition-all press ${deliveryType === opt.id ? 'border-violet-600 bg-violet-50' : 'border-gray-100 bg-white'}`}
              >
                <p className="font-medium text-sm text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Endereço */}
        {deliveryType === 'delivery' && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">📍 Endereço de entrega</h3>

            {/* Endereços salvos do cliente */}
            {savedAddresses.length > 0 && !addingNewAddress && (
              <div className="mb-3 space-y-2">
                <p className="text-xs text-gray-500 font-medium mb-1">Endereços salvos:</p>
                {savedAddresses.map(addr => (
                  <button
                    key={addr.id}
                    onClick={() => applyAddress(addr)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all press ${selectedAddressId === addr.id ? 'border-violet-600 bg-violet-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <p className="text-sm font-semibold text-gray-800">{addr.street}{addr.number ? `, ${addr.number}` : ''}</p>
                    <p className="text-xs text-gray-500">{[addr.neighborhood, addr.complement].filter(Boolean).join(' · ')}</p>
                  </button>
                ))}
                <button
                  onClick={startNewAddress}
                  className="w-full text-center text-sm text-violet-600 font-semibold py-2 border-2 border-dashed border-violet-200 rounded-xl press"
                >
                  ➕ Usar outro endereço
                </button>
              </div>
            )}

            {/* Formulário de endereço (novo ou sem histórico) */}
            {(savedAddresses.length === 0 || addingNewAddress) && (
              <div className="space-y-2">
                {addingNewAddress && (
                  <button onClick={() => { setAddingNewAddress(false); if (savedAddresses[0]) applyAddress(savedAddresses[0]) }}
                    className="text-xs text-gray-400 mb-1 press">← Voltar aos endereços salvos</button>
                )}
                <div>
                  <label className="text-xs text-gray-500 font-medium">Bairro *</label>
                  <select
                    value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400 bg-white"
                  >
                    <option value="">— Selecione o bairro —</option>
                    {Object.entries(bairrosPorZona).map(([zona, bairros]) => (
                      <optgroup key={zona} label={`── ${zona} ──`}>
                        {bairros.map(b => (
                          <option key={b.id} value={b.name}>{b.name} — R$ {b.delivery_fee.toFixed(2).replace('.', ',')}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {neighborhood && (
                    <p className="text-xs text-violet-600 font-semibold mt-1">
                      🛵 Taxa de entrega: R$ {getTaxa(neighborhood).toFixed(2).replace('.', ',')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Rua / Avenida *</label>
                  <input
                    value={street} onChange={e => setStreet(e.target.value)}
                    placeholder="Av. Duque de Caxias"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Número</label>
                    <input
                      value={number} onChange={e => setNumber(e.target.value)}
                      placeholder="123" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Complemento</label>
                    <input
                      value={complement} onChange={e => setComplement(e.target.value)}
                      placeholder="Apto 12"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Bairro selecionado (quando endereço salvo não tem bairro nos neighborhoods) */}
            {savedAddresses.length > 0 && !addingNewAddress && (
              <div className="mt-3">
                <label className="text-xs text-gray-500 font-medium">Bairro (para calcular taxa) *</label>
                <select
                  value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400 bg-white"
                >
                  <option value="">— Selecione o bairro —</option>
                  {Object.entries(bairrosPorZona).map(([zona, bairros]) => (
                    <optgroup key={zona} label={`── ${zona} ──`}>
                      {bairros.map(b => (
                        <option key={b.id} value={b.name}>{b.name} — R$ {b.delivery_fee.toFixed(2).replace('.', ',')}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {neighborhood && (
                  <p className="text-xs text-violet-600 font-semibold mt-1">
                    🛵 Taxa de entrega: R$ {getTaxa(neighborhood).toFixed(2).replace('.', ',')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pagamento */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">💳 Forma de pagamento</h3>
          <div className="space-y-2">
            {PAYMENT_METHODS.map(m => (
              <button
                key={m.id}
                onClick={() => setPayment(m.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all press ${payment === m.id ? 'border-violet-600 bg-violet-50' : 'border-gray-100 bg-white'}`}
              >
                <span className="text-2xl">{m.icon}</span>
                <div className="text-left flex-1">
                  <p className="font-medium text-sm text-gray-900">{m.label}</p>
                  <p className="text-xs text-gray-400">{m.desc}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${payment === m.id ? 'border-violet-600' : 'border-gray-200'}`}>
                  {payment === m.id && <div className="w-2.5 h-2.5 bg-violet-600 rounded-full" />}
                </div>
              </button>
            ))}
          </div>

          {payment === 'pix' && settings.pix_key && (
            <div className="mt-3">
              <PixCopyBox pixKey={settings.pix_key} />
            </div>
          )}

          {payment === 'dinheiro' && (
            <div className="mt-3">
              <label className="text-xs text-gray-500 font-medium">Troco para quanto? (opcional)</label>
              <input
                type="number" inputMode="numeric" value={troco} onChange={e => setTroco(e.target.value)}
                placeholder="Ex: 50"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
              />
            </div>
          )}
        </div>

        {/* Observação */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-2">📝 Observações</h3>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Alguma instrução especial?"
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 resize-none"
          />
        </div>

        {/* Cupom de desconto */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-2">🎟️ Cupom de desconto</h3>
          {couponApplied ? (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <div>
                <span className="text-emerald-700 font-bold text-sm">{couponApplied.code}</span>
                <span className="text-emerald-600 text-xs ml-2">— {couponApplied.label}</span>
              </div>
              <button onClick={() => { setCouponApplied(null); setCoupon('') }} className="text-gray-400 text-lg press">✕</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={coupon} onChange={e => { setCoupon(e.target.value.toUpperCase()); setCouponError('') }}
                onKeyDown={e => e.key === 'Enter' && applyCoupon()}
                placeholder="Digite o código"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 uppercase"
              />
              <button onClick={applyCoupon} className="bg-violet-600 text-white px-4 rounded-xl text-sm font-bold press active:bg-violet-700">
                Aplicar
              </button>
            </div>
          )}
          {couponError && <p className="text-red-500 text-xs mt-1">{couponError}</p>}
        </div>

        {/* Resumo */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">🧾 Resumo</h3>
          <div className="space-y-1.5 text-sm">
            {items.map(i => (
              <div key={i.key} className="flex justify-between text-gray-600">
                <span>
                  {i.qty}x {i.product.name}
                  {(i.addons || []).length > 0 && (
                    <span className="block text-xs text-gray-400">{i.addons.map(a => a.name).join(', ')}</span>
                  )}
                </span>
                <span>{itemLineTotal(i).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span>{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Taxa de entrega</span>
                <span>{deliveryFee === 0 ? 'Grátis' : deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-600 font-medium">
                  <span>🎟️ Desconto ({couponApplied.code})</span>
                  <span>- {discount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100 mt-1">
                <span>Total</span>
                <span className="text-violet-600 text-base">{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm text-center bg-red-50 p-3 rounded-xl">{error}</p>}
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md p-4 bg-white border-t border-gray-100 safe-bottom z-50">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-violet-600 text-white rounded-2xl py-4 font-bold text-base press active:bg-violet-700 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? '⏳ Enviando...' : `✅ Confirmar pedido · ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
        </button>
      </div>
    </div>
  )
}
