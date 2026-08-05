const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;
const pendingPrinterRequests = new Map();

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const station = url.searchParams.get('station'); // bebidas | comida_quente | montagem | retaguarda
    const role = url.searchParams.get('role'); // 'printer' identifica o agente local de impressão

    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      ws.user = user;
      ws.station = station || 'retaguarda';
      ws.role = role || null;
      ws.isAlive = true;
      console.log(`[WS] conectado: ${user.name} (${ws.station}${ws.role ? ', role=' + ws.role : ''})`);
    } catch {
      ws.close(4001, 'Token inválido');
      return;
    }

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        if (msg.type === 'printer_list' && msg.requestId && pendingPrinterRequests.has(msg.requestId)) {
          const { resolve, timer } = pendingPrinterRequests.get(msg.requestId);
          clearTimeout(timer);
          pendingPrinterRequests.delete(msg.requestId);
          resolve(msg.printers || []);
        }
      } catch {}
    });
    ws.on('close', () => console.log(`[WS] desconectado: ${ws.user?.name} (${ws.station})`));

    ws.send(JSON.stringify({ type: 'connected', station: ws.station }));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));
  console.log('[WS] WebSocket server iniciado em /ws');
  return wss;
}

// Broadcast para todos (retaguarda + todas estações)
function broadcastOrderUpdate(payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: 'order_update', ...payload, timestamp: new Date().toISOString() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
}

// Broadcast apenas para uma estação específica
// Devolve PARA QUANTOS foi enviado. Antes não devolvia nada: sem agente de
// impressão conectado, a mensagem ia pro vazio, a rota respondia ok e a tela
// dizia "enviado pra impressão". O papel nunca saía e ninguém era avisado —
// era o bug de "as notas não estão saindo na impressora".
function broadcastToStation(station, payload) {
  if (!wss) return 0;
  const message = JSON.stringify({ type: 'station_order', station, ...payload, timestamp: new Date().toISOString() });
  let impressoras = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && (ws.station === station || ws.station === 'retaguarda')) {
      ws.send(message);
      // Quem imprime: o agente identificado por role=printer OU qualquer
      // cliente na PRÓPRIA estação de destino. O agente em produção conecta
      // só com station=caixa, sem role — exigir role fazia o servidor recusar
      // uma impressão que funcionaria. O admin no navegador fica em
      // 'retaguarda', que recebe a mensagem mas não conta como impressora.
      if (ws.role === 'printer' || ws.station === station) impressoras++;
    }
  });
  if (!impressoras) console.warn(`[WS] "${payload?.event}" enviado sem nenhum agente de impressão conectado`);
  return impressoras;
}

// Quem está conectado agora — usado pra tela poder dizer "agente de impressão
// offline" antes de o operador descobrir pelo papel que não saiu.
function estacoesConectadas() {
  if (!wss) return [];
  const out = [];
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      out.push({ station: ws.station, name: ws.user?.name || null, role: ws.role || null });
    }
  });
  return out;
}

function broadcastToRole(role, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: 'notification', ...payload, timestamp: new Date().toISOString() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.user?.role === role) ws.send(message);
  });
}

// Pede a lista de impressoras instaladas ao agente local (role=printer) conectado via WS
function requestPrinterList(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!wss) return reject(new Error('WebSocket não iniciado'));
    const agent = [...wss.clients].find(ws => ws.readyState === WebSocket.OPEN && ws.role === 'printer');
    if (!agent) return reject(new Error('Agente de impressão local não está conectado'));

    const requestId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      pendingPrinterRequests.delete(requestId);
      reject(new Error('Tempo esgotado aguardando resposta do agente de impressão'));
    }, timeoutMs);

    pendingPrinterRequests.set(requestId, { resolve, timer });
    agent.send(JSON.stringify({ type: 'list_printers', requestId }));
  });
}

module.exports = { initWebSocket, broadcastOrderUpdate, broadcastToStation, broadcastToRole, requestPrinterList, estacoesConectadas };
