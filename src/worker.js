/**
 * welcome.yogaforbjj.net - funnel Worker.
 *
 * One job: the landing page for the $14 Guard Retention Bundle, plus lead
 * capture. Checkout and everything after it belongs to ThriveCart, including
 * the whole post-purchase upsell chain, because one-click requires the payment
 * session to stay on their side. The Stripe layer and the old /upsell page are
 * parked in src/deferred/ - see the README there.
 *
 * No secrets are needed at present. If the Stripe layer is un-shelved, its keys
 * come from Cloudflare Secrets on `env` and never touch a page or wrangler.toml.
 */

import landingAHtml from './pages/landing-a.html';
import landingBHtml from './pages/landing-b.html';
import thanksHtml from './pages/thanks.html';
import previewCheckoutHtml from './pages/preview-checkout.html';
import baseCss from './pages/_base.css';
import pageJs from './pages/_page.js';
import { handleCheckout, handlePortal, handleWebhook } from './stripe.js';

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

function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Paid traffic: short edge/browser cache, long stale window. The landing
      // page overrides this, because its body depends on the variant cookie.
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Page config. Every operator-editable knob lives in [vars] in wrangler.toml and
 * arrives here; pages read it from one JSON island rather than N interpolations,
 * so there is no attribute-injection surface. Only non-secret values are passed.
 */
const PAGE_CONFIG_KEYS = [
  'PREVIEW_MODE',
  'THRIVECART_BUNDLE_URL',
  'OFFER_DEADLINE',
  'BUNDLE_PRICE_CENTS',
];

/* --------------------------------------------------------------- A/B test */

const VARIANT_COOKIE = 'yfbjj_v';
const VARIANTS = ['a', 'b'];
const VARIANT_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

/**
 * Crawlers are served variant A and are never assigned, cookied, or counted.
 * Keeping them out of the denominator matters more than which page they see:
 * a preview fetch that lands in the visitor count quietly biases the split.
 */
const BOT_RE = /bot\b|crawler|crawling|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discord|slackbot|embedly|quora link preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget\/|python-requests|axios\/|node-fetch|go-http-client|java\/|libwww|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider|duckduckbot|applebot|gptbot|claudebot|ccbot|perplexity/i;

function isBot(request) {
  const ua = request.headers.get('user-agent') || '';
  return ua === '' || BOT_RE.test(ua);
}

function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Unbiased coin. Math.random is fine here too, but this is free and auditable. */
function coinFlip() {
  const byte = new Uint8Array(1);
  crypto.getRandomValues(byte);
  return byte[0] < 128 ? 'a' : 'b';
}

/**
 * Decides the variant BEFORE anything renders, so there is no client-side
 * redirect and no flash of the wrong page.
 *   1. ?v=a / ?v=b wins, and never sets a cookie or counts a visit
 *   2. an existing cookie wins next, so a returning visitor is stable
 *   3. bots get A, uncounted
 *   4. everyone else is flipped, cookied and counted once
 */
function assignVariant(request) {
  const override = (new URL(request.url).searchParams.get('v') || '').toLowerCase();
  if (VARIANTS.includes(override)) return { variant: override, assigned: false, forced: true };

  const cookie = readCookie(request, VARIANT_COOKIE);
  if (VARIANTS.includes(cookie)) return { variant: cookie, assigned: false, forced: false };

  if (isBot(request)) return { variant: 'a', assigned: false, forced: false, bot: true };

  return { variant: coinFlip(), assigned: true, forced: false };
}

function variantCookie(variant) {
  return `${VARIANT_COOKIE}=${variant}; Path=/; Max-Age=${VARIANT_MAX_AGE}; SameSite=Lax; Secure; HttpOnly`;
}

const utcDay = () => nowIso().slice(0, 10);

async function countVisit(env, variant) {
  try {
    await env.DB.prepare(
      `INSERT INTO variant_visits (variant, day, count) VALUES (?1, ?2, 1)
       ON CONFLICT(variant, day) DO UPDATE SET count = count + 1`
    )
      .bind(variant, utcDay())
      .run();
  } catch (err) {
    console.error('visit count failed', err);
  }
}

/**
 * PREVIEW_MODE defaults to TRUE and must be turned off explicitly. An unset or
 * malformed value means preview, so a missing var can never route paid traffic
 * at a cart that is not ready.
 */
function isPreviewMode(env) {
  return env.PREVIEW_MODE !== 'false';
}

function renderPage(template, env, variant) {
  const config = {};
  for (const key of PAGE_CONFIG_KEYS) config[key] = env[key] || '';
  config.PREVIEW_MODE = isPreviewMode(env);
  config.VARIANT = variant || '';
  // `<` escaped so a value can never close the script tag it sits in.
  const payload = JSON.stringify(config).replace(/</g, '\\u003c');
  // Replacer FUNCTIONS, not strings: a replacement string treats $$, $&, $`
  // and $' as patterns, which silently mangles any injected JS or URL that
  // contains them (`return '$' + ...` became `return '` and broke the page).
  return template
    .replace(/\{\{BASE_CSS\}\}/g, () => baseCss)
    .replace(/\{\{PAGE_JS\}\}/g, () => pageJs)
    .replace(/\{\{PAGE_CONFIG_JSON\}\}/g, () => payload);
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

function handleLanding(request, env, ctx) {
  const { variant, assigned } = assignVariant(request);
  const doc = variant === 'b' ? landingBHtml : landingAHtml;

  // The response body now depends on a cookie, so it must never be held in a
  // shared cache. This costs the landing page its edge caching: a deliberate
  // trade, and the reason to end the test rather than leave it running.
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (assigned) headers['Set-Cookie'] = variantCookie(variant);

  const response = html(renderPage(doc, env, variant), 200, headers);
  if (assigned && ctx && ctx.waitUntil) ctx.waitUntil(countVisit(env, variant));
  return response;
}

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

  // Trust our own cookie over anything the client sends; fall back to the body
  // only when the cookie is missing, which is the forced-override case.
  const cookieVariant = readCookie(request, VARIANT_COOKIE);
  const bodyVariant = typeof payload.variant === 'string' ? payload.variant.toLowerCase() : '';
  const variant = VARIANTS.includes(cookieVariant)
    ? cookieVariant
    : VARIANTS.includes(bodyVariant)
      ? bodyVariant
      : null;

  try {
    await env.DB.prepare(
      'INSERT INTO leads (id, email, source, variant, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
    )
      .bind(crypto.randomUUID(), email, source, variant, nowIso())
      .run();
  } catch (err) {
    console.error('lead insert failed', err);
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  // Client hands off to ThriveCart after this resolves; see src/pages/landing.html.
  return json({ ok: true }, 201);
}

/**
 * Per-variant counts. JSON only, no dashboard.
 * Auth: Authorization: Bearer <STATS_SECRET>, read from Cloudflare Secrets.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleStats(request, env) {
  if (!env.STATS_SECRET) {
    console.error('STATS_SECRET missing from env');
    return json({ ok: false, error: 'stats_not_configured' }, 500);
  }

  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!timingSafeEqual(token, env.STATS_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }

  try {
    const [visits, leads, orders] = await Promise.all([
      env.DB.prepare('SELECT variant, sum(count) AS n FROM variant_visits GROUP BY variant').all(),
      env.DB.prepare('SELECT variant, count(*) AS n FROM leads GROUP BY variant').all(),
      env.DB.prepare('SELECT variant, count(*) AS n, sum(amount_cents) AS cents FROM orders GROUP BY variant').all(),
    ]);

    const tally = (rows, field = 'n') => {
      const out = {};
      for (const row of rows.results || []) out[row.variant || 'unassigned'] = row[field] || 0;
      return out;
    };

    const visitors = tally(visits);
    const leadCounts = tally(leads);
    const orderCounts = tally(orders);
    const orderCents = tally(orders, 'cents');

    const variants = {};
    for (const v of VARIANTS) {
      const seen = visitors[v] || 0;
      const captured = leadCounts[v] || 0;
      variants[v] = {
        visitors: seen,
        leads: captured,
        lead_rate: seen ? Number((captured / seen).toFixed(4)) : null,
        purchases: orderCounts[v] || 0,
        revenue_cents: orderCents[v] || 0,
      };
    }

    return json({
      ok: true,
      at: nowIso(),
      variants,
      unassigned_leads: leadCounts.unassigned || 0,
      notes: {
        visitors: 'Counted once per newly assigned human. Returning visitors, ?v= overrides and bots are excluded.',
        purchases: 'Always 0 until a ThriveCart webhook writes to the orders table. Nothing writes it yet.',
      },
    });
  } catch (err) {
    console.error('stats query failed', err);
    return json({ ok: false, error: 'query_failed' }, 500);
  }
}

/* ------------------------------------------------------------------ router */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (method === 'HEAD' || method === 'GET') {
      if (path === '/') return handleLanding(request, env, ctx);
      if (path === '/thanks') return html(renderPage(thanksHtml, env, null));
      if (path === '/preview-checkout') return html(renderPage(previewCheckoutHtml, env, null));
      if (path === '/health') return handleHealth(env);
      if (path === '/api/stats') return handleStats(request, env);
    }

    if (method === 'POST') {
      if (path === '/api/lead') return handleLead(request, env, ctx);
      if (path === '/api/checkout') return handleCheckout(request, env);
      if (path === '/api/customer-portal') return handlePortal(request, env);
      if (path === '/api/stripe-webhook') return handleWebhook(request, env);
    }

    const known = ['/', '/thanks', '/preview-checkout', '/health', '/api/lead', '/api/stats', '/api/checkout', '/api/customer-portal', '/api/stripe-webhook'];
    if (known.includes(path)) return json({ ok: false, error: 'method_not_allowed' }, 405);

    return json({ ok: false, error: 'not_found' }, 404);
  },
};
