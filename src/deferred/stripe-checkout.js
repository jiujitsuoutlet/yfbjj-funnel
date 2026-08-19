/**
 * PARKED - not wired into the Worker. See README.md in this directory.
 *
 * Stripe Checkout + one-click upsell + webhook signature verification and
 * idempotency, as built and locally proven on 2026-08-19, lifted out verbatim
 * when checkout moved to ThriveCart.
 *
 * To bring back: `npm i stripe`, restore `import Stripe from 'stripe';`, import
 * these handlers into src/worker.js, re-add the three routes to the router, and
 * set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET as Cloudflare Secrets. The
 * `orders` table and `webhook_events` ledger are already in migrations/0001.
 *
 * The helpers below (json, nowIso) are re-declared here so the file stays
 * self-contained and readable while parked.
 */

import Stripe from 'stripe';

const nowIso = () => new Date().toISOString();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function handleCheckoutStub() {
  return json(
    {
      ok: false,
      error: 'not_implemented',
      note: 'Stub. Will create a Stripe Checkout session for the $14 bundle and return its URL. Needs STRIPE_SECRET_KEY + a live price id.',
    },
    501
  );
}

export function handleUpsellStub() {
  return json(
    {
      ok: false,
      error: 'not_implemented',
      note: 'Stub. Will charge the $297 lifetime upsell one-click off the saved customer/payment method from the bundle purchase.',
    },
    501
  );
}

/**
 * Stripe webhook. Order is load-bearing:
 *   1. verify signature (constructEventAsync + SubtleCrypto provider) -> 400 on failure
 *   2. claim the event id in webhook_events -> duplicate exits before side effects
 *   3. only then run the handler
 */
export async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    console.error('stripe secrets missing from env');
    return json({ ok: false, error: 'stripe_not_configured' }, 500);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ ok: false, error: 'missing_signature' }, 400);

  const rawBody = await request.text();

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
  // Workers have no Node crypto: the async path + SubtleCrypto provider is the
  // only correct one here. stripe.webhooks.constructEvent() would throw.
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.warn('stripe signature verification failed:', err && err.message);
    return json({ ok: false, error: 'invalid_signature' }, 400);
  }

  // Idempotency claim. changes === 0 means another delivery already ran it.
  let claim;
  try {
    claim = await env.DB.prepare(
      'INSERT OR IGNORE INTO webhook_events (stripe_event_id, type, processed_at) VALUES (?1, ?2, ?3)'
    )
      .bind(event.id, event.type, nowIso())
      .run();
  } catch (err) {
    console.error('webhook_events claim failed', err);
    // 500 so Stripe retries: we do not know whether the handler ran.
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  if (!claim.meta || claim.meta.changes === 0) {
    return json({ ok: true, received: true, duplicate: true, id: event.id });
  }

  switch (event.type) {
    case 'checkout.session.completed':
      // TODO: upsert orders row (product 'bundle'), then hand off to fulfilment.
      break;
    case 'payment_intent.succeeded':
      // TODO: lifetime upsell settlement -> orders row (product 'lifetime').
      break;
    default:
      break;
  }

  return json({ ok: true, received: true, id: event.id, type: event.type });
}
