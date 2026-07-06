const WebSocket = require('ws');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WS_URL     = 'wss://pedidos.confrariacafe.com/ws';
const WS_TOKEN   = process.env.AGENT_TOKEN || 'SEU_TOKEN_AQUI';
const WS_STATION = 'caixa';
const PRINTERS   = {
  caixa:   process.env.PRINTER_CAIXA   || 'CAIXA PRINCIPAL',
  cozinha: process.env.PRINTER_COZINHA || 'ELGIN I8 COZINHA',
  balcao:  process.env.PRINTER_BALCAO  || 'MP-4200 TH',
};
const PS_SCRIPT    = 'C:\\print-agent\\rawprint.ps1';
const RECONNECT_MS = 5000;

function fmt(v) { return 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',','); }
function fmtTime() {
  return new Date().toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'2-digit'});
}

function rawPrint(printerName, buffer) {
  const tmp = path.join(os.tmpdir(), `receipt_${Date.now()}.prn`);
  fs.writeFileSync(tmp, buffer);
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${PS_SCRIPT}" -PrinterName "${printerName}" -FilePath "${tmp}"`, { timeout: 15000 });
    console.log(`[PRINT] ${printerName} OK`);
  } catch(e) {
    console.error(`[PRINT] ${printerName} Erro:`, e.message);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function buildCaixa(order, items) {
  const tmp = path.join(os.tmpdir(), `build_${Date.now()}.prn`);
  const p = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: tmp,
    characterSet: CharacterSet.PC858_EURO, removeSpecialCharacters: false, width: 42 });

  const tag = `PEDIDO #${(order.order_number||order.id||'').toString().slice(-6).toUpperCase()}`;

  p.alignCenter();
  p.bold(true); p.setTextSize(1,1); p.println('CONFRARIA CAFE'); p.bold(false); p.setTextSize(0,0);
  p.drawLine();
  p.alignLeft();
  p.bold(true); p.println(tag); p.bold(false);
  p.println(fmtTime());
  if (order.customer_name) p.println(`Cliente: ${order.customer_name}`);
  if (order.delivery_type === 'retirada') {
    p.bold(true); p.println('** RETIRADA NO LOCAL **'); p.bold(false);
  } else if (order.delivery_address) {
    const a = order.delivery_address;
    const addr = typeof a === 'string' ? a : `${a.street||''}, ${a.number||''} - ${a.neighborhood||''}`;
    p.println(`Entrega: ${addr}`);
  }

  p.drawLine(); p.bold(true); p.println('ITENS'); p.bold(false);

  for (const item of items) {
    const tot = item.subtotal != null ? parseFloat(item.subtotal) : parseFloat(item.unit_price||0) * item.quantity;
    p.bold(true); p.println(`${item.quantity}x ${item.product_name}`); p.bold(false);
    if (item.notes) p.println(`   -> ${item.notes}`);
    if (item.addons && item.addons.length) {
      for (const a of item.addons) {
        const v = parseFloat(a.price||0) * (a.quantity||1);
        p.println('   + ' + a.name + (v > 0 ? '  R$ ' + v.toFixed(2).replace('.',',') : ''));
      }
    }
    p.alignRight(); p.println(fmt(tot)); p.alignLeft();
  }

  p.drawLine();
  const sub = items.reduce((s,i) => s + (i.subtotal != null ? parseFloat(i.subtotal) : parseFloat(i.unit_price||0)*i.quantity), 0);
  p.println(`Subtotal:    ${fmt(sub)}`);
  if (parseFloat(order.delivery_fee||0) > 0) p.println(`Entrega:     ${fmt(order.delivery_fee)}`);
  if (parseFloat(order.discount||0) > 0)     p.println(`Desconto:   -${fmt(order.discount)}`);
  p.bold(true); p.println(`TOTAL:       ${fmt(order.total||order.total_amount)}`); p.bold(false);
  if (order.payment_method) p.println(`Pagamento: ${order.payment_method}`);
  if (order.notes) { p.drawLine(); p.println(`OBS: ${order.notes}`); }
  p.drawLine(); p.alignCenter(); p.println('Obrigado pela preferencia!');
  p.cut(); await p.execute();
  return fs.readFileSync(tmp);
}

async function buildEstacao(nome, order, items) {
  const tmp = path.join(os.tmpdir(), `build_${Date.now()}.prn`);
  const p = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: tmp,
    characterSet: CharacterSet.PC858_EURO, removeSpecialCharacters: false, width: 42 });

  const tag = `PEDIDO #${(order.order_number||order.id||'').toString().slice(-6).toUpperCase()}`;
  p.alignCenter(); p.bold(true); p.setTextSize(1,1); p.println(nome.toUpperCase());
  p.bold(false); p.setTextSize(0,0); p.drawLine(); p.alignLeft();
  p.bold(true); p.println(tag); p.bold(false); p.println(fmtTime());
  if (order.delivery_type === 'retirada') { p.bold(true); p.println('** RETIRADA **'); p.bold(false); }
  else if (order.customer_name) p.println(`Cliente: ${order.customer_name}`);
  p.drawLine();
  for (const item of items) {
    p.bold(true); p.setTextSize(1,0); p.println(`${item.quantity}x ${item.product_name}`);
    p.bold(false); p.setTextSize(0,0);
    if (item.notes) p.println(`   -> ${item.notes}`);
    if (item.addons && item.addons.length) {
      for (const a of item.addons) p.println(`   + ${a.name}`);
    }
  }
  if (order.notes) { p.drawLine(); p.println(`OBS: ${order.notes}`); }
  p.drawLine(); p.cut(); await p.execute();
  return fs.readFileSync(tmp);
}

async function handleNewOrder(order, items) {
  if (!order || !items || !items.length) { console.log('[agent] Pedido sem itens'); return; }
  console.log(`[agent] Imprimindo pedido #${order.order_number||order.id} - ${items.length} item(s)`);

  try { rawPrint(PRINTERS.caixa, await buildCaixa(order, items)); }
  catch(e) { console.error('[PRINT][Caixa]', e.message); }

  const cozItems = items.filter(i => i.print_target === 'cozinha');
  if (cozItems.length) {
    try { rawPrint(PRINTERS.cozinha, await buildEstacao('Cozinha', order, cozItems)); }
    catch(e) { console.error('[PRINT][Cozinha]', e.message); }
  }

  const balItems = items.filter(i => i.print_target === 'balcao');
  if (balItems.length) {
    try { rawPrint(PRINTERS.balcao, await buildEstacao('Balcao', order, balItems)); }
    catch(e) { console.error('[PRINT][Balcao]', e.message); }
  }
}

function connect() {
  const url = `${WS_URL}?token=${WS_TOKEN}&station=${WS_STATION}`;
  console.log('[agent] Conectando...');
  const ws = new WebSocket(url);
  ws.on('open', () => console.log('[agent] Conectado ao VPS OK'));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log('[agent] Mensagem:', msg.type, msg.event||'');
      if ((msg.event === 'new_order' || msg.type === 'order_update') && msg.order && msg.items) {
        console.log('[agent] NOVO PEDIDO - imprimindo...');
        handleNewOrder(msg.order, msg.items).catch(e => console.error('[agent]', e.message));
      }
    } catch(e) { console.error('[agent] Parse error:', e.message); }
  });
  ws.on('close', (code) => {
    console.log(`[agent] Desconectado (code=${code}). Reconectando em 5s...`);
    setTimeout(connect, RECONNECT_MS);
  });
  ws.on('error', (e) => console.error('[agent] WS Erro:', e.message));
}

connect();
