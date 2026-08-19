/**
 * welcome.yogaforbjj.net - funnel Worker.
 *
 * Infrastructure + skeleton only: checkout and upsell are deliberate 501 stubs.
 * The only fully-live paths are the pages, /api/lead, /health, and Stripe
 * webhook signature verification + idempotency.
 *
 * Secrets discipline: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET arrive as
 * Cloudflare Secrets on `env`. Nothing secret is ever inlined into a page.
 */

import Stripe from 'stripe';

import landingHtml from './pages/landing.html';
import upsellHtml from './pages/upsell.html';
import thanksHtml from './pages/thanks.html';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // When Stripe.js is added, extend script-src with https://js.stripe.com and
  // frame-src with https://js.stripe.com https://hooks.stripe.com.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const nowIso = () => new Date().toISOString();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Paid traffic: short edge/browser cache, long stale window.
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      ...SECURITY_HEADERS,
    },
  });
}

/** Interpolates [vars] into a page. Only non-secret values are ever passed. */
function renderPage(template, env) {
  return template.replace(/\{\{STRIPE_PUBLISHABLE_KEY\}\}/g, env.STRIPE_PUBLISHABLE_KEY || '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/* -------------------------------------------------------------- rate limit */

const LEAD_BURST_PER_MIN = 5;
const LEAD_SUSTAINED_PER_HOUR = 30;
const HOUR = 3600;

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * Two layers, cheapest first:
 *   1. Workers Rate Limiting binding - 5/min, in-memory at the colo, no D1 write.
 *   2. D1 fixed hourly window - 30/hour. Only reachable by requests that already
 *      cleared layer 1, so D1 writes are bounded at 5/min/IP.
 * Both are keyed on SHA-256(client IP); raw IPs are never stored.
 */
async function checkLeadRateLimit(request, env, ctx) {
  const key = await sha256Hex(clientIp(request));

  if (env.LEAD_RATE_LIMIT) {
    const { success } = await env.LEAD_RATE_LIMIT.limit({ key });
    if (!success) return { allowed: false, scope: 'minute', limit: LEAD_BURST_PER_MIN, retryAfter: 60 };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % HOUR);

  let row;
  try {
    row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket_key, window_start, count)
            VALUES (?1, ?2, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET
            count = CASE WHEN rate_limits.window_start = excluded.window_start
                         THEN rate_limits.count + 1 ELSE 1 END,
            window_start = excluded.window_start
         RETURNING count`
    )
      .bind(key, windowStart)
      .first();
  } catch (err) {
    // Fail open: a limiter outage must not take the funnel down.
    console.error('rate limit check failed, allowing request', err);
    return { allowed: true };
  }

  const count = row ? row.count : 1;

  // Opportunistic sweep of dead buckets; ~2% of first-hits in a window.
  if (count === 1 && Math.random() < 0.02 && ctx && ctx.waitUntil) {
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1')
        .bind(windowStart - HOUR)
        .run()
        .catch((err) => console.error('rate limit sweep failed', err))
    );
  }

  if (count > LEAD_SUSTAINED_PER_HOUR) {
    return {
      allowed: false,
      scope: 'hour',
      limit: LEAD_SUSTAINED_PER_HOUR,
      retryAfter: windowStart + HOUR - now,
    };
  }

  return { allowed: true };
}

/* ------------------------------------------------------------------ routes */

async function handleHealth(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT count(*) AS n FROM sqlite_master
        WHERE type = 'table' AND name IN ('orders', 'webhook_events', 'leads')`
    ).first();
    const tables = row ? row.n : 0;
    if (tables < 3) {
      return json(
        { ok: false, d1: 'connected', schema: 'incomplete', tables_found: tables, at: nowIso() },
        503
      );
    }
    return json({ ok: true, d1: 'connected', schema: 'ok', tables_found: tables, at: nowIso() });
  } catch (err) {
    return json({ ok: false, d1: 'unreachable', error: String(err && err.message || err), at: nowIso() }, 503);
  }
}

async function handleLead(request, env, ctx) {
  const rl = await checkLeadRateLimit(request, env, ctx);
  if (!rl.allowed) {
    return json(
      { ok: false, error: 'rate_limited', scope: rl.scope, limit: rl.limit, retry_after: rl.retryAfter },
      429,
      { 'Retry-After': String(rl.retryAfter) }
    );
  }

  let payload;
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = Object.fromEntries(form.entries());
    }
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }

  const email = normalizeEmail(payload && payload.email);
  if (!email) return json({ ok: false, error: 'invalid_email' }, 400);

  const source = typeof payload.source === 'string' ? payload.source.slice(0, 64) : 'landing';

  try {
    await env.DB.prepare('INSERT INTO leads (id, email, source, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(crypto.randomUUID(), email, source, nowIso())
      .run();
  } catch (err) {
    console.error('lead insert failed', err);
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  // next: /api/checkout creates the Stripe Checkout session for the bundle.
  return json({ ok: true, next: '/api/checkout' }, 201);
}

function handleCheckoutStub() {
  return json(
    {
      ok: false,
      error: 'not_implemented',
      note: 'Stub. Will create a Stripe Checkout session for the $14 bundle and return its URL. Needs STRIPE_SECRET_KEY + a live price id.',
    },
    501
  );
}

function handleUpsellStub() {
  return json(
    {
      ok: false,
      error: 'not_implemented',
      note: 'Stub. Will charge the $360 lifetime upsell one-click off the saved customer/payment method from the bundle purchase.',
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
async function handleStripeWebhook(request, env) {
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

/* ------------------------------------------------------------------ router */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (method === 'HEAD' || method === 'GET') {
      if (path === '/') return html(renderPage(landingHtml, env));
      if (path === '/upsell') return html(renderPage(upsellHtml, env));
      if (path === '/thanks') return html(renderPage(thanksHtml, env));
      if (path === '/health') return handleHealth(env);
    }

    if (method === 'POST') {
      if (path === '/api/lead') return handleLead(request, env, ctx);
      if (path === '/api/checkout') return handleCheckoutStub();
      if (path === '/api/upsell') return handleUpsellStub();
      if (path === '/api/stripe-webhook') return handleStripeWebhook(request, env);
    }

    const known = ['/', '/upsell', '/thanks', '/health', '/api/lead', '/api/checkout', '/api/upsell', '/api/stripe-webhook'];
    if (known.includes(path)) return json({ ok: false, error: 'method_not_allowed' }, 405);

    return json({ ok: false, error: 'not_found' }, 404);
  },
};
