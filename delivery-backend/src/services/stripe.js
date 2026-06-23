require('dotenv').config();
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

async function createPixPayment(orderId, totalBRL) {
  // Stripe cobra em centavos
  const amountCents = Math.round(parseFloat(totalBRL) * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'brl',
    payment_method_types: ['pix'],
    metadata: { order_id: orderId },
    payment_method_options: {
      pix: {
        expires_after_seconds: 3600, // 1 hora
      },
    },
  });

  // Confirma para gerar QR code
  const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id, {
    payment_method: 'pix',
  });

  const nextAction = confirmed.next_action?.pix_display_qr_code;

  return {
    paymentIntentId: confirmed.id,
    clientSecret: confirmed.client_secret,
    qrCode: nextAction?.data || null,
    qrCodeUrl: nextAction?.image_url_svg || null,
    expiresAt: nextAction?.expires_at || null,
  };
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = { createPixPayment, constructWebhookEvent, stripe };
