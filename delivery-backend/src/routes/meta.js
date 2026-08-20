const router = require('express').Router();
const { sendCapiEvent } = require('../services/metaCapi');

// POST /api/meta/purchase — recebe event_id do frontend e dispara CAPI Purchase
router.post('/purchase', async (req, res) => {
  const { event_id, order_id, total, currency, content_ids, num_items,
          phone, email, first_name, last_name } = req.body;
  if (!event_id) return res.status(400).json({ error: 'event_id obrigatório' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const userAgent = req.headers['user-agent'] || '';

  // Fire-and-forget — não bloqueia resposta ao cliente
  sendCapiEvent({
    eventName: 'Purchase',
    eventId: event_id,
    userData: { phone, email, firstName: first_name, lastName: last_name, ip, userAgent },
    customData: {
      value: parseFloat(total) || 0,
      currency: currency || 'BRL',
      content_ids: content_ids || [],
      content_type: 'product',
      num_items: num_items || 1,
      order_id,
    },
  }).catch(() => {});

  res.json({ ok: true });
});

// POST /api/meta/event — endpoint genérico para outros eventos (AddToCart, ViewContent, etc.)
router.post('/event', async (req, res) => {
  const { event_name, event_id, phone, email, first_name, last_name, custom_data } = req.body;
  if (!event_name || !event_id) return res.status(400).json({ error: 'event_name e event_id obrigatórios' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const userAgent = req.headers['user-agent'] || '';

  sendCapiEvent({
    eventName: event_name,
    eventId: event_id,
    userData: { phone, email, firstName: first_name, lastName: last_name, ip, userAgent },
    customData: custom_data || {},
  }).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
