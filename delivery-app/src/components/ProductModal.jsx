import { useState } from 'react'
import { useCart } from '../store/cart'

const EXTRAS_BY_CATEGORY = {
  'Café': ['Sem açúcar', 'Pouco açúcar', 'Extra açúcar', 'Com leite', 'Sem leite', 'Leite vegetal', 'Dose dupla'],
  'Bebidas': ['Sem gelo', 'Com gelo', 'Sem açúcar', 'Extra limão'],
  'Bolos': ['Sem cobertura', 'Extra cobertura', 'Embalado para viagem'],
  'Salgados': ['Sem pimenta', 'Extra recheio', 'Bem assado', 'Embalado'],
}

export default function ProductModal({ product, category, onClose }) {
  const addItem = useCart((s) => s.addItem)
  const [qty, setQty] = useState(1)
  const [extras, setExtras] = useState([])
  const [notes, setNotes] = useState('')

  const options = EXTRAS_BY_CATEGORY[category] || []

  function toggleExtra(e) {
    setExtras((prev) => prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e])
  }

  function handleAdd() {
    addItem(product, qty, extras, notes)
    onClose()
  }

  const total = (product.price * qty).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white w-full max-w-md rounded-t-3xl p-6 pb-8 safe-bottom animate-slide-up"
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
        <p className="text-violet-600 font-bold text-lg mb-4">
          {product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </p>

        {options.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">Personalize</p>
            <div className="flex flex-wrap gap-2">
              {options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => toggleExtra(opt)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all press ${
                    extras.includes(opt)
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-gray-100 rounded-xl px-2 py-1">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 flex items-center justify-center text-xl text-gray-600 press">−</button>
            <span className="w-6 text-center font-bold text-gray-900">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="w-8 h-8 flex items-center justify-center text-xl text-violet-600 press">+</button>
          </div>
          <button
            onClick={handleAdd}
            className="flex-1 bg-violet-600 text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-between px-4 press active:bg-violet-700"
          >
            <span>Adicionar ao carrinho</span>
            <span>{total}</span>
          </button>
        </div>
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
