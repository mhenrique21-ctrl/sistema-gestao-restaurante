import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'

const BASE = import.meta.env.VITE_API_URL || ''

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [foundCustomer, setFoundCustomer] = useState(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function lookupByPhone(digits) {
    if (digits.length < 10) { setFoundCustomer(null); setName(''); return }
    setLookingUp(true)
    try {
      const r = await fetch(`${BASE}/api/delivery/lookup?phone=${digits}`)
      const data = await r.json()
      if (data?.customer) {
        setFoundCustomer(data.customer)
        setName(data.customer.name || '')
      } else {
        setFoundCustomer(null)
        setName('')
      }
    } catch (_) {
      setFoundCustomer(null)
    } finally {
      setLookingUp(false)
    }
  }

  async function handleSubmit() {
    const digits = phone.replace(/\D/g, '')
    if (!digits || digits.length < 10) { setError('Informe seu WhatsApp'); return }
    if (!name.trim()) { setError('Informe seu nome'); return }
    setLoading(true); setError('')
    try {
      if (foundCustomer) {
        login('customer-token-' + foundCustomer.id, { id: foundCustomer.id, name: foundCustomer.name, phone: foundCustomer.phone })
      } else {
        const r = await fetch(`${BASE}/api/customers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), phone: digits }),
        })
        const customer = await r.json()
        if (!r.ok) throw new Error(customer.error || 'Erro ao cadastrar')
        login('customer-token-' + customer.id, { id: customer.id, name: customer.name, phone: customer.phone })
      }
      navigate(-1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const digits = phone.replace(/\D/g, '')
  const phoneReady = digits.length >= 10

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="bg-red-700 safe-top text-white px-4 pt-4 pb-8 text-center">
        <button onClick={() => navigate(-1)} className="absolute left-4 top-4 text-red-200 press safe-top" style={{ marginTop: 'env(safe-area-inset-top)' }}>← Voltar</button>
        <div className="text-5xl mt-2 mb-2">☕</div>
        <h1 className="text-2xl font-bold">Confraria Café</h1>
        <p className="text-red-200 text-sm mt-1">Informe seus dados para continuar</p>
      </div>

      <div className="flex-1 px-4 -mt-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 space-y-4">

          <div>
            <label className="text-xs text-gray-500 font-medium">📱 WhatsApp *</label>
            <div className="relative">
              <input
                type="tel"
                value={phone}
                onChange={e => {
                  const d = e.target.value.replace(/\D/g, '').slice(0, 11)
                  let masked = d
                  if (d.length > 2) masked = `(${d.slice(0,2)}) ${d.slice(2)}`
                  if (d.length > 7) masked = `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
                  setPhone(masked)
                  setFoundCustomer(null)
                  setName('')
                  if (d.length >= 10) lookupByPhone(d)
                }}
                placeholder="(96) 99999-0000"
                maxLength={15}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-red-400"
              />
              {lookingUp && <span className="absolute right-3 top-4 text-xs text-gray-400">🔍</span>}
            </div>
          </div>

          {phoneReady && !lookingUp && (
            foundCustomer ? (
              <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3">
                <span className="text-emerald-600 text-xl">✅</span>
                <div>
                  <p className="text-emerald-700 font-bold text-sm">{foundCustomer.name}</p>
                  <p className="text-emerald-600 text-xs">Bem-vindo de volta!</p>
                </div>
                <button onClick={() => { setFoundCustomer(null); setPhone(''); setName('') }} className="ml-auto text-gray-400 press">✕</button>
              </div>
            ) : (
              <div>
                <label className="text-xs text-gray-500 font-medium">👤 Nome completo *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="João Silva"
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-red-400"
                />
              </div>
            )
          )}

          {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-xl">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading || !phoneReady}
            className="w-full bg-red-700 text-white rounded-2xl py-4 font-bold text-base press active:bg-red-800 disabled:opacity-50 mt-2"
          >
            {loading ? '⏳ Aguarde...' : foundCustomer ? 'Continuar' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
