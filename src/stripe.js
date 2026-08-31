import Stripe from 'stripe';

export const OFFERS = Object.freeze({
  bundle: {
    priceVar: 'STRIPE_PRICE_BUNDLE',
    entitlementVar: 'AUTOCREATOR_ENTITLEMENT_GUARD_RETENTION_ID',
    mode: 'payment',
  },
  head_to_toes: {
    priceVar: 'STRIPE_PRICE_HEAD_TO_TOES',
    entitlementVar: 'AUTOCREATOR_ENTITLEMENT_HEAD_TO_TOES_ID',
    mode: 'payment',
  },
  lifetime: {
    priceVar: 'STRIPE_PRICE_LIFETIME',
    entitlementVar: 'AUTOCREATOR_ENTITLEMENT_LIFETIME_ID',
    mode: 'payment',
  },
  two_month: {
    priceVar: 'STRIPE_PRICE_TWO_MONTH',
    entitlementVar: 'AUTOCREATOR_ENTITLEMENT_TWO_MONTH_ID',
    mode: 'subscription',
  },
});

// AutoCreator's authenticated write contract is not present in this repository.
// Keep Checkout closed until that integration and its retry tests actually exist.
export const FULFILLMENT_IMPLEMENTED = false;

const ATTRIBUTION_KEYS = ['variant', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid'];

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

export function resolveOffer(env, offerKey) {
  const offer = OFFERS[offerKey];
  if (!offer) return { ok: false, error: 'invalid_offer', missing: [] };
  const missing = [offer.priceVar, offer.entitlementVar].filter((key) => !String(env[key] || '').trim());
  if (offerKey === 'two_month' && !String(env.STRIPE_PRODUCT_TWO_MONTH || '').trim()) {
    missing.push('STRIPE_PRODUCT_TWO_MONTH');
  }
  if (missing.length) return { ok: false, error: 'offer_not_configured', missing };
  return {
    ok: true,
    offer,
    priceId: env[offer.priceVar],
    entitlementId: env[offer.entitlementVar],
  };
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
  const mapping = resolveOffer(env, offerKey);
  if (!mapping.ok) {
    const status = mapping.error === 'invalid_offer' ? 400 : 503;
    return response({ ok: false, error: mapping.error, missing: mapping.missing }, status);
  }
  if (!FULFILLMENT_IMPLEMENTED && deps.allowUnimplementedFulfillment !== true) {
    return response({ ok: false, error: 'fulfillment_not_ready' }, 503);
  }
  const { offer, priceId, entitlementId } = mapping;

  const metadata = { ...cleanAttribution(body.attribution), offer: offerKey, price_id: priceId, entitlement_id: entitlementId };
  const origin = new URL(request.url).origin;
  const params = {
    mode: offer.mode,
    line_items: [{ price: priceId, quantity: 1 }],
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

export async function verifyCompletedCheckout(request, env, deps = {}) {
  if (isPreviewMode(env)) return false;
  if (!env.STRIPE_SECRET_KEY) return false;
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) return false;
  try {
    const stripe = deps.stripe || stripeClient(env);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status);
  } catch {
    return false;
  }
}

export async function handleWebhook(request, env, deps = {}) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return response({ ok: false, error: 'webhook_not_configured' }, 503);
  }
  const signature = request.headers.get('stripe-signature');
  const raw = await request.text();
  let event;
  try {
    const stripe = deps.stripe || stripeClient(env);
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
      deps.timestamp ? deps.timestamp / 1000 : undefined
    );
  } catch {
    return response({ ok: false, error: 'invalid_signature' }, 400);
  }

  try {
    const claim = await env.DB.prepare(
      `INSERT INTO stripe_events (id, type, status, attempts, updated_at)
       VALUES (?1, ?2, 'processing', 1, ?3)
       ON CONFLICT(id) DO UPDATE SET status = 'processing', attempts = attempts + 1, updated_at = excluded.updated_at
       WHERE stripe_events.status = 'failed'
       RETURNING status`
    ).bind(event.id, event.type, new Date().toISOString()).first();
    if (!claim) return response({ ok: true, duplicate: true });
    if (!FULFILLMENT_IMPLEMENTED && deps.allowUnimplementedFulfillment !== true) {
      throw new Error('fulfillment is not implemented');
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const offerKey = session.metadata && session.metadata.offer;
      const mapping = resolveOffer(env, offerKey);
      if (!mapping.ok) throw new Error(`offer mapping missing: ${mapping.missing.join(',')}`);
      if (session.metadata.price_id !== mapping.priceId || session.metadata.entitlement_id !== mapping.entitlementId) {
        throw new Error('checkout metadata does not match configured offer mapping');
      }
      await env.DB.prepare(
        `INSERT INTO stripe_orders (session_id, customer_id, payment_intent_id, subscription_id, offer, price_id, entitlement_id, amount_cents, email, status, metadata, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
      ).bind(session.id, session.customer || null, session.payment_intent || null, session.subscription || null,
        offerKey, mapping.priceId, mapping.entitlementId, session.amount_total || null,
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
