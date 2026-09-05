import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'

const BASE = import.meta.env.VITE_API_URL || ''

const INPUT = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  color: 'var(--cream)',
  borderRadius: 14,
  padding: '14px 16px',
  fontSize: 15,
  outline: 'none',
  width: '100%',
  fontFamily: 'inherit',
}
const LABEL = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  display: 'block',
  marginBottom: 6,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

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
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* Hero da marca */}
      <div className="safe-top relative overflow-hidden px-6 pt-10 pb-12"
        style={{ background: 'linear-gradient(160deg, #4a3421 0%, #2b1c10 100%)' }}>

        {/* Voltar — alvo de toque 44px */}
        <button onClick={() => navigate(-1)} aria-label="Voltar"
          className="press absolute left-4 w-11 h-11 rounded-2xl flex items-center justify-center z-10"
          style={{ background: 'rgba(255,255,255,0.12)', top: 'calc(16px + env(safe-area-inset-top))' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {/* Ornamentos */}
        <div className="absolute rounded-full pointer-events-none"
          style={{ top: -40, right: -40, width: 180, height: 180, background: 'var(--gold-soft)' }} />
        <div className="absolute rounded-full pointer-events-none"
          style={{ bottom: -20, right: 40, width: 80, height: 80, background: 'rgba(138,82,39,0.09)' }} />

        <div className="flex flex-col items-center text-center mt-3">
          <div className="flex items-center justify-center mb-4"
            style={{ width: 72, height: 72, borderRadius: 22, background: 'rgba(138,82,39,0.20)', border: '1px solid rgba(138,82,39,0.35)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          </div>
          <h1 className="font-display font-bold" style={{ fontSize: 28, color: '#FFFFFF' }}>Confraria Café</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Informe seus dados para continuar</p>
        </div>
      </div>

      {/* Card do formulário, elevado sobre o hero */}
      <div className="flex-1 flex flex-col" style={{ marginTop: -24 }}>
        <div className="flex-1 px-5 pt-7 pb-6"
          style={{ background: 'var(--card)', borderRadius: '28px 28px 0 0', boxShadow: '0 -8px 32px rgba(61,42,26,0.12)' }}>

          <div className="mb-4">
            <label style={LABEL}>WhatsApp *</label>
            <div className="relative">
              <input
                type="tel"
                value={phone}
                onChange={e => {
                  const d = e.target.value.replace(/\D/g, '').slice(0, 11)
                  let masked = d
                  if (d.length > 2) masked = `(${d.slice(0, 2)}) ${d.slice(2)}`
                  if (d.length > 7) masked = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
                  setPhone(masked)
                  setFoundCustomer(null)
                  setName('')
                  if (d.length >= 10) lookupByPhone(d)
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--gold)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                placeholder="(96) 99999-0000"
                maxLength={15}
                style={INPUT}
              />
              {lookingUp && (
                <span className="absolute text-xs" style={{ right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>
                  Buscando…
                </span>
              )}
            </div>
          </div>

          {phoneReady && !lookingUp && (
            foundCustomer ? (
              <div className="flex items-center gap-3 mb-5 px-4 py-3.5 fade-in"
                style={{ background: 'rgba(67,160,71,0.08)', border: '1px solid rgba(67,160,71,0.25)', borderRadius: 16 }}>
                <div className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(67,160,71,0.15)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate" style={{ color: '#2E7D32' }}>{foundCustomer.name}</p>
                  <p className="text-xs" style={{ color: 'var(--green)' }}>Bem-vindo de volta!</p>
                </div>
                <button onClick={() => { setFoundCustomer(null); setPhone(''); setName('') }} aria-label="Trocar número"
                  className="press w-11 h-11 -mr-2 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ) : (
              <div className="mb-5 fade-in">
                <label style={LABEL}>Nome completo *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onFocus={e => { e.target.style.borderColor = 'var(--gold)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                  placeholder="João Silva"
                  style={INPUT}
                />
              </div>
            )
          )}

          {error && (
            <p className="text-sm px-4 py-3 mb-4"
              style={{ background: 'rgba(216,67,67,0.10)', color: 'var(--danger)', borderRadius: 14 }}>
              {error}
            </p>
          )}

          {/* CTA — full-width, 56px */}
          <button
            onClick={handleSubmit}
            disabled={loading || !phoneReady}
            className="btn-gold w-full"
            style={{ height: 56, fontSize: 16 }}
          >
            {loading ? 'Aguarde…' : foundCustomer ? 'Continuar' : 'Entrar'}
          </button>

          <p className="text-center text-xs mt-4 leading-relaxed" style={{ color: 'var(--muted)' }}>
            Ao continuar você aceita nossos<br />
            <span style={{ color: 'var(--gold-dim)', fontWeight: 600 }}>termos de uso e privacidade</span>
          </p>
        </div>
      </div>
    </div>
  )
}
