import Stripe from 'stripe';
import { createAutoCreatorClient } from './autocreator.js';

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
const FLOW_TTL_MS = 24 * 60 * 60 * 1000;
const FLOW_COOKIE = 'yfbjj_flow';

export const NEXT_OFFER = Object.freeze({
  bundle: 'head_to_toes',
  head_to_toes: 'lifetime',
  lifetime: null,
  two_month: null,
});
export const SKIP_OFFER = Object.freeze({
  head_to_toes: 'lifetime',
  lifetime: 'two_month',
  two_month: null,
});

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

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function newFlowToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function flowCookie(token) {
  return `${FLOW_COOKIE}=${token}; Path=/; Max-Age=${FLOW_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin;
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
  if (offerKey !== 'bundle') return response({ ok: false, error: 'initial_offer_only' }, 400);
  const mapping = resolveOffer(env, offerKey);
  if (!mapping.ok) {
    const status = mapping.error === 'invalid_offer' ? 400 : 503;
    return response({ ok: false, error: mapping.error, missing: mapping.missing }, status);
  }
  const readiness = await checkRuntimeReadiness(env, deps);
  if (!readiness.ok) return response({ ok: false, error: 'checkout_not_ready' }, 503);
  const { offer, priceId, entitlementKey } = mapping;
  const now = clock(deps);
  let token = readCookie(request, FLOW_COOKIE);
  let flowHash = token ? await sha256Hex(token) : null;
  if (flowHash) {
    const existing = await env.DB.prepare(
      `SELECT pending_checkout_url FROM checkout_flows
       WHERE flow_hash = ?1 AND status = 'front_checkout' AND expires_at > ?2`
    ).bind(flowHash, now.toISOString()).first();
    if (existing && existing.pending_checkout_url) {
      return response({ ok: true, url: existing.pending_checkout_url, replay: true });
    }
  }
  token = newFlowToken();
  flowHash = await sha256Hex(token);
  const attribution = cleanAttribution(body.attribution);
  const metadata = { ...attribution, offer: offerKey, price_id: priceId, entitlement_key: entitlementKey, flow_hash: flowHash };
  const origin = new URL(request.url).origin;
  const params = {
    mode: offer.mode,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    customer_creation: 'always',
    success_url: `${origin}/offer?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    payment_intent_data: { metadata },
  };

  try {
    await env.DB.prepare(
      `INSERT INTO checkout_flows
       (flow_hash, status, attribution, expires_at, updated_at)
       VALUES (?1, 'front_checkout', ?2, ?3, ?4)`
    ).bind(flowHash, JSON.stringify(attribution), new Date(now.getTime() + FLOW_TTL_MS).toISOString(), now.toISOString()).run();
    const stripe = deps.stripe || stripeClient(env);
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `front:${flowHash}`,
    });
    await env.DB.prepare(
      `UPDATE checkout_flows SET root_session_id = ?2, pending_session_id = ?2,
       pending_checkout_url = ?3, updated_at = ?4 WHERE flow_hash = ?1`
    ).bind(flowHash, session.id, session.url, clock(deps).toISOString()).run();
    return response({ ok: true, url: session.url }, 200, { 'set-cookie': flowCookie(token) });
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

async function authenticatedFlow(request, env, deps = {}, sourceSessionId = null) {
  const token = readCookie(request, FLOW_COOKIE);
  if (!token) return { ok: false, status: 401, error: 'flow_cookie_missing' };
  const flowHash = await sha256Hex(token);
  const now = clock(deps).toISOString();
  const flow = await env.DB.prepare(
    `SELECT flow_hash, root_session_id, customer_id, email, current_offer, status,
      authorized_session_id, pending_session_id, pending_checkout_url, attribution,
      expires_at, two_month_trial_end, version
     FROM checkout_flows WHERE flow_hash = ?1 AND expires_at > ?2`
  ).bind(flowHash, now).first();
  if (!flow) return { ok: false, status: 401, error: 'flow_invalid' };
  const sessionId = sourceSessionId || new URL(request.url).searchParams.get('session_id');
  if (!sessionId || sessionId !== flow.authorized_session_id) {
    return { ok: false, status: 403, error: 'session_not_authorized' };
  }
  const order = await env.DB.prepare(
    `SELECT status, fulfillment_status, access_state, flow_hash, customer_id, email
     FROM stripe_orders WHERE session_id = ?1`
  ).bind(sessionId).first();
  if (!order || order.status !== 'paid' || order.fulfillment_status !== 'granted'
    || order.flow_hash !== flowHash || order.customer_id !== flow.customer_id
    || String(order.email || '').toLowerCase() !== String(flow.email || '').toLowerCase()) {
    return { ok: false, status: 403, error: 'prior_access_not_verified' };
  }
  try {
    const stripe = deps.stripe || stripeClient(env);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)
      || session.customer !== flow.customer_id) {
      return { ok: false, status: 403, error: 'stripe_session_not_verified' };
    }
    return { ok: true, flow, flowHash, session, stripe, order };
  } catch {
    return { ok: false, status: 503, error: 'stripe_verification_failed' };
  }
}

export async function getOfferJourneyState(request, env, deps = {}) {
  if (isPreviewMode(env)) {
    const requested = new URL(request.url).searchParams.get('step');
    return { ok: true, preview: true, offer: OFFERS[requested] && requested !== 'bundle' ? requested : 'head_to_toes' };
  }
  const token = readCookie(request, FLOW_COOKIE);
  const requestedSession = new URL(request.url).searchParams.get('session_id');
  if (token && requestedSession) {
    const flowHash = await sha256Hex(token);
    const pending = await env.DB.prepare(
      `SELECT pending_session_id, authorized_session_id, status
       FROM checkout_flows WHERE flow_hash = ?1 AND expires_at > ?2`
    ).bind(flowHash, clock(deps).toISOString()).first();
    if (pending && requestedSession === pending.pending_session_id
      && requestedSession !== pending.authorized_session_id) {
      return { ok: true, pending: true };
    }
  }
  const auth = await authenticatedFlow(request, env, deps);
  if (!auth.ok) return auth;
  if (auth.flow.status === 'complete') return { ok: true, complete: true, access: auth.order.access_state };
  if (!auth.flow.current_offer) return { ok: true, pending: true };
  return {
    ok: true,
    offer: auth.flow.current_offer,
    checkoutPending: auth.flow.status === 'checkout_pending',
    trialEnd: auth.flow.two_month_trial_end || null,
  };
}

function childCheckoutParams(env, mapping, offerKey, auth, request, deps) {
  const attribution = cleanAttribution(JSON.parse(auth.flow.attribution || '{}'));
  const metadata = {
    ...attribution,
    offer: offerKey,
    price_id: mapping.priceId,
    entitlement_key: mapping.entitlementKey,
    flow_hash: auth.flowHash,
    root_session_id: auth.flow.root_session_id,
    parent_session_id: auth.flow.authorized_session_id,
    step: offerKey,
  };
  const origin = new URL(request.url).origin;
  const params = {
    mode: mapping.offer.mode,
    customer: auth.flow.customer_id,
    line_items: [{ price: mapping.priceId, quantity: 1 }],
    metadata,
    success_url: `${origin}/offer?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/offer?session_id=${encodeURIComponent(auth.flow.authorized_session_id)}&checkout=cancelled`,
  };
  let trialEnd = null;
  if (mapping.offer.mode === 'payment') {
    params.payment_intent_data = { metadata };
  } else {
    trialEnd = auth.flow.two_month_trial_end
      ? new Date(auth.flow.two_month_trial_end)
      : addCalendarMonths(clock(deps), 2);
    params.line_items.unshift({
      price_data: { currency: 'usd', product: env.STRIPE_PRODUCT_TWO_MONTH, unit_amount: 800 },
      quantity: 1,
    });
    params.subscription_data = { metadata, trial_end: Math.floor(trialEnd.getTime() / 1000) };
  }
  return { params, metadata, trialEnd };
}

export async function handleOfferCheckout(request, env, deps = {}) {
  if (isPreviewMode(env)) return response({ ok: false, error: 'preview_locked' }, 423);
  if (!sameOrigin(request)) return response({ ok: false, error: 'origin_rejected' }, 403);
  let body;
  try { body = await request.json(); } catch { return response({ ok: false, error: 'invalid_body' }, 400); }
  const sourceSessionId = body && body.source_session_id;
  const auth = await authenticatedFlow(request, env, deps, sourceSessionId);
  if (!auth.ok) return response({ ok: false, error: auth.error }, auth.status);
  const offerKey = auth.flow.current_offer;
  if (!offerKey || auth.flow.status === 'complete') return response({ ok: false, error: 'journey_complete' }, 409);
  if (auth.flow.status === 'checkout_pending' && auth.flow.pending_checkout_url) {
    return response({ ok: true, url: auth.flow.pending_checkout_url, replay: true });
  }
  if (auth.flow.status !== 'offer_ready') return response({ ok: false, error: 'step_not_ready' }, 409);
  const mapping = resolveOffer(env, offerKey);
  if (!mapping.ok) return response({ ok: false, error: mapping.error, missing: mapping.missing }, 503);
  const readiness = await checkRuntimeReadiness(env, deps);
  if (!readiness.ok) return response({ ok: false, error: 'checkout_not_ready' }, 503);
  const { params, trialEnd } = childCheckoutParams(env, mapping, offerKey, auth, request, deps);
  try {
    const session = await auth.stripe.checkout.sessions.create(params, {
      idempotencyKey: `offer:${auth.flowHash}:${offerKey}`,
    });
    const changed = await env.DB.prepare(
      `UPDATE checkout_flows SET status = 'checkout_pending', pending_session_id = ?2,
       pending_checkout_url = ?3, two_month_trial_end = ?4, version = version + 1,
       updated_at = ?5 WHERE flow_hash = ?1 AND status = 'offer_ready' AND current_offer = ?6
       RETURNING flow_hash`
    ).bind(auth.flowHash, session.id, session.url, trialEnd && trialEnd.toISOString(), clock(deps).toISOString(), offerKey).first();
    if (!changed) return response({ ok: false, error: 'concurrent_transition' }, 409);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO offer_transitions
       (flow_hash, source_session_id, offer, action, checkout_session_id, attribution, created_at)
       VALUES (?1, ?2, ?3, 'accept', ?4, ?5, ?6)`
    ).bind(auth.flowHash, sourceSessionId, offerKey, session.id, auth.flow.attribution || '{}', clock(deps).toISOString()).run();
    return response({ ok: true, url: session.url, trial_end: trialEnd && trialEnd.toISOString() });
  } catch (error) {
    console.error('offer checkout creation failed', { type: error && error.type, code: error && error.code });
    return response({ ok: false, error: 'checkout_failed' }, 502);
  }
}

export async function handleOfferSkip(request, env, deps = {}) {
  if (isPreviewMode(env)) return response({ ok: false, error: 'preview_locked' }, 423);
  if (!sameOrigin(request)) return response({ ok: false, error: 'origin_rejected' }, 403);
  let body;
  try { body = await request.json(); } catch { return response({ ok: false, error: 'invalid_body' }, 400); }
  const sourceSessionId = body && body.source_session_id;
  const auth = await authenticatedFlow(request, env, deps, sourceSessionId);
  if (!auth.ok) return response({ ok: false, error: auth.error }, auth.status);
  const current = auth.flow.current_offer;
  if (!current || auth.flow.status === 'complete') return response({ ok: false, error: 'journey_complete' }, 409);
  const next = SKIP_OFFER[current];
  const trialEnd = next === 'two_month' ? addCalendarMonths(clock(deps), 2).toISOString() : null;
  const changed = await env.DB.prepare(
    `UPDATE checkout_flows SET current_offer = ?2, status = ?3,
      pending_session_id = NULL, pending_checkout_url = NULL,
      two_month_trial_end = ?4, version = version + 1, updated_at = ?5
     WHERE flow_hash = ?1 AND current_offer = ?6 AND status IN ('offer_ready', 'checkout_pending')
     RETURNING flow_hash`
  ).bind(auth.flowHash, next, next ? 'offer_ready' : 'complete', trialEnd, clock(deps).toISOString(), current).first();
  if (!changed) return response({ ok: false, error: 'concurrent_transition' }, 409);
  await env.DB.prepare(
    `INSERT INTO offer_transitions
     (flow_hash, source_session_id, offer, action, attribution, created_at)
     VALUES (?1, ?2, ?3, 'skip', ?4, ?5)`
  ).bind(auth.flowHash, sourceSessionId, current, auth.flow.attribution || '{}', clock(deps).toISOString()).run();
  return response({ ok: true, url: next ? `/offer?session_id=${encodeURIComponent(sourceSessionId)}` : `/thanks?session_id=${encodeURIComponent(sourceSessionId)}` });
}

export async function getOrderFulfillmentState(request, env) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) return { valid: false };
  try {
    const row = await env.DB.prepare(
      'SELECT status, fulfillment_status, access_state FROM stripe_orders WHERE session_id = ?1'
    ).bind(sessionId).first();
    if (!row) return { valid: true, payment: 'pending', fulfillment: 'pending' };
    return {
      valid: true,
      payment: row.status || 'pending',
      fulfillment: row.fulfillment_status || 'pending',
      access: row.access_state || 'pending',
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
    `INSERT INTO stripe_orders (session_id, customer_id, payment_intent_id, subscription_id, offer, price_id, entitlement_key, amount_cents, email, status, metadata, root_session_id, parent_session_id, flow_hash, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
     ON CONFLICT(session_id) DO UPDATE SET status = excluded.status,
       customer_id = excluded.customer_id, payment_intent_id = excluded.payment_intent_id,
       subscription_id = excluded.subscription_id, amount_cents = excluded.amount_cents,
       email = excluded.email, metadata = excluded.metadata,
       root_session_id = excluded.root_session_id, parent_session_id = excluded.parent_session_id,
       flow_hash = excluded.flow_hash, updated_at = excluded.updated_at`
  ).bind(session.id, session.customer || null, session.payment_intent || null, session.subscription || null,
    session.metadata.offer, mapping.priceId, mapping.entitlementKey, session.amount_total || null,
    session.customer_details && session.customer_details.email || null, status,
    JSON.stringify(cleanAttribution(session.metadata)), session.metadata.root_session_id || session.id,
    session.metadata.parent_session_id || null, session.metadata.flow_hash || null, now.toISOString());
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

  const autocreator = deps.autocreator || createAutoCreatorClient(env, deps.autocreatorDeps);
  try {
    const grant = await autocreator.grant({
      operationKey,
      offer: session.metadata.offer,
      entitlementKey: mapping.entitlementKey,
      sessionId: session.id,
      email: session.customer_details && session.customer_details.email || null,
      customerId: session.customer || null,
      subscriptionId: session.subscription || null,
    });
    await runBatch(env, [
      env.DB.prepare(
        `UPDATE entitlement_outbox SET status = 'succeeded', lease_expires_at = NULL,
          updated_at = ?2 WHERE operation_key = ?1`
      ).bind(operationKey, clock(deps).toISOString()),
      env.DB.prepare(
        `UPDATE stripe_orders SET fulfillment_status = 'granted', access_state = ?3, updated_at = ?2
         WHERE session_id = ?1`
      ).bind(session.id, clock(deps).toISOString(), grant && grant.activationNeeded ? 'activation_needed' : 'active'),
    ]);
    return { ok: true, operationKey };
  } catch (error) {
    await runBatch(env, [
      env.DB.prepare(
        `UPDATE entitlement_outbox SET status = 'failed', lease_expires_at = NULL,
          last_error = 'grant_failed', updated_at = ?2 WHERE operation_key = ?1`
      ).bind(operationKey, clock(deps).toISOString()),
      env.DB.prepare(
        `UPDATE stripe_orders SET fulfillment_status = 'failed', access_state = 'failed', updated_at = ?2
         WHERE session_id = ?1`
      ).bind(session.id, clock(deps).toISOString()),
    ]);
    throw error;
  }
}

async function advanceFlowAfterGrant(env, session, now) {
  const metadata = session.metadata || {};
  const flowHash = metadata.flow_hash;
  if (!flowHash) throw new Error('checkout flow metadata is missing');
  const email = session.customer_details && session.customer_details.email || null;
  let changed;
  if (metadata.offer === 'bundle') {
    changed = await env.DB.prepare(
      `UPDATE checkout_flows SET customer_id = ?2, email = ?3,
        authorized_session_id = ?4, current_offer = 'head_to_toes', status = 'offer_ready',
        pending_session_id = NULL, pending_checkout_url = NULL, version = version + 1,
        updated_at = ?5
       WHERE flow_hash = ?1 AND root_session_id = ?4 AND status = 'front_checkout'
       RETURNING flow_hash`
    ).bind(flowHash, session.customer || null, email, session.id, now.toISOString()).first();
  } else {
    const next = NEXT_OFFER[metadata.offer];
    changed = await env.DB.prepare(
      `UPDATE checkout_flows SET authorized_session_id = ?2, current_offer = ?3,
        status = ?4, pending_session_id = NULL, pending_checkout_url = NULL,
        version = version + 1, updated_at = ?5
       WHERE flow_hash = ?1 AND pending_session_id = ?2 AND current_offer = ?6
         AND status = 'checkout_pending' AND customer_id = ?7
       RETURNING flow_hash`
    ).bind(flowHash, session.id, next, next ? 'offer_ready' : 'complete', now.toISOString(), metadata.offer, session.customer || null).first();
  }
  if (!changed) throw new Error('checkout flow transition was stale or out of order');
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
      if (paid && !failed) {
        await processEntitlementOperation(env, session, mapping, deps);
        await advanceFlowAfterGrant(env, session, clock(deps));
      }
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
