import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../store/auth'

const STATUS = {
  aguardando_pagamento: { label: 'Aguardando', color: '#C9A25E', bg: 'rgba(201,162,94,0.12)' },
  pago:                 { label: 'Pago', color: '#4CAF80', bg: 'rgba(76,175,128,0.12)' },
  confirmado:           { label: 'Confirmado', color: '#4CAF80', bg: 'rgba(76,175,128,0.12)' },
  em_preparo:           { label: 'Em preparo', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  pronto:               { label: 'Pronto!', color: '#4CAF80', bg: 'rgba(76,175,128,0.12)' },
  saiu_para_entrega:    { label: 'A caminho 🛵', color: '#C9A25E', bg: 'rgba(201,162,94,0.12)' },
  entregue:             { label: 'Entregue ✓', color: '#4CAF80', bg: 'rgba(76,175,128,0.12)' },
  cancelado:            { label: 'Cancelado', color: '#E05252', bg: 'rgba(224,82,82,0.12)' },
}

function money(v) {
  return parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Tela para busca por telefone quando não há customer salvo
function PhoneLookup({ onFound }) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function formatPhone(val) {
    const d = val.replace(/\D/g, '').slice(0, 11)
    if (d.length <= 2) return d
    if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  }

  async function buscar(e) {
    e.preventDefault()
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) { setError('Digite um telefone válido'); return }
    setLoading(true); setError('')
    try {
      const orders = await api.getCustomerOrders(digits)
      onFound(digits, orders)
    } catch {
      setError('Nenhum pedido encontrado para esse telefone')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-5 px-8 pb-24" style={{ background: 'var(--bg)' }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl" style={{ background: 'var(--card)' }}>📋</div>
      <h2 className="text-xl font-black text-center" style={{ color: 'var(--cream)' }}>Meus Pedidos</h2>
      <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>Digite seu telefone para ver seu histórico de pedidos</p>
      <form onSubmit={buscar} className="w-full space-y-3">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          placeholder="(96) 99999-9999"
          className="w-full px-4 py-3 rounded-2xl text-center text-lg font-semibold outline-none"
          style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--cream)' }}
        />
        {error && <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit" disabled={loading} className="btn-gold w-full py-4 text-sm">
          {loading ? 'Buscando...' : 'Ver meus pedidos'}
        </button>
      </form>
    </div>
  )
}

export default function OrdersPage() {
  const { customer } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [phone, setPhone] = useState(null)

  // Se já tem customer salvo, carrega automaticamente
  useEffect(() => {
    if (customer?.phone) {
      const digits = customer.phone.replace(/\D/g, '')
      setPhone(digits)
      setLoading(true)
      api.getCustomerOrders(digits)
        .then(setOrders)
        .catch(() => setOrders([]))
        .finally(() => setLoading(false))
    }
  }, [customer])

  function handleFound(digits, orders) {
    setPhone(digits)
    setOrders(orders)
  }

  // Sem telefone conhecido: mostrar tela de busca
  if (!phone && !customer?.phone) {
    return <PhoneLookup onFound={handleFound} />
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="safe-top flex-shrink-0 px-4 pt-4 pb-4" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black" style={{ color: 'var(--cream)' }}>Meus Pedidos</h1>
            {customer?.name && (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Olá, {customer.name.split(' ')[0]} 👋</p>
            )}
          </div>
          {/* Botão trocar telefone */}
          {!customer?.phone && (
            <button onClick={() => { setPhone(null); setOrders([]) }}
              className="text-xs font-semibold press px-3 py-1.5 rounded-xl"
              style={{ background: 'var(--card)', color: 'var(--muted)' }}>
              Trocar
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-28 space-y-3">
        {loading ? (
          [1,2,3].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl" style={{ background: 'var(--card)' }}>📋</div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Nenhum pedido encontrado</p>
            <button onClick={() => navigate('/')} className="text-sm font-bold press" style={{ color: 'var(--gold)' }}>
              Ver cardápio →
            </button>
          </div>
        ) : (
          orders.map((order) => {
            const s = STATUS[order.status] || { label: order.status, color: 'var(--muted)', bg: 'var(--card)' }
            return (
              <button key={order.id} onClick={() => navigate(`/order/${order.id}`)}
                className="w-full text-left press rounded-2xl p-4 fade-in"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-sm" style={{ color: 'var(--cream)' }}>
                    Pedido #{(order.order_number || order.id.slice(-6)).toString().toUpperCase()}
                  </p>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{ background: s.bg, color: s.color }}>{s.label}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {order.item_count} {order.item_count === 1 ? 'item' : 'itens'} · {new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-black text-sm" style={{ color: 'var(--gold)' }}>{money(order.total)}</span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
