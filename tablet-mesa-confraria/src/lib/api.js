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

export async function submitOrder(comandaId, items, mesa) {
  return req(`/api/comandas/${comandaId}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });
}

export async function requestClose(comandaId) {
  return req(`/api/comandas/${comandaId}/request-close`, { method: 'POST' });
}

export { ApiError };
