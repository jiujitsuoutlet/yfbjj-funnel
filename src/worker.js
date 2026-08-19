/**
 * welcome.yogaforbjj.net - funnel Worker.
 *
 * Checkout runs on ThriveCart, not here. This Worker serves the pages, captures
 * leads into D1, and reports health. The Stripe checkout/upsell/webhook layer is
 * parked in src/deferred/ - see the README there.
 *
 * No secrets are needed at present. If the Stripe layer is un-shelved, its keys
 * come from Cloudflare Secrets on `env` and never touch a page or wrangler.toml.
 */

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

/**
 * Page config. Every operator-editable knob lives in [vars] in wrangler.toml and
 * arrives here; pages read it from one JSON island rather than N interpolations,
 * so there is no attribute-injection surface. Only non-secret values are passed.
 */
const PAGE_CONFIG_KEYS = [
  'THRIVECART_BUNDLE_URL',
  'THRIVECART_LIFETIME_URL',
  'OFFER_DEADLINE',
  'BUNDLE_PRICE_CENTS',
  'LIFETIME_PRICE_CENTS',
  'YEARLY_PRICE_CENTS',
];

function renderPage(template, env) {
  const config = {};
  for (const key of PAGE_CONFIG_KEYS) config[key] = env[key] || '';
  // `<` escaped so a value can never close the script tag it sits in.
  const payload = JSON.stringify(config).replace(/</g, '\\u003c');
  return template.replace(/\{\{PAGE_CONFIG_JSON\}\}/g, payload);
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

  // Client hands off to ThriveCart after this resolves; see src/pages/landing.html.
  return json({ ok: true }, 201);
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
    }

    const known = ['/', '/upsell', '/thanks', '/health', '/api/lead'];
    if (known.includes(path)) return json({ ok: false, error: 'method_not_allowed' }, 405);

    return json({ ok: false, error: 'not_found' }, 404);
  },
};
