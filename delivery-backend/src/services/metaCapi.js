const crypto = require('crypto');

const PIXEL_ID = '1061008356398242';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const CAPI_URL = `https://graph.facebook.com/v20.0/${PIXEL_ID}/events`;

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}

async function sendCapiEvent({ eventName, eventId, userData = {}, customData = {}, sourceUrl }) {
  if (!ACCESS_TOKEN) {
    console.warn('[CAPI] META_CAPI_ACCESS_TOKEN não definido — evento ignorado');
    return;
  }
  const payload = {
    data: [{
      event_name: eventName,
      event_id: eventId,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: sourceUrl || 'https://pedidos.confrariacafe.com',
      user_data: {
        ph: userData.phone ? sha256(userData.phone.replace(/\D/g, '')) : undefined,
        em: userData.email ? sha256(userData.email) : undefined,
        fn: userData.firstName ? sha256(userData.firstName) : undefined,
        ln: userData.lastName  ? sha256(userData.lastName)  : undefined,
        client_ip_address: userData.ip        || undefined,
        client_user_agent: userData.userAgent || undefined,
      },
      custom_data: customData,
    }],
  };

  try {
    const res = await fetch(`${CAPI_URL}?access_token=${ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) console.error('[CAPI]', eventName, json.error?.message || json);
    else console.log('[CAPI]', eventName, 'events_received:', json.events_received);
  } catch (e) {
    console.error('[CAPI] erro na requisição:', e.message);
  }
}

module.exports = { sendCapiEvent };
