import { useNavigate } from 'react-router-dom'
import { useCart } from '../store/cart'
import { useAuth } from '../store/auth'

export default function CartPage() {
  const { items, updateQty, removeItem, clear } = useCart()
  const { customer } = useAuth()
  const navigate = useNavigate()

  const subtotal = items.reduce((s, i) => s + i.product.price * i.qty, 0)
  const deliveryFee = 5.00
  const total = subtotal + deliveryFee

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-8 pb-20">
        <span className="text-7xl">🛒</span>
        <h2 className="text-xl font-bold text-gray-900">Carrinho vazio</h2>
        <p className="text-gray-400 text-sm text-center">Adicione itens do cardápio para continuar</p>
        <button
          onClick={() => navigate('/')}
          className="bg-violet-600 text-white px-6 py-3 rounded-2xl font-semibold press"
        >
          Ver cardápio
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white safe-top px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 text-xl press">←</button>
          <h1 className="text-lg font-bold text-gray-900">Meu Carrinho</h1>
          <button onClick={clear} className="ml-auto text-red-400 text-sm font-medium press">Limpar</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
        {/* Items */}
        <div className="px-4 pt-4 space-y-3">
          {items.map((item) => (
            <div key={item.key} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-start gap-3">
                <div className="w-14 h-14 bg-violet-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                  ☕
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{item.product.name}</p>
                  {item.extras.length > 0 && (
                    <p className="text-xs text-violet-500 mt-0.5">{item.extras.join(' · ')}</p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-gray-400 mt-0.5 italic">"{item.notes}"</p>
                  )}
                  <p className="text-violet-600 font-bold text-sm mt-1">
                    {(item.product.price * item.qty).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                </div>
                <button onClick={() => removeItem(item.key)} className="text-gray-300 text-xl press">🗑</button>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-400">
                  {item.product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} cada
                </span>
                <div className="flex items-center gap-3 bg-gray-100 rounded-xl px-2 py-1">
                  <button onClick={() => updateQty(item.key, item.qty - 1)} className="w-7 h-7 flex items-center justify-center text-lg text-gray-600 press">−</button>
                  <span className="w-5 text-center font-bold text-sm">{item.qty}</span>
                  <button onClick={() => updateQty(item.key, item.qty + 1)} className="w-7 h-7 flex items-center justify-center text-lg text-violet-600 press">+</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Resumo */}
        <div className="mx-4 mt-4 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Resumo do pedido</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Taxa de entrega</span>
              <span>{deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span>
              <span className="text-violet-600">{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="p-4 bg-white border-t border-gray-100 safe-bottom">
        <button
          onClick={() => navigate(customer ? '/checkout' : '/login')}
          className="w-full bg-violet-600 text-white rounded-2xl py-4 font-bold text-base press active:bg-violet-700 flex items-center justify-between px-5"
        >
          <span>{customer ? 'Finalizar pedido' : 'Entrar para continuar'}</span>
          <span>{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
        </button>
      </div>
    </div>
  )
}
