const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

function getToken() {
  return localStorage.getItem('token')
}

async function request(method, path, body, extraHeaders) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido')
  return data
}

export const api = {
  // Auth
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),
  register: (name, phone, email) => request('POST', '/auth/register-customer', { name, phone, email }),

  // Menu
  menu: () => request('GET', '/menu?channel=delivery'),

  // Bairros e configurações
  neighborhoods: () => request('GET', '/neighborhoods'),
  settings: () => request('GET', '/settings'),
  paymentMethods: () => request('GET', `/payment-methods?t=${Date.now()}`),

  // Customers
  getCustomer: (id) => request('GET', `/customers/${id}`),
  createCustomer: (data) => request('POST', '/customers', data),
  updateCustomer: (id, data) => request('PATCH', `/customers/${id}`, data),

  // Orders — idempotencyKey evita pedido/cobrança duplicada se a resposta se
  // perder na rede e o app tentar de novo com a mesma chave.
  guestOrder: (data, idempotencyKey) => request('POST', '/orders/guest', data, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  createCardIntent: (amount, idempotencyKey) => request('POST', '/orders/create-card-intent', { amount }, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  createOrder: (data, idempotencyKey) => request('POST', '/orders', data, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  getOrder: (id) => request('GET', `/orders/public/${id}`),
  getOrders: (params = '') => request('GET', `/orders${params}`),
  getCustomerOrders: (phone) => request('GET', `/orders/customer/${phone.replace(/\D/g, '')}`),

  // Promoções
  getPromotions: () => request('GET', '/promotions'),
  applyPromotion: (subtotal, deliveryFee) => request('GET', `/promotions/apply?subtotal=${subtotal}&delivery_fee=${deliveryFee}`),

  // Cupons
  validateCoupon: (code, subtotal, deliveryFee) => request('POST', '/coupons/validate', { code, subtotal, delivery_fee: deliveryFee }),
  useCoupon: (code) => request('POST', '/coupons/use', { code }),
}
