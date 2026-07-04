import { useMemo, useState } from 'react'
import { useCart } from '../store/cart'
import { useNavigate } from 'react-router-dom'

export default function ProductModal({ product, onClose }) {
  const navigate = useNavigate()
  const addItem = useCart((s) => s.addItem)
  const [qty, setQty] = useState(1)
  const [selected, setSelected] = useState({}) // { [groupId]: optionId[] }
  const [notes, setNotes] = useState('')
  const [added, setAdded] = useState(false)

  const groups = product.addon_groups || []

  function toggleOption(group, option) {
    setSelected((prev) => {
      const current = prev[group.id] || []
      const isSelected = current.includes(option.id)

      if (group.max_select === 1) {
        return { ...prev, [group.id]: isSelected ? [] : [option.id] }
      }

      if (isSelected) {
        return { ...prev, [group.id]: current.filter((id) => id !== option.id) }
      }
      if (current.length >= group.max_select) return prev // limite atingido
      return { ...prev, [group.id]: [...current, option.id] }
    })
  }

  const selectedAddons = useMemo(() => {
    const result = []
    for (const group of groups) {
      const ids = selected[group.id] || []
      for (const id of ids) {
        const opt = group.options.find((o) => o.id === id)
        if (opt) result.push(opt)
      }
    }
    return result
  }, [selected, groups])

  const missingRequired = groups.filter(
    (g) => g.required && (selected[g.id] || []).length < g.min_select
  )
  const canAdd = missingRequired.length === 0

  function handleAdd() {
    if (!canAdd) return
    addItem(product, qty, selectedAddons, notes)
    setAdded(true)
  }

  const unitPrice = (product.promo_price ?? product.price) + selectedAddons.reduce((s, a) => s + a.price, 0)
  const total = (unitPrice * qty).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white w-full max-w-md rounded-t-3xl p-6 pb-8 safe-bottom animate-slide-up max-h-[90vh] overflow-y-auto no-scrollbar"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'slideUp 0.25s ease-out' }}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

        <div className="flex justify-between items-start mb-1">
          <h2 className="text-xl font-bold text-gray-900 pr-8">{product.name}</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">×</button>
        </div>
        <p className="text-gray-500 text-sm mb-1">{product.description}</p>
        <div className="flex items-center gap-2 mb-4">
          {product.promo_price != null ? (
            <>
              <p className="text-gray-400 text-sm line-through">
                {product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
              <p className="text-violet-600 font-bold text-lg">
                {product.promo_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
              <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                {product.promo_label || 'OFERTA'}
              </span>
            </>
          ) : (
            <p className="text-violet-600 font-bold text-lg">
              {product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          )}
        </div>

        {groups.map((group) => {
          const current = selected[group.id] || []
          const isMissing = group.required && current.length < group.min_select
          return (
            <div key={group.id} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-semibold text-gray-700">{group.name}</p>
                {group.required && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isMissing ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                    Obrigatório
                  </span>
                )}
                {group.max_select > 1 && (
                  <span className="text-[10px] text-gray-400">até {group.max_select}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.options.map((opt) => {
                  const isSelected = current.includes(opt.id)
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleOption(group, opt)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all press ${
                        isSelected
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      {opt.name}
                      {opt.price > 0 && (
                        <span className={isSelected ? 'text-violet-100' : 'text-gray-400'}>
                          {' '}+{opt.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Observação</p>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: tirar a cereja, caprichoso no leite..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
          />
        </div>

        {/* Qty + Add */}
        {added ? (
          <div className="space-y-3">
            <p className="text-center text-emerald-600 font-semibold text-sm">✅ Item adicionado ao carrinho!</p>
            <button
              onClick={() => { onClose(); navigate('/checkout') }}
              className="w-full bg-violet-600 text-white rounded-xl py-3 font-bold text-sm press active:bg-violet-700"
            >
              🛒 Finalizar Pedido
            </button>
            <button
              onClick={onClose}
              className="w-full border border-gray-200 text-gray-700 rounded-xl py-3 font-semibold text-sm press active:bg-gray-50"
            >
              Continuar Comprando
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-gray-100 rounded-xl px-2 py-1">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 flex items-center justify-center text-xl text-gray-600 press">−</button>
              <span className="w-6 text-center font-bold text-gray-900">{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} className="w-8 h-8 flex items-center justify-center text-xl text-violet-600 press">+</button>
            </div>
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className="flex-1 bg-violet-600 text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-between px-4 press active:bg-violet-700 disabled:opacity-40"
            >
              <span>{canAdd ? 'Adicionar ao carrinho' : 'Escolha as opções obrigatórias'}</span>
              <span>{total}</span>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
