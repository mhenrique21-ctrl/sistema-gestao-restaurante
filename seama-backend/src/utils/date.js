// "Hoje" no fuso de Belém (não UTC) — depois das 21h local já é o dia
// seguinte em UTC; usar toISOString().slice(0,10) faz relatórios do dia
// "sumirem" no fim do expediente (bug real já visto no PDV da Confraria).
function todayBelem() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Belem' });
}

module.exports = { todayBelem };
