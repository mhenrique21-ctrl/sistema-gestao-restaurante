const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');

async function createPrinter(interfaceStr) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: interfaceStr, // 'tcp://192.168.0.x:9100' ou 'usb' ou '/dev/usb/lp0'
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    width: 42,
  });
  const connected = await printer.isPrinterConnected();
  if (!connected) throw new Error(`Impressora não conectada: ${interfaceStr}`);
  return printer;
}

async function printOrderTicket(interfaceStr, { stationName, order, items, emoji }) {
  if (!interfaceStr) {
    // Sem impressora configurada: só loga
    console.log(`[PRINT][${stationName}] Pedido #${order.id?.slice(-6).toUpperCase()}`);
    items.forEach((i) => console.log(`  ${i.quantity}x ${i.product_name} ${i.notes ? `(${i.notes})` : ''}`));
    return;
  }

  try {
    const printer = await createPrinter(interfaceStr);

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(`${emoji} ${stationName.toUpperCase()}`);
    printer.bold(false);
    printer.drawLine();

    printer.alignLeft();
    printer.bold(true);
    printer.println(`PEDIDO #${order.id?.slice(-6).toUpperCase() || '------'}`);
    printer.bold(false);
    printer.println(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    if (order.delivery_type === 'retirada') {
      printer.bold(true);
      printer.println('** RETIRADA NO LOCAL **');
      printer.bold(false);
    }
    printer.drawLine();

    for (const item of items) {
      printer.bold(true);
      printer.println(`${item.quantity}x ${item.product_name}`);
      printer.bold(false);
      if (item.notes) printer.println(`   -> ${item.notes}`);
    }

    printer.drawLine();
    if (order.notes) {
      printer.println(`OBS: ${order.notes}`);
      printer.drawLine();
    }

    printer.cut();
    await printer.execute();
    console.log(`[PRINT][${stationName}] Impresso com sucesso`);
  } catch (err) {
    console.error(`[PRINT][${stationName}] Erro:`, err.message);
  }
}

module.exports = { printOrderTicket };
