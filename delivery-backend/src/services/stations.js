// Roteamento de itens para impressoras
// Caixa: TODOS os itens (cupom completo)
// Cozinha: itens com print_target = 'cozinha'
// Balcão: itens com print_target = 'balcao'

const STATION_ROUTES = {
  caixa: {
    name: 'Caixa',
    emoji: '🧾',
    color: '#7c3aed',
    printer: process.env.PRINTER_CAIXA || null,
    fullReceipt: true,
  },
  cozinha: {
    name: 'Cozinha',
    emoji: '🍳',
    color: '#f59e0b',
    printer: process.env.PRINTER_COZINHA || null,
    fullReceipt: false,
  },
  balcao: {
    name: 'Balcão',
    emoji: '🏪',
    color: '#3b82f6',
    printer: process.env.PRINTER_BALCAO || null,
    fullReceipt: false,
  },
};

function getStationsForOrder(orderItems) {
  const stationMap = {};

  // Caixa sempre recebe todos os itens
  stationMap['caixa'] = [...orderItems];

  // Cozinha e Balcão só recebem itens direcionados a eles
  for (const item of orderItems) {
    const target = item.print_target; // 'cozinha' | 'balcao' | null
    if (target === 'cozinha' || target === 'balcao') {
      if (!stationMap[target]) stationMap[target] = [];
      stationMap[target].push(item);
    }
  }

  return stationMap;
}

module.exports = { STATION_ROUTES, getStationsForOrder };
