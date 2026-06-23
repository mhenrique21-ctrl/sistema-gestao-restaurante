import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../store/cart'
import { useAuth } from '../store/auth'
import { api } from '../api'

const PAYMENT_METHODS = [
  { id: 'pix', label: 'PIX', icon: '⚡', desc: 'Instantâneo e sem taxas' },
  { id: 'dinheiro', label: 'Dinheiro', icon: '💵', desc: 'Pague na entrega' },
  { id: 'cartao_credito', label: 'Crédito', icon: '💳', desc: 'Máquina na entrega' },
  { id: 'cartao_debito', label: 'Débito', icon: '🏦', desc: 'Máquina na entrega' },
]

export default function CheckoutPage() {
  const navigate = useNavigate()
  const { items, clear } = useCart()
  const { customer } = useAuth()
  const [payment, setPayment] = useState('pix')
  const [deliveryType, setDeliveryType] = useState('delivery')
  const [address, setAddress] = useState({ street: '', number: '', complement: '', neighborhood: '' })
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [pixData, setPixData] = useState(null)
  const [error, setError] = useState('')

  const subtotal = items.reduce((s, i) => s + i.product.price * i.qty, 0)
  const deliveryFee = deliveryType === 'delivery' ? 5.00 : 0
  const total = subtotal + deliveryFee

  async function handleSubmit() {
    if (deliveryType === 'delivery' && !address.street) {
      setError('Informe o endereço de entrega')
      return
    }
    setError('')
    setLoading(true)
    try {
      const order = await api.createOrder({
        customer_id: customer.id,
        delivery_type: deliveryType,
        delivery_address: deliveryType === 'delivery' ? address : null,
        payment_method: payment,
        delivery_fee: deliveryFee,
        notes,
        items: items.map((i) => ({
          product_id: i.product.id,
          quantity: i.qty,
          notes: [...i.extras, i.notes].filter(Boolean).join(', '),
        })),
      })
      clear()
      if (payment === 'pix' && order.pix) {
        setPixData({ ...order.pix, order_id: order.id })
      } else {
        navigate(`/order/${order.id}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // PIX screen
  if (pixData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-50 pb-24">
        <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-lg text-center">
          <div className="text-5xl mb-3">⚡</div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Pague via PIX</h2>
          <p className="text-gray-400 text-sm mb-4">
            Total: <strong className="text-violet-600">{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
          </p>

          {pixData.qrCode ? (
            <>
              <div className="bg-gray-50 rounded-2xl p-4 mb-4 pix-qr">
                <img src={pixData.qrCodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixData.qrCode)}`}
                     alt="QR Code PIX" className="w-48 h-48 mx-auto" />
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(pixData.qrCode); alert('Código copiado!') }}
                className="w-full bg-violet-50 text-violet-600 rounded-xl py-3 font-semibold text-sm mb-3 press"
              >
                📋 Copiar código PIX
              </button>
            </>
          ) : (
            <div className="bg-yellow-50 text-yellow-700 rounded-xl p-3 text-sm mb-4">
              Configure as chaves Stripe para gerar QR Code PIX automático
            </div>
          )}

          <p className="text-xs text-gray-400 mb-4">Após o pagamento, seu pedido é confirmado automaticamente</p>
          <button
            onClick={() => navigate(`/order/${pixData.order_id}`)}
            className="w-full bg-violet-600 text-white rounded-xl py-3 font-semibold press"
          >
            Acompanhar pedido →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="bg-white safe-top px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/cart')} className="text-gray-400 text-xl press">←</button>
          <h1 className="text-lg font-bold text-gray-900">Finalizar Pedido</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-32">

        {/* Entrega ou Retirada */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Como quer receber?</h3>
          <div className="grid grid-cols-2 gap-2">
            {[{ id: 'delivery', label: '🛵 Entrega', desc: 'Taxa R$ 5,00' }, { id: 'retirada', label: '🏪 Retirada', desc: 'Sem taxa' }].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setDeliveryType(opt.id)}
                className={`p-3 rounded-xl border-2 text-left transition-all press ${deliveryType === opt.id ? 'border-violet-600 bg-violet-50' : 'border-gray-100'}`}
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
            <div className="space-y-2">
              {[
                { key: 'street', label: 'Rua', placeholder: 'Rua das Flores' },
                { key: 'number', label: 'Número', placeholder: '123' },
                { key: 'complement', label: 'Complemento', placeholder: 'Apto 42 (opcional)' },
                { key: 'neighborhood', label: 'Bairro', placeholder: 'Centro' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 font-medium">{label}</label>
                  <input
                    value={address[key]}
                    onChange={(e) => setAddress((a) => ({ ...a, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mt-0.5 focus:outline-none focus:border-violet-400"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pagamento */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">💳 Forma de pagamento</h3>
          <div className="space-y-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setPayment(m.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all press ${payment === m.id ? 'border-violet-600 bg-violet-50' : 'border-gray-100'}`}
              >
                <span className="text-2xl">{m.icon}</span>
                <div className="text-left">
                  <p className="font-medium text-sm text-gray-900">{m.label}</p>
                  <p className="text-xs text-gray-400">{m.desc}</p>
                </div>
                <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${payment === m.id ? 'border-violet-600' : 'border-gray-200'}`}>
                  {payment === m.id && <div className="w-2.5 h-2.5 bg-violet-600 rounded-full" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Observação */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-2">📝 Observação do pedido</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Alguma instrução especial para a entrega?"
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 resize-none"
          />
        </div>

        {/* Resumo */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
            <div className="flex justify-between text-gray-600"><span>Taxa de entrega</span><span>{deliveryFee === 0 ? 'Grátis' : deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span>
              <span className="text-violet-600">{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm text-center bg-red-50 p-3 rounded-xl">{error}</p>}
      </div>

      <div className="p-4 bg-white border-t border-gray-100 safe-bottom">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-violet-600 text-white rounded-2xl py-4 font-bold text-base press active:bg-violet-700 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <span className="animate-spin">⏳</span> : null}
          {loading ? 'Processando...' : `Confirmar pedido · ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
        </button>
      </div>
    </div>
  )
}
