const PIXEL_ID = '1061008356398242';

function uid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function initPixel() {
  if (typeof window === 'undefined' || window.fbq) return;
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
  (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');
}

export function trackViewOferta(product) {
  const eventId = uid();
  window.fbq?.('track', 'ViewContent', {
    content_ids: [product.id],
    content_name: product.name,
    content_type: 'product',
    value: parseFloat(product.promo_price ?? product.price) || 0,
    currency: 'BRL',
  }, { eventID: eventId });
  return eventId;
}

export function trackAddToCart(product, qty, unitPrice) {
  const eventId = uid();
  window.fbq?.('track', 'AddToCart', {
    content_ids: [product.id],
    content_name: product.name,
    content_type: 'product',
    value: parseFloat((unitPrice * qty).toFixed(2)),
    currency: 'BRL',
    num_items: qty,
  }, { eventID: eventId });
  return eventId;
}

export function trackInitiateCheckout(items, subtotal) {
  const eventId = uid();
  window.fbq?.('track', 'InitiateCheckout', {
    content_ids: items.map(i => i.product.id),
    num_items: items.reduce((s, i) => s + i.qty, 0),
    value: parseFloat(subtotal.toFixed(2)),
    currency: 'BRL',
  }, { eventID: eventId });
  return eventId;
}

export function trackPurchase(orderId, total, items) {
  const eventId = uid();
  window.fbq?.('track', 'Purchase', {
    content_ids: items.map(i => i.product.id),
    content_type: 'product',
    value: parseFloat(total.toFixed(2)),
    currency: 'BRL',
    num_items: items.reduce((s, i) => s + i.qty, 0),
    order_id: orderId,
  }, { eventID: eventId });
  return eventId;
}
