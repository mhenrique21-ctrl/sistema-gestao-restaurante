// Roteamento de itens para estações de preparo
// Cada estação recebe apenas os itens que lhe pertencem

const STATION_ROUTES = {
  bebidas: {
    name: 'Bebidas',
    emoji: '☕',
    categories: ['Café', 'Bebidas'],
    color: '#2563eb',
    printer: process.env.PRINTER_BEBIDAS || null,
  },
  comida_quente: {
    name: 'Comida Quente',
    emoji: '🔥',
    categories: ['Salgados'],
    color: '#dc2626',
    printer: process.env.PRINTER_COMIDA_QUENTE || null,
  },
  montagem: {
    name: 'Montagem',
    emoji: '🎂',
    categories: ['Bolos'],
    color: '#7c3aed',
    printer: process.env.PRINTER_MONTAGEM || null,
  },
};

function getStationsForOrder(orderItems) {
  // orderItems: [{ product_name, category_name, quantity, notes, ... }]
  const stationMap = {};

  for (const item of orderItems) {
    const station = getStationForCategory(item.category_name || item.category);
    if (!station) continue;

    if (!stationMap[station]) stationMap[station] = [];
    stationMap[station].push(item);
  }

  return stationMap; // { bebidas: [...items], comida_quente: [...items] }
}

function getStationForCategory(categoryName) {
  if (!categoryName) return 'montagem';
  for (const [key, cfg] of Object.entries(STATION_ROUTES)) {
    if (cfg.categories.some((c) => categoryName.toLowerCase().includes(c.toLowerCase()))) {
      return key;
    }
  }
  return 'montagem'; // fallback
}

module.exports = { STATION_ROUTES, getStationsForOrder, getStationForCategory };
