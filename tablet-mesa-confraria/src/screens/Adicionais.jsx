import { useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { useAppStore } from '../store/useAppStore';
import { useComandaStore } from '../store/useComandaStore';

function fmt(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

// Comportamento crítico #3: SEM seletor de tamanho -- mas fora isso, segue
// a MESMA estrutura de addon_groups do kiosk.html real (kind/required/
// min_select/max_select/options), pra não reinventar uma modelagem paralela
// que o backend não entende quando o pedido for enviado de verdade.
// - kind 'preparo' = grupo de escolha (não muda preço), vira o seletor de
//   duas opções da seção 4.6 quando tem exatamente 2 opções.
// - qualquer outro kind = adicional pago, lista de uma coluna com stepper.
export default function Adicionais() {
  const product = useAppStore((s) => s.activeProduct);
  const voltarAoCardapio = useAppStore((s) => s.voltarAoCardapio);
  const abrirSabores = useAppStore((s) => s.abrirSabores);
  const activeGroup = useAppStore((s) => s.activeGroup);
  const addItem = useComandaStore((s) => s.addItem);

  // { [groupId]: { [optionId]: quantidade } } -- mesmo formato do kiosk.html,
  // assim o corpo que mandamos pro backend (addon_option_id + quantity) sai
  // direto daqui sem tradução.
  const [selecoes, setSelecoes] = useState({});

  if (!product) return null;

  const grupos = (product.addon_groups || []).filter((g) => g.options?.length);
  const preparo = grupos.filter((g) => g.kind === 'preparo');
  const extras = grupos.filter((g) => g.kind !== 'preparo');

  const totalDoGrupo = (groupId) => Object.values(selecoes[groupId] || {}).reduce((s, q) => s + q, 0);
  const qtdDaOpcao = (groupId, optionId) => selecoes[groupId]?.[optionId] || 0;

  const total = useMemo(() => {
    let addonsTotal = 0;
    for (const g of grupos) {
      const m = selecoes[g.id] || {};
      for (const [optId, count] of Object.entries(m)) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) addonsTotal += parseFloat(opt.price || 0) * count;
      }
    }
    return (product.promo_price ?? product.price) + addonsTotal;
  }, [grupos, selecoes, product]);

  const itemCount = grupos.reduce((s, g) => s + totalDoGrupo(g.id), 0);

  function selecionarUnica(groupId, optionId) {
    setSelecoes((prev) => ({ ...prev, [groupId]: { [optionId]: 1 } }));
  }

  function alterarQtd(groupId, optionId, maxSelect, delta) {
    setSelecoes((prev) => {
      const atual = prev[groupId]?.[optionId] || 0;
      const totalAtual = Object.values(prev[groupId] || {}).reduce((s, q) => s + q, 0);
      if (delta > 0 && totalAtual >= maxSelect) return prev;
      const nova = Math.max(0, atual + delta);
      const m = { ...(prev[groupId] || {}) };
      if (nova === 0) delete m[optionId];
      else m[optionId] = nova;
      return { ...prev, [groupId]: m };
    });
  }

  function handleAdicionar() {
    for (const g of grupos) {
      const minimo = g.required ? Math.max(1, g.min_select || 0) : g.min_select || 0;
      if (minimo > 0 && totalDoGrupo(g.id) < minimo) {
        alert(`Selecione ${minimo > 1 ? `ao menos ${minimo} opções` : 'uma opção'} em "${g.name}"`);
        return;
      }
    }
    const addons = [];
    for (const g of grupos) {
      const m = selecoes[g.id] || {};
      for (const [optId, count] of Object.entries(m)) {
        if (count <= 0) continue;
        const opt = g.options.find((o) => o.id === optId);
        if (!opt) continue;
        // name/price ficam pro recálculo local (ex: mudar quantidade do
        // item na revisão) -- api.js reduz isso a addon_option_id+quantity
        // na hora de enviar pro backend.
        addons.push({ addon_option_id: opt.id, name: opt.name, price: parseFloat(opt.price || 0), quantity: count });
      }
    }
    addItem({
      id: `${product.id}-${Date.now()}`,
      product_id: product.id,
      name: product.name,
      unitPrice: product.promo_price ?? product.price,
      qty: 1,
      addons,
      subtotal: total,
    });
    // Croissants/Tapiocas volta pra lista de sabores (fluxo natural: escolher
    // outro sabor da mesma categoria); as demais voltam pro cardápio.
    if (activeGroup) abrirSabores(activeGroup);
    else voltarAoCardapio();
  }

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-[420px] shrink-0 flex flex-col">
        <div
          className="h-[300px] bg-cover bg-center relative shrink-0"
          style={{ backgroundImage: product.image_url ? `url('${product.image_url}')` : undefined, backgroundColor: !product.image_url ? '#251b13' : undefined }}
        >
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(28,20,14,0) 60%, #1c140e 100%)' }} />
          <button
            onClick={() => (activeGroup ? abrirSabores(activeGroup) : voltarAoCardapio())}
            className="absolute top-6 left-6 z-[2] w-11 h-11 rounded-full bg-black/50 backdrop-blur-[3px] flex items-center justify-center text-cream"
          >
            <Icon path="M15 18l-6-6 6-6" strokeWidth={2} className="w-[17px] h-[17px]" />
          </button>
        </div>
        <div className="px-[30px] pt-[22px]">
          <div className="font-display font-semibold text-[26px] text-cream">{product.name}</div>
          <div className="text-[13px] text-cream-soft mt-2.5 leading-[1.55] max-w-[32ch]">{product.description}</div>
          <div className="font-price font-semibold [font-variant-numeric:tabular-nums] text-[16px] text-gold mt-4">{fmt(product.promo_price ?? product.price)}</div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 border-l border-line">
        <div className="flex-1 overflow-y-auto px-[34px] pt-[26px] pb-6">
          {preparo.map((g) => (
            <GrupoPreparo
              key={g.id}
              grupo={g}
              qtdDaOpcao={qtdDaOpcao}
              onSelecionar={(optId) => selecionarUnica(g.id, optId)}
            />
          ))}

          {extras.length > 0 && <div className="text-[11px] font-semibold text-cream-soft tracking-[.04em] mb-3">ADICIONAIS</div>}
          {extras.map((g, gi) => (
            <div key={g.id} className={gi < extras.length - 1 ? 'mb-2' : ''}>
              {g.options.map((opt, i) => {
                const qtd = qtdDaOpcao(g.id, opt.id);
                const isLast = i === g.options.length - 1 && gi === extras.length - 1;
                return (
                  <div key={opt.id} className={`flex items-center justify-between py-[15px] ${!isLast ? 'border-b border-line' : ''}`}>
                    <div className="flex flex-col gap-[3px]">
                      <div className="font-display font-normal text-[15.5px] text-cream">{opt.name}</div>
                      <div className="text-[12px] text-cream-soft">{opt.price > 0 ? `+ ${fmt(opt.price)}` : 'sem custo'}</div>
                    </div>
                    {qtd === 0 ? (
                      <button
                        onClick={() => alterarQtd(g.id, opt.id, g.max_select, 1)}
                        className="w-11 h-11 rounded-full border border-gold text-gold flex items-center justify-center text-base"
                      >
                        +
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 bg-surface-2 rounded-full p-1">
                        <button onClick={() => alterarQtd(g.id, opt.id, g.max_select, -1)} className="w-11 h-11 rounded-full text-gold text-[15px]">−</button>
                        <span className="font-display font-semibold text-[14px] text-cream min-w-[14px] text-center">{qtd}</span>
                        <button onClick={() => alterarQtd(g.id, opt.id, g.max_select, 1)} className="w-11 h-11 rounded-full text-gold text-[15px]">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-line bg-surface px-[34px] py-[18px] flex items-center justify-between">
          <div className="text-cream">
            <div className="text-[11px] text-cream-soft">{itemCount > 0 ? `${itemCount + 1} itens · total` : '1 item · total'}</div>
            <div className="font-display font-semibold text-[20px] mt-0.5">{fmt(total)}</div>
          </div>
          <button onClick={handleAdicionar} className="bg-gold border-none text-ink font-body font-semibold text-[14px] px-[26px] py-[14px] rounded-xl min-h-11">
            Adicionar à comanda
          </button>
        </div>
      </div>
    </div>
  );
}

// Grupo "preparo" com exatamente 2 opções vira o seletor lado a lado da
// seção 4.6; com outra quantidade de opções (0, 1 ou 3+), cai numa lista de
// escolha única simples -- o layout de 2 colunas fixas do mockup não faz
// sentido pra qualquer outro número de opções.
function GrupoPreparo({ grupo, qtdDaOpcao, onSelecionar }) {
  const algumSelecionado = grupo.options.some((o) => qtdDaOpcao(grupo.id, o.id) > 0);

  return (
    <>
      <div className="flex items-center gap-2 text-[11px] font-semibold text-cream-soft tracking-[.04em] mb-3">
        {grupo.name.toUpperCase()}
        {grupo.required && <span className="w-[5px] h-[5px] rounded-full bg-gold" />}
      </div>
      {grupo.options.length === 2 ? (
        <div className="flex gap-2.5 mb-[30px]">
          {grupo.options.map((opt) => {
            const sel = qtdDaOpcao(grupo.id, opt.id) > 0;
            return (
              <button
                key={opt.id}
                onClick={() => onSelecionar(opt.id)}
                className={`flex-1 border rounded-xl p-4 text-left flex flex-col gap-1 min-h-11 ${sel ? 'border-gold bg-gold/[.08]' : 'border-line'}`}
              >
                <span className="font-display font-medium text-[15.5px] text-cream">{opt.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mb-[30px]">
          {grupo.options.map((opt, i) => {
            const sel = qtdDaOpcao(grupo.id, opt.id) > 0;
            return (
              <button
                key={opt.id}
                onClick={() => onSelecionar(opt.id)}
                className={`w-full flex items-center justify-between py-3 px-3 rounded-lg text-left min-h-11 ${sel ? 'bg-gold/[.08] border border-gold' : 'border border-transparent'} ${i > 0 ? 'mt-1.5' : ''}`}
              >
                <span className="font-display font-normal text-[15px] text-cream">{opt.name}</span>
                {sel && <Icon path="M20 6L9 17l-5-5" strokeWidth={2.4} className="w-4 h-4 text-gold" />}
              </button>
            );
          })}
          {!algumSelecionado && !grupo.required && (
            <div className="text-[11px] text-cream-soft mt-1.5">Opcional</div>
          )}
        </div>
      )}
    </>
  );
}
