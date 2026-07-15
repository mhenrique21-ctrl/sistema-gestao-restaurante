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
  balcao:  process.env.PRINTER_BALCAO  || 'CAIXA PRINCIPAL',
};
const PS_SCRIPT    = 'C:\\print-agent\\rawprint.ps1';
const RECONNECT_MS = 5000;

function fmt(v) { return 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',','); }
function fmtTime() {
  return new Date().toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'2-digit'});
}

function listLocalPrinters() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"', { timeout: 5000 }).toString();
    return out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  } catch (e) {
    console.error('[agent] Erro ao listar impressoras:', e.message);
    return [];
  }
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

  // Margem superior (~1,5 cm = ~4 linhas em branco)
  p.println(''); p.println(''); p.println(''); p.println('');

  // Cabeçalho
  p.alignCenter();
  p.bold(true); p.setTextSize(1,1); p.println('CONFRARIA CAFE'); p.setTextSize(0,0); p.bold(false);
  p.println('');
  p.println('Av Almirante Barroso, 746 - Centro');
  p.println('WhatsApp: (96) 97400-7410');
  p.println('');
  p.drawLine();

  // Número do pedido (grande)
  p.println('');
  p.alignCenter();
  p.bold(true); p.setTextSize(1,1); p.println(tag); p.setTextSize(0,0); p.bold(false);
  p.println('');
  p.alignLeft();
  p.println(fmtTime());
  p.println('');

  // Nome do cliente (maior)
  if (order.customer_name) {
    p.bold(true); p.setTextSize(1,0); p.println(`Cliente: ${order.customer_name}`); p.setTextSize(0,0); p.bold(false);
    p.println('');
  }

  // Endereço de entrega ou retirada
  if (order.delivery_type === 'retirada') {
    p.bold(true); p.println('** RETIRADA NO LOCAL **'); p.bold(false);
  } else if (order.delivery_address) {
    const a = order.delivery_address;
    const addr = typeof a === 'string' ? a : `${a.street||''}, ${a.number||''} - ${a.neighborhood||''}`;
    p.println(`Entrega: ${addr}`);
  }

  p.println('');
  p.drawLine();
  p.println('');
  p.bold(true); p.println('ITENS'); p.bold(false);
  p.println('');

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
    p.println('');
  }

  p.drawLine();
  p.println('');
  const sub = items.reduce((s,i) => s + (i.subtotal != null ? parseFloat(i.subtotal) : parseFloat(i.unit_price||0)*i.quantity), 0);
  p.println(`Subtotal:    ${fmt(sub)}`);
  if (parseFloat(order.delivery_fee||0) > 0) p.println(`Entrega:     ${fmt(order.delivery_fee)}`);
  if (parseFloat(order.discount||0) > 0)     p.println(`Desconto:   -${fmt(order.discount)}`);
  p.println('');
  p.bold(true); p.println(`TOTAL:       ${fmt(order.total||order.total_amount)}`); p.bold(false);
  p.println('');
  if (order.payment_method) p.println(`Pagamento: ${order.payment_method}`);
  if (order.notes) { p.println(''); p.drawLine(); p.println(`OBS: ${order.notes}`); }

  // Rodapé
  p.println('');
  p.drawLine();
  p.println('');
  p.alignCenter();
  p.println('Obrigado pela preferencia!');
  p.println('');
  p.bold(true); p.println('--- CUPOM DE DESCONTO ---'); p.bold(false);
  p.println('');
  p.bold(true); p.setTextSize(1,1); p.println('VALE5'); p.setTextSize(0,0); p.bold(false);
  p.println('');
  p.println('5% de desconto no proximo pedido');
  p.println('Informe o codigo ao realizar seu pedido');
  p.println('');

  // Margem inferior (~2 cm = ~5 linhas em branco)
  p.println(''); p.println(''); p.println(''); p.println(''); p.println('');

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

async function buildRelatorio(date, report) {
  const tmp = path.join(os.tmpdir(), `relatorio_${Date.now()}.prn`);
  const p = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: tmp,
    characterSet: CharacterSet.PC858_EURO, removeSpecialCharacters: false, width: 42 });

  const STATUS_PT = { pendente:'Pendente', confirmado:'Confirmado', em_preparo:'Em Preparo',
    pronto:'Pronto', em_entrega:'Em Entrega', entregue:'Entregue',
    finalizado:'Finalizado', cancelado:'Cancelado' };

  p.println(''); p.println('');
  p.alignCenter();
  p.bold(true); p.setTextSize(1,1); p.println('CONFRARIA CAFE'); p.setTextSize(0,0); p.bold(false);
  p.println('RELATORIO FINANCEIRO');
  p.println(date || new Date().toLocaleDateString('pt-BR'));
  p.println('Emitido: ' + fmtTime());
  p.drawLine();

  // Totais gerais
  const t = report.totals || {};
  p.alignLeft();
  p.bold(true); p.println('RESUMO GERAL'); p.bold(false);
  p.println(`Pedidos:      ${t.total_pedidos || 0}`);
  p.println(`Cancelados:   ${t.cancelados || 0}`);
  p.println(`Descontos:   -${fmt(t.total_descontos)}`);
  p.println(`Frete:        ${fmt(t.total_entregas)}`);
  p.bold(true); p.println(`RECEITA:      ${fmt(t.receita)}`); p.bold(false);
  p.drawLine();

  // Por forma de pagamento
  if (report.by_payment && report.by_payment.length) {
    p.bold(true); p.println('POR PAGAMENTO'); p.bold(false);
    for (const row of report.by_payment) {
      const label = (row.payment_method || 'Nao informado').substring(0, 20);
      const val = fmt(row.total);
      p.println(`${label.padEnd(22)}${val.padStart(10)}`);
      p.println(`  ${row.qty} pedido(s)`);
    }
    p.drawLine();
  }

  // Por status
  if (report.by_status && report.by_status.length) {
    p.bold(true); p.println('POR STATUS'); p.bold(false);
    for (const row of report.by_status) {
      const label = (STATUS_PT[row.status] || row.status).substring(0, 20);
      const val = fmt(row.total);
      p.println(`${label.padEnd(22)}${val.padStart(10)}`);
    }
    p.drawLine();
  }

  // Lista de pedidos
  if (report.orders && report.orders.length) {
    p.bold(true); p.println('PEDIDOS DO DIA'); p.bold(false);
    for (const o of report.orders) {
      const num = String(o.order_number || '').slice(-6).toUpperCase();
      const st  = (STATUS_PT[o.status] || o.status || '').substring(0, 12);
      p.println(`#${num} ${st.padEnd(13)}${fmt(o.total).padStart(10)}`);
      if (o.payment_method) p.println(`  ${o.payment_method}`);
    }
    p.drawLine();
  }

  p.println('');
  p.alignCenter();
  p.println('Fim do relatorio');
  p.println(''); p.println(''); p.println('');
  p.cut(); await p.execute();
  return fs.readFileSync(tmp);
}

async function buildFinalizeOrder(order) {
  const tmp = path.join(os.tmpdir(), `finalize_${Date.now()}.prn`);
  const p = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: tmp,
    characterSet: CharacterSet.PC858_EURO, removeSpecialCharacters: false, width: 42 });

  p.println(''); p.println('');
  p.alignCenter();
  p.bold(true); p.setTextSize(1,1); p.println('CONFRARIA CAFE'); p.setTextSize(0,0); p.bold(false);
  p.println('Av Almirante Barroso, 746 - Centro');
  p.drawLine();
  p.bold(true); p.println('CONFERENCIA DE VENDA'); p.bold(false);
  p.drawLine();
  p.alignLeft();
  p.println(`Pedido: #${(order.order_number||'').toString().slice(-6).toUpperCase()}`);
  if (order.customer_name) p.println(`Cliente: ${order.customer_name}`);
  p.println(`Hora: ${fmtTime()}`);
  p.println(`Pagamento: ${order.payment_method || '-'}`);
  p.drawLine();
  p.println(`Subtotal:    ${fmt(order.subtotal)}`);
  if (parseFloat(order.delivery_fee||0) > 0) p.println(`Entrega:     ${fmt(order.delivery_fee)}`);
  if (parseFloat(order.discount||0) > 0)     p.println(`Desconto:   -${fmt(order.discount)}`);
  p.bold(true); p.setTextSize(1,1); p.println(`TOTAL: ${fmt(order.total)}`); p.setTextSize(0,0); p.bold(false);
  p.drawLine();
  p.alignCenter();
  p.println('Confira o valor recebido');
  p.println('antes de finalizar');
  p.println(''); p.println(''); p.println('');

  p.cut(); await p.execute();
  return fs.readFileSync(tmp);
}

async function buildCloseRegister(summary) {
  const tmp = path.join(os.tmpdir(), `close_${Date.now()}.prn`);
  const p = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: tmp,
    characterSet: CharacterSet.PC858_EURO, removeSpecialCharacters: false, width: 42 });

  const t = summary.totals || {};
  p.println(''); p.println('');
  p.alignCenter();
  p.bold(true); p.setTextSize(1,1); p.println('CONFRARIA CAFE'); p.setTextSize(0,0); p.bold(false);
  p.drawLine();
  p.bold(true); p.println('FECHAMENTO DE CAIXA'); p.bold(false);
  p.println(summary.date || '');
  p.println('Emitido: ' + fmtTime());
  p.drawLine();
  p.alignLeft();
  p.println(`Total de pedidos: ${t.total_pedidos || 0}`);
  p.println(`Cancelados:       ${t.cancelados || 0}`);
  p.drawLine();
  if (summary.by_payment && summary.by_payment.length) {
    p.bold(true); p.println('POR PAGAMENTO'); p.bold(false);
    for (const row of summary.by_payment) {
      const label = (row.payment_method || 'Nao informado').substring(0, 20);
      p.println(`${label.padEnd(22)}${fmt(row.total).padStart(10)}`);
    }
    p.drawLine();
  }
  p.println(`Taxas de entrega: ${fmt(t.total_entregas)}`);
  p.println(`Descontos:       -${fmt(t.total_descontos)}`);
  p.bold(true); p.setTextSize(1,1); p.println(`RECEITA: ${fmt(t.receita)}`); p.setTextSize(0,0); p.bold(false);
  p.drawLine();
  p.alignCenter();
  p.println('Confira o dinheiro em caixa');
  p.println('com o valor acima');
  p.println(''); p.println(''); p.println('');

  p.cut(); await p.execute();
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
  const url = `${WS_URL}?token=${WS_TOKEN}&station=${WS_STATION}&role=printer`;
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
      if (msg.event === 'print_report' && msg.report) {
        console.log('[agent] RELATORIO - imprimindo...');
        buildRelatorio(msg.date, msg.report)
          .then(buf => rawPrint(PRINTERS.caixa, buf))
          .catch(e => console.error('[PRINT][Relatorio]', e.message));
      }
      if (msg.type === 'list_printers') {
        const printers = listLocalPrinters();
        console.log('[agent] Impressoras detectadas:', printers.join(', ') || '(nenhuma)');
        ws.send(JSON.stringify({ type: 'printer_list', requestId: msg.requestId, printers }));
      }
      if (msg.event === 'finalize_order' && msg.order) {
        console.log('[agent] FINALIZAR PEDIDO - imprimindo conferência...');
        buildFinalizeOrder(msg.order)
          .then(buf => rawPrint(PRINTERS.caixa, buf))
          .catch(e => console.error('[PRINT][Finalizar]', e.message));
      }
      if (msg.event === 'close_register' && msg.summary) {
        console.log('[agent] FECHAR CAIXA - imprimindo fechamento...');
        buildCloseRegister(msg.summary)
          .then(buf => rawPrint(PRINTERS.caixa, buf))
          .catch(e => console.error('[PRINT][Fechamento]', e.message));
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
