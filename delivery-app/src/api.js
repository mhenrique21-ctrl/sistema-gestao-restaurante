const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

function getToken() {
  return localStorage.getItem('token')
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
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
  menu: () => request('GET', '/menu'),

  // Bairros e configurações
  neighborhoods: () => request('GET', '/neighborhoods'),
  settings: () => request('GET', '/settings'),

  // Customers
  getCustomer: (id) => request('GET', `/customers/${id}`),
  createCustomer: (data) => request('POST', '/customers', data),
  updateCustomer: (id, data) => request('PATCH', `/customers/${id}`, data),

  // Orders
  guestOrder: (data) => request('POST', '/orders/guest', data),
  createOrder: (data) => request('POST', '/orders', data),
  getOrder: (id) => request('GET', `/orders/${id}`),
  getOrders: (params = '') => request('GET', `/orders${params}`),
  getCustomerOrders: (phone) => request('GET', `/orders/customer/${phone.replace(/\D/g, '')}`),

  // Promoções
  getPromotions: () => request('GET', '/promotions'),
  applyPromotion: (subtotal, deliveryFee) => request('GET', `/promotions/apply?subtotal=${subtotal}&delivery_fee=${deliveryFee}`),
}
