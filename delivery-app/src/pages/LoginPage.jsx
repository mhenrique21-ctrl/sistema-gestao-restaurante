import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../store/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [tab, setTab] = useState('login') // login | register
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function handleLogin() {
    if (!form.email || !form.password) { setError('Preencha email e senha'); return }
    setLoading(true); setError('')
    try {
      const data = await api.login(form.email, form.password)
      // Busca dados do customer pelo email (staff users redirecionam)
      login(data.token, { id: data.user.id, name: data.user.name, email: data.user.email })
      navigate(-1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister() {
    if (!form.name || !form.phone) { setError('Nome e telefone são obrigatórios'); return }
    setLoading(true); setError('')
    try {
      const customer = await api.createCustomer({
        name: form.name,
        phone: form.phone.replace(/\D/g, ''),
        email: form.email || undefined,
      })
      // Loga automaticamente com dados básicos
      login('customer-token-' + customer.id, { id: customer.id, name: customer.name, phone: customer.phone })
      navigate(-1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-violet-600 safe-top text-white px-4 pt-4 pb-8 text-center">
        <button onClick={() => navigate(-1)} className="absolute left-4 top-4 text-violet-200 press safe-top" style={{ marginTop: 'env(safe-area-inset-top)' }}>← Voltar</button>
        <div className="text-5xl mt-2 mb-2">☕</div>
        <h1 className="text-2xl font-bold">Confraria</h1>
        <p className="text-violet-200 text-sm mt-1">Entre para finalizar seu pedido</p>
      </div>

      <div className="flex-1 px-4 -mt-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
          {/* Tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
            {[{ id: 'login', label: 'Entrar' }, { id: 'register', label: 'Cadastrar' }].map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError('') }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all press ${tab === t.id ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-400'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {tab === 'register' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Nome completo</label>
                  <input
                    type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                    placeholder="João Silva"
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">WhatsApp / Telefone</label>
                  <input
                    type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)}
                    placeholder="(11) 99999-0001"
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">E-mail (opcional)</label>
                  <input
                    type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                    placeholder="joao@email.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-violet-400"
                  />
                </div>
              </>
            )}

            {tab === 'login' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 font-medium">E-mail</label>
                  <input
                    type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                    placeholder="admin@confraria.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Senha</label>
                  <input
                    type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
                    placeholder="••••••••"
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mt-1 focus:outline-none focus:border-violet-400"
                  />
                </div>
              </>
            )}

            {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-xl">{error}</p>}

            <button
              onClick={tab === 'login' ? handleLogin : handleRegister}
              disabled={loading}
              className="w-full bg-violet-600 text-white rounded-2xl py-4 font-bold text-base press active:bg-violet-700 disabled:opacity-60 mt-2"
            >
              {loading ? '⏳ Aguarde...' : tab === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
