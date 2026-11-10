import Rail from '../components/Rail';
import LangChip from '../components/LangChip';
import Icon from '../components/Icon';
import { useAppStore } from '../store/useAppStore';
import { useMenuStore } from '../store/useMenuStore';

function fmt(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// PASSO 3 / seção 4.3-4.4. "kind" (grid vs sabores) vem da config real de
// categoria em cartão único (Configurações → Autoatendimento no App Gestão),
// não de um campo inventado no mock -- ver useMenuStore.kindDaCategoria.
export default function Cardapio() {
  const activeCategoryId = useAppStore((s) => s.activeCategoryId);
  const selectCategory = useAppStore((s) => s.selectCategory);
  const abrirSabores = useAppStore((s) => s.abrirSabores);
  const abrirAdicionais = useAppStore((s) => s.abrirAdicionais);
  const iniciarBusca = useAppStore((s) => s.iniciarBusca);
  const iniciarScan = useAppStore((s) => s.iniciarScan);

  const categories = useMenuStore((s) => s.categories);
  const loading = useMenuStore((s) => s.loading);
  const error = useMenuStore((s) => s.error);
  const maisPedidos = useMenuStore((s) => s.maisPedidos);
  const kindDaCategoria = useMenuStore((s) => s.kindDaCategoria);
  const carregar = useMenuStore((s) => s.carregar);

  if (loading) return <TelaCarregando />;
  if (error) return <TelaErroCardapio onTentar={carregar} />;

  const cat = categories.find((c) => c.id === activeCategoryId) || categories[0];
  if (!cat) return <TelaCarregando texto="Nenhuma categoria disponível no momento." />;

  const kind = kindDaCategoria(cat.id);
  const disponiveis = (cat.products || []).filter((p) => p.available);

  const handleCardClick = (product) => {
    if (kind === 'sabores') abrirSabores(cat);
    else abrirAdicionais({ ...product, categoryId: cat.id });
  };

  return (
    <div className="flex-1 flex min-h-0">
      <Rail activeCategoryId={cat.id} categories={categories} onSelect={selectCategory} />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-[34px] pt-7 pb-4 flex items-baseline justify-between">
          <div className="font-display font-semibold text-[27px] text-cream">{cat.name}</div>
          <div className="flex items-center gap-3.5 shrink-0">
            {disponiveis.length > 0 && (
              <div className="text-[12px] text-cream-soft opacity-70">{disponiveis.length} itens</div>
            )}
            <button onClick={iniciarBusca} className="w-11 h-11 shrink-0 rounded-full border border-line flex items-center justify-center text-cream-soft">
              <Icon path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" strokeWidth={2} className="w-4 h-4" />
            </button>
            <button onClick={() => iniciarScan('meus-pedidos')} className="min-h-11 text-[12px] font-medium text-cream-soft border border-line rounded-full px-3.5 whitespace-nowrap">
              🧾 Meus pedidos
            </button>
            <button onClick={() => iniciarScan('conta')} className="min-h-11 text-[12px] font-semibold text-ink bg-gold rounded-full px-3.5 whitespace-nowrap">
              💳 Minha conta
            </button>
            <LangChip />
          </div>
        </div>

        {disponiveis.length === 0 ? (
          <CategoriaVazia cat={cat} categories={categories} onIrPara={selectCategory} />
        ) : kind === 'sabores' ? (
          <SaboresPreview cat={cat} disponiveis={disponiveis} onOpen={() => abrirSabores(cat)} />
        ) : (
          <div className="flex-1 overflow-y-auto px-[34px] pt-1 pb-[130px] grid grid-cols-2 gap-4">
            {disponiveis.map((p, i) => (
              <button
                key={p.id}
                onClick={() => handleCardClick(p)}
                className="bg-surface border border-line rounded-xl overflow-hidden flex flex-col text-left opacity-0"
                style={{ animation: 'cardIn .5s cubic-bezier(.22,.9,.32,1) forwards', animationDelay: `${0.02 + Math.min(i, 5) * 0.07}s` }}
              >
                <div
                  className="h-[118px] bg-cover bg-center relative"
                  style={{ backgroundImage: p.image_url ? `url('${p.image_url}')` : undefined, backgroundColor: !p.image_url ? '#2c2117' : undefined }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(180deg, transparent 40%, rgba(28,20,14,.92) 100%), linear-gradient(160deg, rgba(207,154,79,.08), transparent 55%)',
                    }}
                  />
                  {maisPedidos.includes(p.id) && (
                    <div className="absolute top-[10px] left-[10px] z-[2] bg-gold/[.16] border border-gold text-gold text-[9.5px] font-semibold px-2 py-[3px] rounded-full tracking-[.02em]">
                      Mais pedido
                    </div>
                  )}
                </div>
                <div className="px-[15px] pt-[13px] pb-[15px]">
                  <div className="font-display font-medium text-[16px] text-cream">{p.name}</div>
                  <div className="text-[11.5px] text-cream-soft opacity-75 mt-1 leading-[1.4] line-clamp-2">{p.description}</div>
                  <div className="flex items-center justify-between mt-[11px]">
                    <span className="font-price font-semibold [font-variant-numeric:tabular-nums] text-[15px] text-gold">
                      {fmt(p.promo_price ?? p.price)}
                    </span>
                    <span className="w-[25px] h-[25px] rounded-full border border-gold text-gold flex items-center justify-center text-sm">+</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TelaCarregando({ texto = 'Carregando cardápio…' }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-[14px] text-cream-soft">{texto}</div>
    </div>
  );
}

function TelaErroCardapio({ onTentar }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-10">
      <div className="w-16 h-16 rounded-full border border-err flex items-center justify-center mb-[22px]">
        <Icon path="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeWidth={1.6} className="w-[26px] h-[26px] text-err" />
      </div>
      <div className="font-display font-medium text-[19px] text-cream text-center">Não conseguimos carregar o cardápio</div>
      <div className="text-[13px] text-cream-soft mt-2 text-center max-w-[34ch] leading-relaxed">Verifique a conexão e tente de novo.</div>
      <button onClick={onTentar} className="mt-6 bg-gold border-none text-ink font-body font-semibold text-[13px] px-5 py-[11px] rounded-[11px] min-h-11">
        🔄 Tentar novamente
      </button>
    </div>
  );
}

// Categoria "sabores" mostra 1 card representativo (PASSO 5): foto + "X
// sabores · a partir de R$ Y", não um card por sabor.
function SaboresPreview({ cat, disponiveis, onOpen }) {
  const aPartirDe = Math.min(...disponiveis.map((p) => p.promo_price ?? p.price));
  const primeiraFoto = disponiveis.find((p) => p.image_url)?.image_url;
  return (
    <div className="flex-1 px-[34px] pt-1 pb-[130px]">
      <button onClick={onOpen} className="bg-surface border border-line rounded-xl overflow-hidden flex text-left w-full max-w-[520px]">
        <div
          className="w-[150px] shrink-0 bg-surface-2 flex items-center justify-center bg-cover bg-center"
          style={primeiraFoto ? { backgroundImage: `url('${primeiraFoto}')` } : undefined}
        >
          {!primeiraFoto && <Icon path="M12 3c3 2 5 5 5 8a5 5 0 0 1-10 0c0-3 2-6 5-8z" className="w-10 h-10 text-gold opacity-70" strokeWidth={1.3} />}
        </div>
        <div className="p-5 flex flex-col justify-center gap-1.5">
          <div className="font-display font-medium text-[17px] text-cream">{cat.name}</div>
          <div className="text-[12.5px] text-cream-soft">{disponiveis.length} sabores · a partir de {fmt(aPartirDe)}</div>
        </div>
      </button>
    </div>
  );
}

// Seção 4.4: variação do cardápio principal. Dispara quando os produtos da
// categoria estão todos indisponíveis no momento (reabastecendo) -- não
// quando a categoria nunca teve produto (essa nem aparece na rail, mesmo
// comportamento do kiosk.html real: "categoria sem produto visível não vai
// pra barra lateral", pra não virar um toque sem saída).
function CategoriaVazia({ cat, categories, onIrPara }) {
  const sugestao = categories.find((c) => c.id !== cat.id && (c.products || []).some((p) => p.available));

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-10">
      <div className="w-16 h-16 rounded-full border border-line flex items-center justify-center mb-[22px]">
        <Icon path="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6" className="w-[26px] h-[26px] text-cream-soft opacity-70" strokeWidth={1.6} />
      </div>
      <div className="font-display font-medium text-[19px] text-cream">Nada disponível aqui agora</div>
      <div className="text-[13px] text-cream-soft mt-2 text-center max-w-[34ch] leading-relaxed">
        {sugestao
          ? `A cozinha está reabastecendo essa categoria. Dá uma olhada em ${sugestao.name} enquanto isso`
          : 'A cozinha está reabastecendo essa categoria.'}
      </div>
      {sugestao && (
        <button
          onClick={() => onIrPara(sugestao.id)}
          className="mt-6 bg-transparent border border-gold text-gold font-body font-semibold text-[13px] px-5 py-[11px] rounded-[11px] min-h-11"
        >
          Ver {sugestao.name}
        </button>
      )}
    </div>
  );
}
