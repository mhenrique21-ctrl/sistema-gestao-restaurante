const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');

async function createPrinter(interfaceStr) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: interfaceStr,
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    width: 42,
  });
  const connected = await printer.isPrinterConnected();
  if (!connected) throw new Error(`Impressora não conectada: ${interfaceStr}`);
  return printer;
}

function fmtMoney(v) {
  return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}

function fmtTime() {
  return new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

// Cupom completo — Caixa
async function printCaixaTicket(interfaceStr, { order, items }) {
  const tag = `PEDIDO #${(order.id || '').slice(-6).toUpperCase()}`;

  if (!interfaceStr) {
    console.log(`[CAIXA] ${tag}`);
    items.forEach(i => console.log(`  ${i.quantity}x ${i.product_name} — ${fmtMoney(i.unit_price * i.quantity)}`));
    return;
  }

  try {
    const p = await createPrinter(interfaceStr);

    p.alignCenter();
    p.bold(true); p.setTextSize(1, 1);
    p.println('☕ CONFRARIA CAFÉ');
    p.bold(false); p.setTextSize(0, 0);
    p.drawLine();

    p.alignLeft();
    p.bold(true); p.println(tag); p.bold(false);
    p.println(fmtTime());

    if (order.customer_name) p.println(`Cliente: ${order.customer_name}`);
    if (order.customer_phone) p.println(`Fone: ${order.customer_phone}`);

    if (order.delivery_type === 'retirada') {
      p.bold(true); p.println('** RETIRADA NO LOCAL **'); p.bold(false);
    } else if (order.delivery_address) {
      p.println(`Entrega: ${order.delivery_address}`);
      if (order.delivery_neighborhood) p.println(`Bairro: ${order.delivery_neighborhood}`);
    }

    p.drawLine();
    p.bold(true); p.println('ITENS'); p.bold(false);

    for (const item of items) {
      const total = parseFloat(item.unit_price || 0) * item.quantity;
      p.bold(true);
      p.println(`${item.quantity}x ${item.product_name}`);
      p.bold(false);
      if (item.notes) p.println(`   -> ${item.notes}`);
      p.alignRight(); p.println(fmtMoney(total)); p.alignLeft();
    }

    p.drawLine();
    const subtotal = items.reduce((s, i) => s + parseFloat(i.unit_price || 0) * i.quantity, 0);
    p.println(`Subtotal:      ${fmtMoney(subtotal)}`);
    if (order.delivery_fee > 0) p.println(`Entrega:       ${fmtMoney(order.delivery_fee)}`);
    if (order.discount > 0)     p.println(`Desconto:     -${fmtMoney(order.discount)}`);
    p.bold(true);
    p.println(`TOTAL:         ${fmtMoney(order.total_amount)}`);
    p.bold(false);
    if (order.payment_method) p.println(`Pagamento: ${order.payment_method}`);
    if (order.notes) { p.drawLine(); p.println(`OBS: ${order.notes}`); }

    p.drawLine();
    p.alignCenter(); p.println('Obrigado pela preferência!');
    p.cut();
    await p.execute();
    console.log('[PRINT][Caixa] Impresso com sucesso');
  } catch (err) {
    console.error('[PRINT][Caixa] Erro:', err.message);
  }
}

// Ticket de produção — Cozinha / Balcão
async function printStationTicket(interfaceStr, { stationName, emoji, order, items }) {
  const tag = `PEDIDO #${(order.id || '').slice(-6).toUpperCase()}`;

  if (!interfaceStr) {
    console.log(`[${stationName.toUpperCase()}] ${tag}`);
    items.forEach(i => console.log(`  ${i.quantity}x ${i.product_name} ${i.notes ? `(${i.notes})` : ''}`));
    return;
  }

  try {
    const p = await createPrinter(interfaceStr);

    p.alignCenter(); p.bold(true); p.setTextSize(1, 1);
    p.println(`${emoji} ${stationName.toUpperCase()}`);
    p.bold(false); p.setTextSize(0, 0);
    p.drawLine();

    p.alignLeft(); p.bold(true); p.println(tag); p.bold(false);
    p.println(fmtTime());
    if (order.delivery_type === 'retirada') {
      p.bold(true); p.println('** RETIRADA NO LOCAL **'); p.bold(false);
    } else if (order.customer_name) {
      p.println(`Cliente: ${order.customer_name}`);
    }
    p.drawLine();

    for (const item of items) {
      p.bold(true); p.setTextSize(1, 0);
      p.println(`${item.quantity}x ${item.product_name}`);
      p.bold(false); p.setTextSize(0, 0);
      if (item.notes) p.println(`   -> ${item.notes}`);
    }

    if (order.notes) { p.drawLine(); p.println(`OBS: ${order.notes}`); }
    p.drawLine();
    p.cut();
    await p.execute();
    console.log(`[PRINT][${stationName}] Impresso com sucesso`);
  } catch (err) {
    console.error(`[PRINT][${stationName}] Erro:`, err.message);
  }
}

// Função unificada chamada em orders.js
async function printOrderTicket(interfaceStr, { stationName, emoji, order, items, fullReceipt }) {
  if (fullReceipt) {
    return printCaixaTicket(interfaceStr, { order, items });
  }
  return printStationTicket(interfaceStr, { stationName, emoji, order, items });
}

module.exports = { printOrderTicket };
