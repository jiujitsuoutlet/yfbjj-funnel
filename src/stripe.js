import Stripe from 'stripe';

export const OFFERS = Object.freeze({
  bundle: {
    priceVar: 'STRIPE_PRICE_BUNDLE',
    entitlementKeyVar: 'AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG',
    mode: 'payment',
  },
  head_to_toes: {
    priceVar: 'STRIPE_PRICE_HEAD_TO_TOES',
    entitlementKeyVar: 'AUTOCREATOR_HEAD_TO_TOES_BUNDLE_SLUG',
    mode: 'payment',
  },
  lifetime: {
    priceVar: 'STRIPE_PRICE_LIFETIME',
    entitlementKeyVar: 'AUTOCREATOR_LIFETIME_ENTITLEMENT_TARGET',
    mode: 'payment',
  },
  two_month: {
    priceVar: 'STRIPE_PRICE_TWO_MONTH',
    entitlementKeyVar: 'AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET',
    mode: 'subscription',
  },
});

// AutoCreator's authenticated write contract is not present in this repository.
// Keep Checkout closed until that integration and its retry tests actually exist.
export const FULFILLMENT_IMPLEMENTED = false;
export const AUTOCREATOR_CLIENT_IMPLEMENTED = false;
const READINESS_SCHEMA_VERSION = 1;
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

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
  const missing = [offer.priceVar, offer.entitlementKeyVar].filter((key) => !String(env[key] || '').trim());
  if (offerKey === 'two_month' && !String(env.STRIPE_PRODUCT_TWO_MONTH || '').trim()) {
    missing.push('STRIPE_PRODUCT_TWO_MONTH');
  }
  if (missing.length) return { ok: false, error: 'offer_not_configured', missing };
  return {
    ok: true,
    offer,
    priceId: env[offer.priceVar],
    entitlementKey: env[offer.entitlementKeyVar],
  };
}

function fulfillmentImplemented(deps) {
  return deps.fulfillmentImplemented === true
    || (FULFILLMENT_IMPLEMENTED && AUTOCREATOR_CLIENT_IMPLEMENTED);
}

function clock(deps) {
  return deps.now ? new Date(deps.now()) : new Date();
}

export async function checkRuntimeReadiness(env, deps = {}) {
  if (!fulfillmentImplemented(deps)) return { ok: false, reason: 'fulfillment_not_implemented' };
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.AUTOCREATOR_API_KEY) {
    return { ok: false, reason: 'required_secret_missing' };
  }
  if (env.STRIPE_WEBHOOK_READY !== 'true' || env.AUTOCREATOR_FULFILLMENT_READY !== 'true') {
    return { ok: false, reason: 'runtime_not_approved' };
  }
  if (!env.DB) return { ok: false, reason: 'database_missing' };
  try {
    const row = await env.DB.prepare(
      "SELECT schema_version FROM fulfillment_readiness WHERE singleton = 'runtime'"
    ).bind().first();
    if (!row || Number(row.schema_version) < READINESS_SCHEMA_VERSION) {
      return { ok: false, reason: 'schema_not_ready' };
    }
  } catch {
    return { ok: false, reason: 'schema_not_ready' };
  }
  return { ok: true };
}

export async function handleCheckout(request, env, deps = {}) {
  // This check must precede body parsing and Stripe construction. Unset,
  // misspelled, and every value except the exact string "false" stay locked.
  if (isPreviewMode(env)) return response({ ok: false, error: 'preview_locked' }, 423);

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
  const readiness = await checkRuntimeReadiness(env, deps);
  if (!readiness.ok) return response({ ok: false, error: 'checkout_not_ready' }, 503);
  const { offer, priceId, entitlementKey } = mapping;

  const metadata = { ...cleanAttribution(body.attribution), offer: offerKey, price_id: priceId, entitlement_key: entitlementKey };
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
      return_url: `${new URL(request.url).origin}/thanks?session_id=${encodeURIComponent(body.session_id)}`,
    });
    return response({ ok: true, url: portal.url });
  } catch {
    return response({ ok: false, error: 'unverified_session' }, 403);
  }
}

export async function getOrderFulfillmentState(request, env) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) return { valid: false };
  try {
    const row = await env.DB.prepare(
      'SELECT status, fulfillment_status FROM stripe_orders WHERE session_id = ?1'
    ).bind(sessionId).first();
    if (!row) return { valid: true, payment: 'pending', fulfillment: 'pending' };
    return {
      valid: true,
      payment: row.status || 'pending',
      fulfillment: row.fulfillment_status || 'pending',
    };
  } catch {
    return { valid: true, payment: 'pending', fulfillment: 'pending' };
  }
}

async function claimStripeEvent(env, event, now) {
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS).toISOString();
  const claim = await env.DB.prepare(
    `INSERT INTO stripe_events (id, type, status, attempts, updated_at)
     VALUES (?1, ?2, 'processing', 1, ?3)
     ON CONFLICT(id) DO UPDATE SET status = 'processing', attempts = attempts + 1,
       last_error = NULL, updated_at = excluded.updated_at
     WHERE stripe_events.status = 'failed'
        OR (stripe_events.status = 'processing' AND stripe_events.updated_at <= ?4)
     RETURNING status`
  ).bind(event.id, event.type, now.toISOString(), staleBefore).first();
  if (claim) return { claimed: true };
  const existing = await env.DB.prepare(
    'SELECT status FROM stripe_events WHERE id = ?1'
  ).bind(event.id).first();
  if (existing && existing.status === 'processed') return { claimed: false, duplicate: true };
  return { claimed: false, busy: true };
}

async function runBatch(env, statements) {
  if (typeof env.DB.batch === 'function') return env.DB.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}

function orderStatement(env, session, mapping, status, now) {
  return env.DB.prepare(
    `INSERT INTO stripe_orders (session_id, customer_id, payment_intent_id, subscription_id, offer, price_id, entitlement_key, amount_cents, email, status, metadata, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(session_id) DO UPDATE SET status = excluded.status,
       customer_id = excluded.customer_id, payment_intent_id = excluded.payment_intent_id,
       subscription_id = excluded.subscription_id, amount_cents = excluded.amount_cents,
       email = excluded.email, metadata = excluded.metadata, updated_at = excluded.updated_at`
  ).bind(session.id, session.customer || null, session.payment_intent || null, session.subscription || null,
    session.metadata.offer, mapping.priceId, mapping.entitlementKey, session.amount_total || null,
    session.customer_details && session.customer_details.email || null, status,
    JSON.stringify(cleanAttribution(session.metadata)), now.toISOString());
}

export async function processEntitlementOperation(env, session, mapping, deps = {}) {
  const now = clock(deps);
  const operationKey = `grant:${session.id}:${mapping.entitlementKey}`;
  const leaseExpires = new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO entitlement_outbox
       (operation_key, session_id, entitlement_key, action, status, attempts, updated_at)
     VALUES (?1, ?2, ?3, 'grant', 'pending', 0, ?4)
     ON CONFLICT(operation_key) DO NOTHING`
  ).bind(operationKey, session.id, mapping.entitlementKey, now.toISOString()).run();

  const claim = await env.DB.prepare(
    `UPDATE entitlement_outbox SET status = 'processing', attempts = attempts + 1,
       lease_expires_at = ?2, last_error = NULL, updated_at = ?3
     WHERE operation_key = ?1
       AND (status IN ('pending', 'failed')
         OR (status = 'processing' AND lease_expires_at <= ?3))
     RETURNING status`
  ).bind(operationKey, leaseExpires, now.toISOString()).first();
  if (!claim) {
    const existing = await env.DB.prepare(
      'SELECT status FROM entitlement_outbox WHERE operation_key = ?1'
    ).bind(operationKey).first();
    if (existing && existing.status === 'succeeded') return { ok: true, duplicate: true, operationKey };
    throw new Error('entitlement operation is already processing');
  }

  if (!deps.autocreator || typeof deps.autocreator.grant !== 'function') {
    throw new Error('AutoCreator grant contract is not implemented');
  }
  try {
    await deps.autocreator.grant({
      operationKey,
      offer: session.metadata.offer,
      entitlementKey: mapping.entitlementKey,
      sessionId: session.id,
      email: session.customer_details && session.customer_details.email || null,
    });
    await runBatch(env, [
      env.DB.prepare(
        `UPDATE entitlement_outbox SET status = 'succeeded', lease_expires_at = NULL,
          updated_at = ?2 WHERE operation_key = ?1`
      ).bind(operationKey, clock(deps).toISOString()),
      env.DB.prepare(
        `UPDATE stripe_orders SET fulfillment_status = 'granted', updated_at = ?2
         WHERE session_id = ?1`
      ).bind(session.id, clock(deps).toISOString()),
    ]);
    return { ok: true, operationKey };
  } catch (error) {
    await runBatch(env, [
      env.DB.prepare(
        `UPDATE entitlement_outbox SET status = 'failed', lease_expires_at = NULL,
          last_error = 'grant_failed', updated_at = ?2 WHERE operation_key = ?1`
      ).bind(operationKey, clock(deps).toISOString()),
      env.DB.prepare(
        `UPDATE stripe_orders SET fulfillment_status = 'failed', updated_at = ?2
         WHERE session_id = ?1`
      ).bind(session.id, clock(deps).toISOString()),
    ]);
    throw error;
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
    const now = clock(deps);
    const eventClaim = await claimStripeEvent(env, event, now);
    if (eventClaim.duplicate) return response({ ok: true, duplicate: true });
    if (!eventClaim.claimed) return response({ ok: false, error: 'event_in_progress' }, 503);

    const readiness = await checkRuntimeReadiness(env, deps);
    if (!readiness.ok) throw new Error(`runtime not ready: ${readiness.reason}`);

    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(event.type)) {
      const session = event.data.object;
      const offerKey = session.metadata && session.metadata.offer;
      const mapping = resolveOffer(env, offerKey);
      if (!mapping.ok) throw new Error(`offer mapping missing: ${mapping.missing.join(',')}`);
      if (session.metadata.price_id !== mapping.priceId || session.metadata.entitlement_key !== mapping.entitlementKey) {
        throw new Error('checkout metadata does not match configured offer mapping');
      }

      const failed = event.type === 'checkout.session.async_payment_failed';
      const paid = event.type === 'checkout.session.async_payment_succeeded'
        || ['paid', 'no_payment_required'].includes(session.payment_status);
      const orderStatus = failed ? 'failed' : paid ? 'paid' : 'pending';
      await orderStatement(env, session, mapping, orderStatus, now).run();
      if (paid && !failed) await processEntitlementOperation(env, session, mapping, deps);
    }
    await env.DB.prepare("UPDATE stripe_events SET status = 'processed', updated_at = ?2 WHERE id = ?1")
      .bind(event.id, clock(deps).toISOString()).run();
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
