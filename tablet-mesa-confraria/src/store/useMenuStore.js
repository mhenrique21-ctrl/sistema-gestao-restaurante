import { create } from 'zustand';
import { fetchMenu, fetchCondensedConfig, fetchPopulares } from '../lib/api';

// Ícone linear por nome de categoria -- o backend manda emoji (mesmo padrão
// do kiosk.html: cat.icon || CAT_ICONS[cat.name] || fallback), mas o sistema
// visual daqui é ícone linear fino (seção 4.3), não emoji. Mapeia por nome
// pra manter a identidade visual mesmo vindo de dado real.
const ICON_POR_NOME = {
  'Café': 'M4 8h13a3 3 0 0 1 0 6h-1M4 8v7a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2M4 8V5',
  'Cafés': 'M4 8h13a3 3 0 0 1 0 6h-1M4 8v7a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2M4 8V5',
  'Padaria': 'M3 10h18M4 10l1 9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2l1-9M8 10V6a4 4 0 0 1 8 0v4',
  'Bebidas': 'M7 3h10l-1 6a4 4 0 0 1-8 0L7 3zM9 21h6M12 13v8',
  'Sobremesas': 'M4 21h16M6 21V9a6 6 0 0 1 12 0v12',
  'Doces': 'M4 21h16M6 21V9a6 6 0 0 1 12 0v12',
  'Salgados': 'M12 3c3 2 5 5 5 8a5 5 0 0 1-10 0c0-3 2-6 5-8z',
};
const ICON_PADRAO = 'M4 4h16v16H4z';

function iconeDaCategoria(nome) {
  const chave = Object.keys(ICON_POR_NOME).find((k) => nome.includes(k));
  return chave ? ICON_POR_NOME[chave] : ICON_PADRAO;
}

export const useMenuStore = create((set, get) => ({
  categories: [],
  condensedConfig: { categories: {} },
  maisPedidos: [],
  loading: true,
  error: null,

  carregar: async () => {
    set({ loading: true, error: null });
    try {
      const [menu, condensed, maisPedidos] = await Promise.all([
        fetchMenu(),
        fetchCondensedConfig(),
        fetchPopulares().catch(() => []), // selo é bônus -- sem rede pro /populares, cardápio ainda funciona
      ]);
      const categories = menu
        .filter((c) => (c.products || []).length > 0)
        .map((c) => ({ ...c, iconPath: iconeDaCategoria(c.name) }));
      set({ categories, condensedConfig: condensed, maisPedidos, loading: false });
    } catch (e) {
      set({ error: e.message || 'Erro ao carregar cardápio', loading: false });
    }
  },

  // "kind" decide o modo de exibição (seção 5): categoria marcada como
  // "cartão único" no App Gestão (Configurações → Autoatendimento) vira
  // lista de sabores sem foto; as demais ficam na grade normal.
  kindDaCategoria: (categoryId) => {
    const cfg = get().condensedConfig.categories?.[categoryId];
    return cfg?.condensed ? 'sabores' : 'grid';
  },
}));
