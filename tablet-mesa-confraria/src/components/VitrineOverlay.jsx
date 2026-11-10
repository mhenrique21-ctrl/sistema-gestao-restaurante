import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useComandaStore } from '../store/useComandaStore';
import { fetchHighlights } from '../lib/api';
import Icon from './Icon';

// Placeholder só pro caso "comanda com item" (sugestão contextual ligada ao
// que já foi pedido, seção 3.1) -- ainda não é inteligência real, precisa de
// lógica própria (o que sugerir depois do quê) que não fazia parte do
// escopo desta integração. O caso "comanda vazia" já usa dado real
// (/api/highlights, cadastrado pelo dono no App Gestão).
const SUGESTAO_PLACEHOLDER = {
  eyebrow: 'ENQUANTO ISSO, QUE TAL',
  title: 'Uma sobremesa pra fechar com chave de ouro?',
  desc: 'Sugestão de exemplo -- a lógica real de "o que sugerir depois do que já foi pedido" ainda não foi construída.',
  image_url: null,
};

// Reaparece por inatividade (45-60s) mesmo com comanda em andamento —
// decisão explícita do dono (seção 3.1). NÃO mostra quantidade/valor da
// comanda aqui (removido a pedido), e some ao toque em qualquer ponto,
// não só no botão.
export default function VitrineOverlay() {
  const dispensar = useAppStore((s) => s.dispensarVitrine);
  const itens = useComandaStore((s) => s.itens);
  const [destaques, setDestaques] = useState([]);

  useEffect(() => {
    fetchHighlights()
      .then((d) => setDestaques(Array.isArray(d) ? d.filter((h) => h.image_url) : []))
      .catch(() => setDestaques([]));
  }, []);

  const comCarrinho = itens.length > 0;
  const slides = comCarrinho
    ? [SUGESTAO_PLACEHOLDER]
    : destaques.map((h) => ({ eyebrow: 'DESTAQUE DA CASA', title: h.title, desc: h.subtitle || h.price_label || '', image_url: h.image_url }));

  // Sem destaque cadastrado (App Gestão) e sem item no carrinho: nada com
  // foto pra mostrar -- não interrompe o cliente com tela preta à toa
  // (mesmo raciocínio do kiosk.html real).
  if (!slides.length) return null;
  const slide = slides[0];

  return (
    <div
      className="absolute inset-0 z-40 bg-cover bg-center cursor-pointer"
      style={{ backgroundImage: slide.image_url ? `url('${slide.image_url}')` : undefined, backgroundColor: !slide.image_url ? '#1c140e' : undefined }}
      onClick={dispensar}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(13,10,8,.55) 0%, rgba(13,10,8,.35) 35%, rgba(13,10,8,.95) 88%)' }}
      />

      <div className="absolute top-7 left-8 z-10 text-[11.5px] text-cream border border-cream/30 px-3 py-1.5 rounded-full backdrop-blur-[2px]">
        Mesa 07
      </div>

      <div className="absolute left-0 right-0 bottom-0 z-10 px-14 pb-11">
        <div className="text-[11.5px] tracking-[.14em] text-gold mb-3">{slide.eyebrow}</div>
        <div className="font-display font-semibold text-[46px] text-cream max-w-[11ch] leading-[1.08]">{slide.title}</div>
        <div className="text-[14px] text-cream-soft mt-3.5 max-w-[46ch] leading-relaxed">{slide.desc}</div>

        <div className="flex items-center justify-between mt-[34px]">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full bg-gold ${i === 0 ? 'w-5' : 'w-1.5 bg-cream/30'}`} />
            ))}
          </div>
          <button className="bg-gold border-none text-ink font-body font-semibold text-[14.5px] px-[30px] py-[15px] rounded-xl flex items-center gap-2.5">
            Continuar pedido
            <Icon path="M5 12h14M13 6l6 6-6 6" strokeWidth={2} className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
