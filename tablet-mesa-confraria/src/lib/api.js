// Cliente da API real. Contratos conferidos direto no kiosk.html publicado
// em totem.confrariacafe.com (não reconstruídos de memória) -- ver as
// funções resolveCode/submitOrder/requestClose de lá.
const API = '';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function req(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Erro de conexão', res.status);
  }
  return res.json();
}

export async function fetchMenu() {
  return req(`/api/menu?channel=kiosk&_=${Date.now()}`, { cache: 'no-store' });
}

// Config de "categoria em cartão único" (Configurações → Autoatendimento no
// App Gestão) -- é o mesmo mecanismo real que decide se uma categoria como
// Croissants/Tapiocas vira lista de sabores sem foto (seção 5 da spec já
// tinha um equivalente pronto no backend, não precisou inventar de novo).
export async function fetchCondensedConfig() {
  return req('/api/settings/condensed-categories', { cache: 'no-store' });
}

// Top vendidos de verdade (últimos 30 dias) -- é o dado real que a seção
// 4.3 pediu pro selo "Mais pedido", em vez de flag manual no cadastro.
export async function fetchPopulares() {
  const d = await req('/api/menu/populares', { cache: 'no-store' });
  return Array.isArray(d) ? d.slice(0, 4).map((x) => x.product_id) : [];
}

// Destaques cadastrados pelo dono pra tela de descanso -- endpoint público
// (sem login), mesmo que o kiosk.html real usa.
export async function fetchHighlights() {
  return req(`/api/highlights?_=${Date.now()}`, { cache: 'no-store' });
}

export async function resolveComanda(code) {
  return req(`/api/comandas/resolve/${encodeURIComponent(code)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_DELAYS_MS = [500, 1000, 2000];

// Envia o pedido com timeout (8s) e retry (0.5s/1s/2s) usando SEMPRE a MESMA
// Idempotency-Key -- o backend usa essa chave pra nunca lançar o MESMO
// pedido duas vezes (ver tabela comanda_orders no delivery-backend). Só
// repete em falha de REDE/timeout: um ApiError já é uma resposta HTTP real
// do servidor (comanda fechada, produto indisponível etc.) -- repetir não
// vai mudar o resultado, quem decide o que fazer com isso é a tela chamadora.
export async function enviarPedido(comandaId, items, mesa, idempotencyKey) {
  const body = JSON.stringify({
    // Item local guarda name/unitPrice/addons.name/addons.price pra
    // recálculo na tela (revisão, mudar quantidade) -- o backend só
    // espera product_id/quantity/notes/addons(addon_option_id+quantity).
    items: items.map((it) => ({
      product_id: it.product_id,
      quantity: it.qty,
      notes: it.notes || null,
      addons: (it.addons || []).map((a) => ({ addon_option_id: a.addon_option_id, quantity: a.quantity })),
    })),
    mesa,
  });

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      return await req(`/api/comandas/${comandaId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof ApiError || attempt >= RETRY_DELAYS_MS.length) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function requestClose(comandaId) {
  return req(`/api/comandas/${comandaId}/request-close`, { method: 'POST' });
}

export { ApiError };
