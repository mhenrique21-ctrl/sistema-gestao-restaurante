import { useMemo, useRef, useEffect } from 'react';
import Icon from '../components/Icon';
import { useAppStore } from '../store/useAppStore';
import { useMenuStore } from '../store/useMenuStore';

function fmt(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

function destacar(nome, termo) {
  const idx = nome.toLowerCase().indexOf(termo.toLowerCase());
  if (idx === -1) return nome;
  return (
    <>
      {nome.slice(0, idx)}
      <mark className="bg-transparent text-gold">{nome.slice(idx, idx + termo.length)}</mark>
      {nome.slice(idx + termo.length)}
    </>
  );
}

// Seção 4.7 (resultado) e 4.12 (vazia, na tabela a spec chama de "busca
// vazia" apesar do número 12 no arquivo).
export default function Busca() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  const abrirAdicionais = useAppStore((s) => s.abrirAdicionais);
  const categories = useMenuStore((s) => s.categories);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const resultados = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return categories.flatMap((c) =>
      (c.products || [])
        .filter((p) => p.available && p.name.toLowerCase().includes(q))
        .map((p) => ({ ...p, categoryName: c.name, categoryId: c.id }))
    );
  }, [searchQuery, categories]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-[34px] pt-[26px] pb-4">
        <div className="flex items-center gap-3 bg-surface border border-gold rounded-[14px] px-[18px]">
          <Icon path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" strokeWidth={2} className="w-[18px] h-[18px] text-gold shrink-0" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar no cardápio"
            className="min-h-11 flex-1 bg-transparent outline-none text-[15px] text-cream placeholder:text-cream-soft"
          />
          {/* min-h-11 próprio (não só o container) -- Passo 7. */}
          <button onClick={voltarAoCardapio} className="min-h-11 px-2 text-[13px] text-cream-soft">Cancelar</button>
        </div>
        {searchQuery.trim() && (
          <div className="text-[12px] text-cream-soft mt-3.5">
            {resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'} para "{searchQuery}"
          </div>
        )}
      </div>

      {searchQuery.trim() && resultados.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-10">
          <div className="w-16 h-16 rounded-full border border-line flex items-center justify-center mb-[22px]">
            <Icon path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" strokeWidth={1.6} className="w-[26px] h-[26px] text-cream-soft opacity-70" />
          </div>
          <div className="font-display font-medium text-[19px] text-cream text-center">
            Nada encontrado para "<mark className="bg-transparent text-gold">{searchQuery}</mark>"
          </div>
          <div className="text-[13px] text-cream-soft mt-2 text-center max-w-[34ch] leading-relaxed">
            Tenta buscar pelo nome do prato ou navega pelas categorias ao lado
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-[34px] pb-6">
          {resultados.map((p, i) => (
            <button
              key={p.id}
              onClick={() => abrirAdicionais(p)}
              className={`w-full flex items-center gap-4 py-[15px] px-1 text-left ${i < resultados.length - 1 ? 'border-b border-line' : ''}`}
            >
              <div
                className="w-16 h-16 rounded-[10px] shrink-0 bg-cover bg-center"
                style={{ backgroundImage: p.image_url ? `url('${p.image_url}')` : undefined, backgroundColor: !p.image_url ? '#2c2117' : undefined }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-display font-medium text-[15.5px] text-cream">{destacar(p.name, searchQuery)}</div>
                <div className="text-[11.5px] text-cream-soft opacity-70 mt-0.5">{p.categoryName}</div>
              </div>
              <span className="font-price font-semibold [font-variant-numeric:tabular-nums] text-[14.5px] text-gold whitespace-nowrap">{fmt(p.promo_price ?? p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
