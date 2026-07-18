import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { onMessage, connectWS } from '../ws'

const TERMINAL_STATUSES = ['entregue', 'cancelado']

const STEPS = [
  { status: 'aguardando_pagamento', label: 'Aguardando pagamento', icon: '⏳' },
  { status: 'pago',                 label: 'Pagamento confirmado', icon: '✅' },
  { status: 'confirmado',           label: 'Pedido confirmado',    icon: '📋' },
  { status: 'pronto',               label: 'Pronto para entrega',  icon: '🎉' },
  { status: 'saiu_para_entrega',    label: 'Saiu para entrega',    icon: '🛵' },
  { status: 'entregue',             label: 'Entregue',             icon: '🏠' },
]

function money(v) {
  return parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function OrderStatusPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getOrder(id).then(setOrder).catch(console.error).finally(() => setLoading(false))
    const token = localStorage.getItem('token')
    if (token) connectWS(token)
    const unsub = onMessage((msg) => {
      if (msg.event === 'status_update' && msg.order_id === id)
        setOrder((prev) => prev ? { ...prev, status: msg.status } : prev)
      if (msg.event === 'payment_confirmed' && msg.order_id === id)
        api.getOrder(id).then(setOrder)
    })

    // Pedidos de convidado não têm token de login, então o WS acima nunca conecta —
    // sem polling a tela ficava travada em "aguardando pagamento" pra sempre depois
    // do cliente pagar. Busca de novo a cada 5s até o pedido sair de um status final.
    const poll = setInterval(() => {
      setOrder((prev) => {
        if (prev && TERMINAL_STATUSES.includes(prev.status)) return prev
        api.getOrder(id).then(setOrder).catch(() => {})
        return prev
      })
    }, 5000)

    return () => { unsub(); clearInterval(poll) }
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-3xl animate-spin">⏳</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4" style={{ background: 'var(--bg)' }}>
        <span className="text-5xl">😕</span>
        <p style={{ color: 'var(--muted)' }}>Pedido não encontrado</p>
        <button onClick={() => navigate('/')} className="font-bold press" style={{ color: 'var(--gold)' }}>Voltar ao início</button>
      </div>
    )
  }

  const currentIdx = STEPS.findIndex((s) => s.status === order.status)
  const isCancelled = order.status === 'cancelado'
  const currentStep = STEPS[currentIdx]
  const estimatedMin = { pronto: 5, saiu_para_entrega: 30 }[order.status]

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header dourado */}
      <div className="safe-top px-4 pt-4 pb-6" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/orders')} className="press w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--card)', color: 'var(--cream)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h1 className="flex-1 text-lg font-black" style={{ color: 'var(--cream)' }}>Acompanhar Pedido</h1>
        </div>

        <div className="rounded-2xl p-4" style={{ background: 'rgba(201,162,94,0.1)', border: '1px solid rgba(201,162,94,0.25)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--gold-dim)' }}>
            Pedido #{id.slice(-6).toUpperCase()}
          </p>
          <p className="text-lg font-black" style={{ color: isCancelled ? 'var(--danger)' : 'var(--gold)' }}>
            {isCancelled ? '❌ Cancelado' : currentStep?.icon + ' ' + (currentStep?.label || order.status)}
          </p>
          {estimatedMin && (
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>⏱ Estimativa: ~{estimatedMin} min</p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-24 space-y-4">
        {/* Progress timeline */}
        {!isCancelled && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--gold)' }}>Status</p>
            <div className="space-y-0">
              {STEPS.map((step, idx) => {
                const done = idx <= currentIdx
                const current = idx === currentIdx
                const isLast = idx === STEPS.length - 1
                return (
                  <div key={step.status} className="flex gap-3">
                    {/* Timeline line */}
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 transition-all`}
                        style={{
                          background: done ? 'var(--gold)' : 'var(--surface)',
                          color: done ? '#FFFFFF' : 'var(--muted)',
                          boxShadow: current ? '0 0 0 4px rgba(201,162,94,0.2)' : 'none',
                        }}>
                        {done ? step.icon : '○'}
                      </div>
                      {!isLast && (
                        <div className="w-0.5 flex-1 min-h-4 my-1"
                          style={{ background: done ? 'var(--gold-dim)' : 'var(--border)' }} />
                      )}
                    </div>
                    <div className="flex-1 pb-3">
                      <p className="text-sm font-semibold" style={{ color: done ? 'var(--cream)' : 'var(--muted)' }}>
                        {step.label}
                      </p>
                      {current && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block"
                          style={{ background: 'rgba(201,162,94,0.15)', color: 'var(--gold)' }}>
                          Agora
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Itens */}
        {order.items && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--gold)' }}>Itens</p>
            <div className="space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--muted)' }}>{item.quantity}× {item.product_name}</span>
                  <span className="font-bold" style={{ color: 'var(--cream)' }}>{money(item.subtotal)}</span>
                </div>
              ))}
            </div>
            <div className="gold-line my-3" />
            <div className="flex justify-between font-black text-sm">
              <span style={{ color: 'var(--cream)' }}>Total</span>
              <span style={{ color: 'var(--gold)' }}>{money(order.total)}</span>
            </div>
          </div>
        )}

        <button onClick={() => navigate('/')} className="btn-gold w-full py-4 text-sm">
          Fazer novo pedido
        </button>
      </div>
    </div>
  )
}
