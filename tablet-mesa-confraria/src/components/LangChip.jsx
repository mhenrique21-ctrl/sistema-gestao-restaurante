import { useState } from 'react';
import Icon from './Icon';

// Interface pronta, aguardando conteúdo traduzido (pendência da seção 6) —
// trocar de idioma só muda o chip selecionado por enquanto, não existe
// conteúdo EN/ES ainda pra de fato traduzir a tela.
const IDIOMAS = [
  { code: 'PT', label: 'Português', flag: '🇧🇷' },
  { code: 'EN', label: 'English', flag: '🇺🇸' },
  { code: 'ES', label: 'Español', flag: '🇪🇸' },
];

export default function LangChip() {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('PT');

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="min-h-11 flex items-center gap-2 bg-surface-2 border border-line rounded-full px-4"
      >
        <Icon path="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" className="w-[13px] h-[13px] text-cream-soft" />
        <span className="text-[11.5px] text-cream-soft font-semibold tracking-[.02em]">{atual}</span>
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-[calc(100%+6px)] z-20 bg-surface border border-line rounded-xl p-1.5 flex flex-col gap-0.5 w-40">
            {IDIOMAS.map((i) => (
              <button
                key={i.code}
                onClick={() => { setAtual(i.code); setAberto(false); }}
                className={`min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-[13px] text-left ${i.code === atual ? 'bg-surface-2 text-cream' : 'text-cream-soft'}`}
              >
                <span className="text-[15px]">{i.flag}</span> {i.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
