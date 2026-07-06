/**
 * Agente de impressão local — Confraria Café
 * Roda no Windows, conecta ao VPS via WebSocket e imprime automaticamente.
 *
 * Como usar:
 *   1. npm install (na pasta print-agent)
 *   2. node agent.js
 *   3. Deixe rodando em segundo plano (ou use pm2/nssm como serviço Windows)
 */

const WebSocket = require('ws');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');

// ── Configuração ──────────────────────────────────────────────────────────────
const WS_URL    = 'wss://pedidos.confrariacafe.com/ws';
const WS_TOKEN  = process.env.AGENT_TOKEN || 'SEU_TOKEN_ADMIN_AQUI';
const WS_STATION = 'caixa'; // estação que este agente representa

const PRINTERS = {
  caixa:   process.env.PRINTER_CAIXA   || 'printer:CAIXA PRINCIPAL',
  cozinha: process.env.PRINTER_COZINHA || 'printer:ELGIN I8 COZINHA',
  balcao:  process.env.PRINTER_BALCAO  || 'printer:MP-4200 TH',
};

const RECONNECT_MS = 5000;
// ─────────────────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}
function fmtTime() {
  return new Date().toLocaleString('pt-BR', {
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit',
  });
}

async function createPrinter(iface) {
  const p = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: iface,
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    width: 42,
  });
  const ok = await p.isPrinterConnected();
  if (!ok) throw new Error(`Impressora offline: ${iface}`);
  return p;
}

async function printCaixa(order, items) {
  const iface = PRINTERS.caixa;
  const tag = `PEDIDO #${(order.order_number || order.id || '').toString().slice(-6).toUpperCase()}`;
  try {
    const p = await createPrinter(iface);
    p.alignCenter(); p.bold(true); p.setTextSize(1, 1);
    p.println('CONFRARIA CAFÉ');
    p.bold(false); p.setTextSize(0, 0);
    p.drawLine();
    p.alignLeft();
    p.bold(true); p.println(tag); p.bold(false);
    p.println(fmtTime());
    if (order.customer_name) p.println(`Cliente: ${order.customer_name}`);
    if (order.delivery_type === 'retirada') {
      p.bold(true); p.println('** RETIRADA NO LOCAL **'); p.bold(false);
    } else if (order.delivery_address) {
      const addr = typeof order.delivery_address === 'string'
        ? order.delivery_address
        : `${order.delivery_address.street || ''}, ${order.delivery_address.number || ''} - ${order.delivery_address.neighborhood || ''}`;
      p.println(`Entrega: ${addr}`);
    }
    p.drawLine(); p.bold(true); p.println('ITENS'); p.bold(false);
    for (const item of items) {
      const tot = parseFloat(item.unit_price || 0) * item.quantity;
      p.bold(true); p.println(`${item.quantity}x ${item.product_name}`); p.bold(false);
      if (item.notes) p.println(`   -> ${item.notes}`);
      if (item.addons?.length) item.addons.forEach(a => p.println(`   + ${a.name}`));
      p.alignRight(); p.println(fmtMoney(tot)); p.alignLeft();
    }
    p.drawLine();
    const subtotal = items.reduce((s, i) => s + parseFloat(i.unit_price || 0) * i.quantity, 0);
    p.println(`Subtotal:    ${fmtMoney(subtotal)}`);
    if (order.delivery_fee > 0) p.println(`Entrega:     ${fmtMoney(order.delivery_fee)}`);
    if (order.discount > 0)     p.println(`Desconto:   -${fmtMoney(order.discount)}`);
    p.bold(true); p.println(`TOTAL:       ${fmtMoney(order.total || order.total_amount)}`); p.bold(false);
    if (order.payment_method)   p.println(`Pagamento: ${order.payment_method}`);
    if (order.notes)            { p.drawLine(); p.println(`OBS: ${order.notes}`); }
    p.drawLine(); p.alignCenter(); p.println('Obrigado pela preferencia!');
    p.cut(); await p.execute();
    console.log(`[PRINT][Caixa] ${tag} ok`);
  } catch(e) { console.error('[PRINT][Caixa] Erro:', e.message); }
}

async function printEstacao(nome, emoji, iface, order, items) {
  const tag = `PEDIDO #${(order.order_number || order.id || '').toString().slice(-6).toUpperCase()}`;
  try {
    const p = await createPrinter(iface);
    p.alignCenter(); p.bold(true); p.setTextSize(1, 1);
    p.println(`${emoji} ${nome.toUpperCase()}`);
    p.bold(false); p.setTextSize(0, 0);
    p.drawLine(); p.alignLeft();
    p.bold(true); p.println(tag); p.bold(false);
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
      if (item.addons?.length) item.addons.forEach(a => p.println(`   + ${a.name}`));
    }
    if (order.notes) { p.drawLine(); p.println(`OBS: ${order.notes}`); }
    p.drawLine(); p.cut(); await p.execute();
    console.log(`[PRINT][${nome}] ${tag} ok`);
  } catch(e) { console.error(`[PRINT][${nome}] Erro:`, e.message); }
}

function handleNewOrder(data) {
  const { order, items } = data;
  if (!order || !items?.length) return;

  // Caixa — todos os itens
  printCaixa(order, items);

  // Cozinha — itens direcionados
  const cozinhaItems = items.filter(i => i.print_target === 'cozinha');
  if (cozinhaItems.length && PRINTERS.cozinha) {
    printEstacao('Cozinha', '🍳', PRINTERS.cozinha, order, cozinhaItems);
  }

  // Balcão — itens direcionados
  const balcaoItems = items.filter(i => i.print_target === 'balcao');
  if (balcaoItems.length && PRINTERS.balcao) {
    printEstacao('Balcão', '🏪', PRINTERS.balcao, order, balcaoItems);
  }
}

function connect() {
  const url = `${WS_URL}?token=${WS_TOKEN}&station=${WS_STATION}`;
  console.log(`[agent] Conectando a ${WS_URL} ...`);

  const ws = new WebSocket(url);

  ws.on('open', () => console.log('[agent] Conectado ao VPS ✓'));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.event === 'new_order') {
        console.log('[agent] Novo pedido recebido — imprimindo...');
        handleNewOrder(msg);
      }
    } catch(e) { /* ignora mensagens não-JSON */ }
  });

  ws.on('close', () => {
    console.log(`[agent] Desconectado. Reconectando em ${RECONNECT_MS / 1000}s...`);
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on('error', (e) => console.error('[agent] Erro WS:', e.message));
}

connect();
