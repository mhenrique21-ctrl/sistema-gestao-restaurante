import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { onMessage, connectWS } from '../ws'

const STEPS = [
  { status: 'aguardando_pagamento', label: 'Aguardando pagamento', icon: '⏳' },
  { status: 'pago', label: 'Pagamento confirmado', icon: '✅' },
  { status: 'confirmado', label: 'Pedido confirmado', icon: '📋' },
  { status: 'em_preparo', label: 'Em preparo', icon: '👨‍🍳' },
  { status: 'pronto', label: 'Pronto!', icon: '🎉' },
  { status: 'saiu_para_entrega', label: 'Saiu para entrega', icon: '🛵' },
  { status: 'entregue', label: 'Entregue', icon: '🏠' },
]

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
      if (msg.event === 'status_update' && msg.order_id === id) {
        setOrder((prev) => prev ? { ...prev, status: msg.status } : prev)
      }
      if (msg.event === 'payment_confirmed' && msg.order_id === id) {
        api.getOrder(id).then(setOrder)
      }
    })

    return unsub
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin text-4xl">⏳</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <span className="text-5xl">😕</span>
        <p className="text-gray-500">Pedido não encontrado</p>
        <button onClick={() => navigate('/')} className="text-violet-600 font-semibold">Voltar ao início</button>
      </div>
    )
  }

  const currentIdx = STEPS.findIndex((s) => s.status === order.status)
  const isCancelled = order.status === 'cancelado'

  const estimatedMin = { em_preparo: 20, pronto: 5, saiu_para_entrega: 30 }[order.status]

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-violet-600 safe-top text-white px-4 pt-4 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/orders')} className="text-violet-200 press">←</button>
          <h1 className="text-lg font-bold">Acompanhar Pedido</h1>
        </div>
        <div className="bg-white/20 rounded-2xl p-4">
          <p className="text-violet-200 text-xs mb-1">Pedido #{id.slice(-6).toUpperCase()}</p>
          <p className="text-white font-bold text-lg">
            {isCancelled ? '❌ Cancelado' : STEPS[currentIdx]?.label || order.status}
          </p>
          {estimatedMin && (
            <p className="text-violet-200 text-sm mt-1">⏱ Estimativa: ~{estimatedMin} min</p>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 pb-24">
        {/* Progress */}
        {!isCancelled && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4 text-sm">Status do pedido</h3>
            <div className="space-y-3">
              {STEPS.map((step, idx) => {
                const done = idx <= currentIdx
                const current = idx === currentIdx
                return (
                  <div key={step.status} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 transition-all ${
                      done ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-300'
                    } ${current ? 'ring-4 ring-violet-100' : ''}`}>
                      {done ? step.icon : '○'}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${done ? 'text-gray-900' : 'text-gray-300'}`}>
                        {step.label}
                      </p>
                    </div>
                    {current && (
                      <span className="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-medium animate-pulse">
                        Agora
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Itens */}
        {order.items && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Itens do pedido</h3>
            <div className="space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.quantity}× {item.product_name}</span>
                  <span className="text-gray-900 font-medium">
                    {parseFloat(item.subtotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-3 pt-3 flex justify-between font-bold text-sm">
              <span>Total</span>
              <span className="text-violet-600">
                {parseFloat(order.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => navigate('/')}
          className="w-full bg-violet-600 text-white rounded-2xl py-3 font-semibold press"
        >
          Fazer novo pedido
        </button>
      </div>
    </div>
  )
}
