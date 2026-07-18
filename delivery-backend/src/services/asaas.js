const https = require('https');

const BASE_HOST = process.env.ASAAS_ENV === 'production' ? 'api.asaas.com' : 'api-sandbox.asaas.com';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: BASE_HOST,
      path: `/v3${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ConfrariaCafe-Delivery',
        'access_token': process.env.ASAAS_API_KEY,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = {}; }
        if (res.statusCode >= 400) {
          const msg = parsed.errors?.map(e => e.description).join('; ') || `Asaas HTTP ${res.statusCode}`;
          return reject(new Error(msg));
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Busca cliente Asaas por CPF/CNPJ, cria se não existir
async function findOrCreateCustomer({ name, cpfCnpj, phone }) {
  const digits = cpfCnpj.replace(/\D/g, '');
  const found = await request('GET', `/customers?cpfCnpj=${digits}`);
  if (found.data && found.data.length > 0) return found.data[0];
  return request('POST', '/customers', {
    name,
    cpfCnpj: digits,
    mobilePhone: phone.replace(/\D/g, ''),
  });
}

// Cria cobrança PIX e retorna QR code (imagem base64 + copia-e-cola)
async function createPixCharge({ name, cpfCnpj, phone, value, description, externalReference }) {
  const customer = await findOrCreateCustomer({ name, cpfCnpj, phone });
  const today = new Date().toISOString().slice(0, 10);
  const payment = await request('POST', '/payments', {
    customer: customer.id,
    billingType: 'PIX',
    value: Math.round(value * 100) / 100,
    dueDate: today,
    description,
    externalReference,
  });
  const qr = await request('GET', `/payments/${payment.id}/pixQrCode`);
  return {
    paymentId: payment.id,
    qrCodeUrl: qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null,
    qrCode: qr.payload || null,
    expirationDate: qr.expirationDate || null,
  };
}

module.exports = { findOrCreateCustomer, createPixCharge, request };
