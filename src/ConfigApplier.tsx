import { useEffect } from 'react';
import type { ConfigAppState } from './ConfigPanel';

export function useApplyConfig(config: ConfigAppState) {
  // Aplicar cores dinamicamente via CSS variables
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--acc', config.tema.corPrimaria);
    root.style.setProperty('--accHover', ajustarBrilho(config.tema.corPrimaria, -20));
    root.style.setProperty('--accLight', `${config.tema.corPrimaria}22`);
    root.style.setProperty('--success', config.tema.corSucesso);
    root.style.setProperty('--btnDanger', config.tema.corErro);
    root.style.setProperty('--dangerText', config.tema.corErro);
  }, [config.tema.corPrimaria, config.tema.corSucesso, config.tema.corErro]);

  // Aplicar fonte e tamanho
  useEffect(() => {
    const style = document.getElementById('config-typography');
    const fontSize = config.tipografia.tamanhoBase;
    const lineHeightMap: Record<string, number> = {
      'Compacta (1.2)': 1.2,
      'Normal (1.6)': 1.6,
      'Espaçada (1.8)': 1.8,
      'Muito Espaçada (2.0)': 2.0,
    };
    const titleSizeMap: Record<string, number> = {
      'Pequeno (16px)': 16,
      'Normal (20px)': 20,
      'Grande (24px)': 24,
      'Muito Grande (28px)': 28,
    };

    const lineHeight = lineHeightMap[config.tipografia.alturaParagrafo] || 1.6;
    const titleSize = titleSizeMap[config.tipografia.tamanhoParagrafo] || 20;

    const css = `
      :root {
        font-family: '${config.tipografia.fonte}', 'Segoe UI', sans-serif;
        font-size: ${fontSize}px;
      }
      body {
        font-family: '${config.tipografia.fonte}', 'Segoe UI', sans-serif;
        font-size: ${fontSize}px;
        line-height: ${lineHeight};
      }
      h1, h2, h3, h4, h5, h6 {
        font-size: ${titleSize}px;
        line-height: ${lineHeight};
      }
      .section-title {
        font-size: ${Math.max(fontSize - 3, 10)}px;
      }
      @import url('https://fonts.googleapis.com/css2?family=${config.tipografia.fonte.replace(/ /g, '+')}:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
    `;

    if (style) {
      style.innerHTML = css;
    } else {
      const newStyle = document.createElement('style');
      newStyle.id = 'config-typography';
      newStyle.innerHTML = css;
      document.head.appendChild(newStyle);
    }
  }, [config.tipografia.fonte, config.tipografia.tamanhoBase, config.tipografia.tamanhoParagrafo, config.tipografia.alturaParagrafo]);

  // Aplicar tema (claro/escuro)
  useEffect(() => {
    if (config.tema.modo === 'claro') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else if (config.tema.modo === 'escuro') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [config.tema.modo]);

  // Retornar funções de formatação que usam as configurações
  return {
    formatarMoeda: (valor: number) => formatarMoeda(valor, config.moeda),
    formatarData: (data: string) => formatarData(data, config.idioma),
    formatarHora: (hora: string) => formatarHora(hora, config.idioma),
    obterIcone: (chave: string) => obterIcone(chave, config.icones),
    obterNomeBotao: (chave: string) => obterNomeBotao(chave, config.botoes),
    idioma: config.idioma.idioma,
  };
}

function ajustarBrilho(cor: string, percent: number): string {
  const hex = cor.replace('#', '');
  const num = parseInt(hex, 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return `#${(
    0x1000000 +
    (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255)
  ).toString(16).slice(1)}`;
}

export function formatarMoeda(valor: number, moedaConfig: ConfigAppState['moeda']): string {
  if (isNaN(valor)) return `${moedaConfig.simbolo} 0${moedaConfig.separadorDecimal}00`;

  const intPart = Math.floor(valor);
  const decPart = Math.round((valor - intPart) * Math.pow(10, moedaConfig.casasDecimais))
    .toString()
    .padStart(moedaConfig.casasDecimais, '0');

  let intFormatted = intPart.toString();
  if (moedaConfig.separadorMilhares) {
    intFormatted = intFormatted.replace(/\B(?=(\d{3})+(?!\d))/g, moedaConfig.separadorMilhares);
  }

  return `${moedaConfig.simbolo} ${intFormatted}${moedaConfig.separadorDecimal}${decPart}`;
}

export function formatarData(data: string, idiomaConfig: ConfigAppState['idioma']): string {
  if (!data) return '';

  const [year, month, day] = data.split('-');

  switch (idiomaConfig.formatoData) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY':
    default:
      return `${day}/${month}/${year}`;
  }
}

export function formatarHora(hora: string, idiomaConfig: ConfigAppState['idioma']): string {
  if (!hora) return '';

  const [h, m] = hora.split(':');
  const hNum = parseInt(h);

  if (idiomaConfig.formatoHora === '12h') {
    const period = hNum >= 12 ? 'PM' : 'AM';
    const h12 = hNum > 12 ? hNum - 12 : hNum === 0 ? 12 : hNum;
    return `${String(h12).padStart(2, '0')}:${m} ${period}`;
  }

  return `${h}:${m}`;
}

export function obterIcone(chave: string, iconesConfig: ConfigAppState['icones']): string {
  const icones: Record<string, string> = {
    vendas: iconesConfig.customVendas,
    compras: iconesConfig.customCompras,
    estoque: iconesConfig.customEstoque,
    producao: iconesConfig.customProducao,
  };
  return icones[chave] || '📌';
}

export function obterNomeBotao(chave: string, botoesConfig: ConfigAppState['botoes']): string {
  return botoesConfig[chave as keyof typeof botoesConfig] || chave;
}

export function ConfigStyleInjector({ config }: { config: ConfigAppState }) {
  useApplyConfig(config);
  return null;
}
