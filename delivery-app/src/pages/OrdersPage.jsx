import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../store/auth'

const STATUS_LABEL = {
  aguardando_pagamento: { label: 'Aguardando', color: 'bg-yellow-100 text-yellow-700' },
  pago: { label: 'Pago', color: 'bg-blue-100 text-blue-700' },
  confirmado: { label: 'Confirmado', color: 'bg-blue-100 text-blue-700' },
  em_preparo: { label: 'Em preparo', color: 'bg-orange-100 text-orange-700' },
  pronto: { label: 'Pronto', color: 'bg-green-100 text-green-700' },
  saiu_para_entrega: { label: 'A caminho', color: 'bg-violet-100 text-violet-700' },
  entregue: { label: 'Entregue', color: 'bg-green-100 text-green-700' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
}

export default function OrdersPage() {
  const { customer } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!customer) return
    api.getOrders().then(setOrders).catch(console.error).finally(() => setLoading(false))
  }, [customer])

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-8 pb-24">
        <span className="text-6xl">🔐</span>
        <h2 className="text-xl font-bold text-gray-900">Entre na sua conta</h2>
        <p className="text-gray-400 text-sm text-center">Para ver seu histórico de pedidos</p>
        <button onClick={() => navigate('/login')} className="bg-violet-600 text-white px-6 py-3 rounded-2xl font-semibold press">
          Entrar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="bg-white safe-top px-4 pt-4 pb-3 border-b border-gray-100">
        <h1 className="text-lg font-bold text-gray-900">Meus Pedidos</h1>
        <p className="text-sm text-gray-400">Olá, {customer.name?.split(' ')[0]} 👋</p>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 pb-24 space-y-3">
        {loading ? (
          [1,2,3].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="text-5xl">📋</span>
            <p className="text-gray-400 text-sm">Nenhum pedido ainda</p>
            <button onClick={() => navigate('/')} className="text-violet-600 font-semibold text-sm press">
              Ver cardápio →
            </button>
          </div>
        ) : (
          orders.map((order) => {
            const s = STATUS_LABEL[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-600' }
            return (
              <button
                key={order.id}
                onClick={() => navigate(`/order/${order.id}`)}
                className="w-full bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-left press"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-900 text-sm">
                    Pedido #{order.id.slice(-6).toUpperCase()}
                  </p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>{order.item_count} {order.item_count == 1 ? 'item' : 'itens'}</span>
                  <span className="font-semibold text-gray-900">
                    {parseFloat(order.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>
                <p className="text-xs text-gray-300 mt-1">
                  {new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
