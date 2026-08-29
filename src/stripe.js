import Stripe from 'stripe';

export const OFFERS = Object.freeze({
  bundle: { priceVar: 'STRIPE_PRICE_BUNDLE', mode: 'payment' },
  head_to_toes: { priceVar: 'STRIPE_PRICE_HEAD_TO_TOES', mode: 'payment' },
  lifetime: { priceVar: 'STRIPE_PRICE_LIFETIME', mode: 'payment' },
  two_month: { priceVar: 'STRIPE_PRICE_TWO_MONTH', mode: 'subscription' },
});

export const AUTOCREATOR_PRICE_MAP = Object.freeze({
  price_1U9IkNIwpEtt4FIedvXFb9tC: 'Guard Retention',
});

const ATTRIBUTION_KEYS = ['variant', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
const encoder = new TextEncoder();

export function isPreviewMode(env) {
  return env.PREVIEW_MODE !== 'false';
}

export function addCalendarMonths(date, months) {
  const source = new Date(date);
  const day = source.getUTCDate();
  const result = new Date(source);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function cleanAttribution(input = {}) {
  const metadata = {};
  for (const key of ATTRIBUTION_KEYS) {
    if (typeof input[key] === 'string' && input[key].trim()) metadata[key] = input[key].trim().slice(0, 200);
  }
  return metadata;
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function stripeClient(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
}

export async function handleCheckout(request, env, deps = {}) {
  // This check must precede body parsing and Stripe construction. Unset,
  // misspelled, and every value except the exact string "false" stay locked.
  if (isPreviewMode(env)) return response({ ok: false, error: 'preview_locked' }, 423);
  if (!env.STRIPE_SECRET_KEY) return response({ ok: false, error: 'stripe_not_configured' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, error: 'invalid_body' }, 400);
  }
  const offerKey = body && body.offer;
  const offer = OFFERS[offerKey];
  if (!offer || !env[offer.priceVar]) return response({ ok: false, error: 'invalid_offer' }, 400);

  const metadata = { ...cleanAttribution(body.attribution), offer: offerKey, price_id: env[offer.priceVar] };
  const origin = new URL(request.url).origin;
  const params = {
    mode: offer.mode,
    line_items: [{ price: env[offer.priceVar], quantity: 1 }],
    metadata,
    success_url: `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
  };
  if (offer.mode === 'payment') {
    params.payment_intent_data = { metadata };
  } else {
    // The verified Two-Month Price is the continuing $20/month item. Checkout
    // collects the initial $8 as a one-time item, while the recurring item is
    // trialled until the same UTC calendar date two months later.
    params.line_items.unshift({
      price_data: { currency: 'usd', product: env.STRIPE_PRODUCT_TWO_MONTH, unit_amount: 800 },
      quantity: 1,
    });
    params.subscription_data = {
      metadata,
      trial_end: Math.floor(addCalendarMonths(deps.now ? deps.now() : new Date(), 2).getTime() / 1000),
    };
  }

  try {
    const stripe = deps.stripe || stripeClient(env);
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: request.headers.get('idempotency-key') || crypto.randomUUID(),
    });
    return response({ ok: true, url: session.url });
  } catch (error) {
    console.error('checkout creation failed', { type: error && error.type, code: error && error.code });
    return response({ ok: false, error: 'checkout_failed' }, 502);
  }
}

export async function handlePortal(request, env, deps = {}) {
  if (isPreviewMode(env)) return response({ ok: false, error: 'preview_locked' }, 423);
  if (!env.STRIPE_SECRET_KEY) return response({ ok: false, error: 'stripe_not_configured' }, 503);
  let body;
  try { body = await request.json(); } catch { return response({ ok: false, error: 'invalid_body' }, 400); }
  if (!body || typeof body.session_id !== 'string') return response({ ok: false, error: 'invalid_session' }, 400);
  try {
    const stripe = deps.stripe || stripeClient(env);
    const checkout = await stripe.checkout.sessions.retrieve(body.session_id);
    if (checkout.status !== 'complete' || !checkout.customer) return response({ ok: false, error: 'unverified_session' }, 403);
    const portal = await stripe.billingPortal.sessions.create({
      customer: checkout.customer,
      return_url: new URL(request.url).origin + '/thanks',
    });
    return response({ ok: true, url: portal.url });
  } catch {
    return response({ ok: false, error: 'unverified_session' }, 403);
  }
}

async function verifySignature(raw, signature, secret, timestamp = Date.now()) {
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=', 2)));
  const seconds = Number(parts.t);
  if (!seconds || !parts.v1 || Math.abs(timestamp / 1000 - seconds) > 300) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${seconds}.${raw}`));
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (actual.length !== parts.v1.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return difference === 0;
}

export async function handleWebhook(request, env, deps = {}) {
  if (!env.STRIPE_WEBHOOK_SECRET) return response({ ok: false, error: 'webhook_not_configured' }, 503);
  const signature = request.headers.get('stripe-signature');
  const raw = await request.text();
  if (!signature || !(await verifySignature(raw, signature, env.STRIPE_WEBHOOK_SECRET, deps.timestamp))) {
    return response({ ok: false, error: 'invalid_signature' }, 400);
  }
  let event;
  try { event = JSON.parse(raw); } catch { return response({ ok: false, error: 'invalid_payload' }, 400); }

  try {
    const claim = await env.DB.prepare(
      `INSERT INTO stripe_events (id, type, status, attempts, updated_at)
       VALUES (?1, ?2, 'processing', 1, ?3)
       ON CONFLICT(id) DO UPDATE SET status = 'processing', attempts = attempts + 1, updated_at = excluded.updated_at
       WHERE stripe_events.status = 'failed'
       RETURNING status`
    ).bind(event.id, event.type, new Date().toISOString()).first();
    if (!claim) return response({ ok: true, duplicate: true });

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      await env.DB.prepare(
        `INSERT INTO stripe_orders (session_id, customer_id, payment_intent_id, subscription_id, offer, price_id, email, status, metadata, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
      ).bind(session.id, session.customer || null, session.payment_intent || null, session.subscription || null,
        session.metadata && session.metadata.offer || 'unknown', session.metadata && session.metadata.price_id || null,
        session.customer_details && session.customer_details.email || null, session.payment_status || session.status,
        JSON.stringify(cleanAttribution(session.metadata)), new Date().toISOString()).run();
      // Mapping is explicit and auditable. Entitlement writes intentionally do
      // not exist in this Worker until AutoCreator's contract is verified.
    }
    await env.DB.prepare("UPDATE stripe_events SET status = 'processed', updated_at = ?2 WHERE id = ?1")
      .bind(event.id, new Date().toISOString()).run();
    return response({ ok: true });
  } catch (error) {
    console.error('webhook processing failed', { event_id: event.id, event_type: event.type });
    try {
      await env.DB.prepare("UPDATE stripe_events SET status = 'failed', last_error = 'processing_failed', updated_at = ?2 WHERE id = ?1")
        .bind(event.id, new Date().toISOString()).run();
    } catch { /* Stripe will retry the original delivery. */ }
    return response({ ok: false, error: 'processing_failed' }, 500);
  }
}

export { verifySignature };
