/**
 * welcome.yogaforbjj.net - funnel Worker.
 *
 * Serves the landing page, captures leads, and owns guarded Stripe Checkout and
 * webhook routes. Payment and AutoCreator entitlement writes remain fail-closed
 * until the complete mapping and fulfillment contract are configured.
 *
 * Stripe keys come from Cloudflare Secrets on `env`. They never touch a page or
 * wrangler.toml.
 */

import landingAHtml from './pages/landing-a.html';
import landingBHtml from './pages/landing-b.html';
import thanksHtml from './pages/thanks.html';
import offerHtml from './pages/offer.html';
import previewCheckoutHtml from './pages/preview-checkout.html';
import publishedHtml from './pages/published.html';
import adminLoginHtml from './pages/admin-login.html';
import adminEditorHtml from './pages/admin-editor.html';
import baseCss from './pages/_base.css';
import pageJs from './pages/_page.js';
import adminCss from './pages/_admin.css';
import adminJs from './pages/_admin.js';
import adminLoginJs from './pages/_admin-login.js';
import { EDITOR_IMAGE_PATHS } from './editor/images.js';
import { loadPublishedDocument } from './editor/repository.js';
import { renderContentDocument } from './editor/renderer.js';
import { handleEditorRoute } from './editor/routes.js';
import {
  getOfferJourneyState,
  getOrderFulfillmentState,
  handleCheckout,
  handleOfferCheckout,
  handleOfferSkip,
  handlePortal,
  handleWebhook,
} from './stripe.js';

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
const BUYER_STATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

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

function isNoD1Preview(env) {
  return isPreviewMode(env) && String(env.PREVIEW_NO_D1 || '').trim().toLowerCase() === 'true';
}

function renderPage(template, env, variant, extra = {}) {
  const config = {};
  for (const key of PAGE_CONFIG_KEYS) config[key] = env[key] || '';
  config.PREVIEW_MODE = isPreviewMode(env);
  config.VARIANT = variant || '';
  Object.assign(config, extra);
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

async function renderPublishedPage(env, pageKey, variant, extra = {}, context = {}) {
  const document = await loadPublishedDocument(env, pageKey, { imagePaths: EDITOR_IMAGE_PATHS });
  if (!document) return null;
  const rendered = renderContentDocument(document, { pageKey, env, context });
  const template = publishedHtml
    .replace(/\{\{EDITOR_TITLE\}\}/g, () => rendered.title)
    .replace(/\{\{EDITOR_DESCRIPTION\}\}/g, () => rendered.description)
    .replace(/\{\{EDITOR_BODY\}\}/g, () => rendered.body);
  return renderPage(template, env, variant, extra);
}

function renderThanksPage(env, state) {
  const copy = {
    preview: {
      title: 'Checkout preview', kicker: 'Preview', headline: 'Checkout is locked.',
      message: 'No payment or access change happened in this preview.',
      support: 'This page will report the durable order state after checkout is connected.',
    },
    pending: {
      title: 'Order processing', kicker: 'Order processing', headline: 'We are checking your order.',
      message: 'Access has not been confirmed yet. This page will only say you are in after the entitlement grant is durably recorded.',
      support: 'If this is still pending after 15 minutes, write to <a href="mailto:Sebastian@yogaforbjj.net">Sebastian@yogaforbjj.net</a> with your Stripe receipt.',
    },
    failed: {
      title: 'Payment not completed', kicker: 'Payment not completed', headline: 'Your order needs attention.',
      message: 'Access was not granted. Return to the offer and try checkout again.',
      support: 'Questions? Write to <a href="mailto:Sebastian@yogaforbjj.net">Sebastian@yogaforbjj.net</a>.',
    },
    granted: {
      title: 'Access granted', kicker: 'Order confirmed', headline: "You're in.",
      message: 'Payment is complete and your access grant is durably recorded.',
      support: 'Sign in to Yoga for BJJ to use your access. If anything looks wrong, write to <a href="mailto:Sebastian@yogaforbjj.net">Sebastian@yogaforbjj.net</a> with your Stripe receipt.',
    },
    activation: {
      title: 'Activate your access', kicker: 'Order confirmed', headline: 'Your access is assigned.',
      message: 'Payment is complete. Your Yoga for BJJ access is assigned, but this account has not signed in yet.',
      support: 'Open Yoga for BJJ and use the email from checkout to sign in. If you need help, write to <a href="mailto:Sebastian@yogaforbjj.net">Sebastian@yogaforbjj.net</a> with your Stripe receipt.',
    },
  }[state];
  return renderPage(thanksHtml, env, null)
    .replace(/\{\{THANKS_TITLE\}\}/g, () => copy.title)
    .replace(/\{\{THANKS_KICKER\}\}/g, () => copy.kicker)
    .replace(/\{\{THANKS_HEADLINE\}\}/g, () => copy.headline)
    .replace(/\{\{THANKS_MESSAGE\}\}/g, () => copy.message)
    .replace(/\{\{THANKS_SUPPORT\}\}/g, () => copy.support);
}

function offerCopy(offer, trialEnd) {
  if (offer === 'head_to_toes') return {
    title: 'Head to Toes', kicker: 'Optional next step', headline: 'Add Head to Toes.',
    message: 'Keep this separate from your Guard Retention purchase. Choose it only if you want it.',
    price: '$29', terms: 'A new Stripe Checkout opens. Nothing is charged unless you confirm there.',
    accept: 'Add Head to Toes for $29', skip: 'No thanks. Show me the next option.',
  };
  if (offer === 'lifetime') return {
    title: 'Lifetime access', kicker: 'Optional next step', headline: 'Choose lifetime access.',
    message: 'This is a separate one-time purchase.',
    price: '$247 once', terms: 'A new Stripe Checkout opens. Nothing is charged unless you confirm there.',
    accept: 'Choose lifetime for $247', skip: 'No thanks. Show me the lower-cost option.',
  };
  if (offer === 'certification') return {
    title: 'Instructor certification', kicker: 'Final optional offer', headline: 'Teach Yoga for BJJ.',
    message: 'Levels 1, 2 and 3. This is for coaches and prospective coaches who intend to teach this material to grapplers.',
    price: '$297 once', terms: 'One payment. A new Stripe Checkout opens. Nothing is charged unless you confirm there.',
    accept: 'Get all three levels for $297', skip: 'No thanks. Finish my order.',
  };
  const starts = trialEnd
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(trialEnd)) + ' UTC'
    : '30 days after you complete checkout';
  return {
    title: '$8 first month', kicker: 'Optional lower-cost option', headline: 'Start your first month for $8.',
    message: 'Then it continues at $19.99 per month unless you cancel. Canceling stops future charges. Your course access remains.',
    price: '$8 first month', terms: `Then $19.99 per month starting ${starts}, until canceled. Stripe shows the same terms before you confirm.`,
    accept: 'Start for $8', skip: 'No thanks. Show me the final option.',
  };
}

function renderOfferPage(env, state, sourceSessionId) {
  const copy = offerCopy(state.offer, state.trialEnd);
  return renderPage(offerHtml, env, null, { SOURCE_SESSION_ID: sourceSessionId })
    .replace(/\{\{OFFER_TITLE\}\}/g, () => copy.title)
    .replace(/\{\{OFFER_KICKER\}\}/g, () => copy.kicker)
    .replace(/\{\{OFFER_HEADLINE\}\}/g, () => copy.headline)
    .replace(/\{\{OFFER_MESSAGE\}\}/g, () => copy.message)
    .replace(/\{\{OFFER_PRICE\}\}/g, () => copy.price)
    .replace(/\{\{OFFER_TERMS\}\}/g, () => copy.terms)
    .replace(/\{\{OFFER_ACCEPT\}\}/g, () => copy.accept)
    .replace(/\{\{OFFER_SKIP\}\}/g, () => copy.skip);
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

async function handleLanding(request, env, ctx) {
  const { variant, assigned } = assignVariant(request);
  const doc = variant === 'b' ? landingBHtml : landingAHtml;
  const edited = await renderPublishedPage(env, `landing-${variant}`, variant);

  // The response body now depends on a cookie, so it must never be held in a
  // shared cache. This costs the landing page its edge caching: a deliberate
  // trade, and the reason to end the test rather than leave it running.
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (assigned) headers['Set-Cookie'] = variantCookie(variant);

  const response = html(edited || renderPage(doc, env, variant), 200, headers);
  if (assigned && !isNoD1Preview(env) && ctx && ctx.waitUntil) ctx.waitUntil(countVisit(env, variant));
  return response;
}

async function handleHealth(env) {
  if (isNoD1Preview(env)) {
    return json({ ok: false, d1: 'intentionally_unbound', preview: true, at: nowIso() }, 503);
  }
  try {
    const row = await env.DB.prepare(
      `SELECT count(*) AS n FROM sqlite_master
        WHERE type = 'table' AND name IN ('leads', 'rate_limits', 'variant_visits', 'stripe_events', 'stripe_orders', 'fulfillment_readiness', 'entitlement_outbox', 'checkout_flows', 'offer_transitions')`
    ).first();
    const tables = row ? row.n : 0;
    if (tables < 9) {
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
  if (isNoD1Preview(env)) {
    return json({ ok: false, error: 'preview_state_disabled' }, 503);
  }
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

  // The client starts guarded Stripe Checkout after this resolves.
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
  if (isNoD1Preview(env)) {
    return json({ ok: false, error: 'preview_state_disabled' }, 503);
  }
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
      env.DB.prepare(`SELECT json_extract(metadata, '$.variant') AS variant,
          count(*) AS n, sum(amount_cents) AS cents
        FROM stripe_orders
        WHERE status IN ('paid', 'complete')
        GROUP BY json_extract(metadata, '$.variant')`).all(),
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
        purchases: 'Counted from signed Stripe Checkout completion events recorded in stripe_orders.',
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

    if (path === '/admin') return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', Location: '/admin/editor' } });
    if (path.startsWith('/admin/') || path.startsWith('/api/admin/')) {
      const editorResponse = await handleEditorRoute(request, env, {
        loginHtml: adminLoginHtml, editorHtml: adminEditorHtml, css: adminCss, js: adminJs, loginJs: adminLoginJs,
      });
      if (editorResponse) return editorResponse;
    }

    if (method === 'HEAD' || method === 'GET') {
      if (path === '/') return handleLanding(request, env, ctx);
      if (path === '/thanks') {
        if (isPreviewMode(env)) return html(await renderPublishedPage(env, 'thanks-preview', null) || renderThanksPage(env, 'preview'), 200, BUYER_STATE_HEADERS);
        const order = await getOrderFulfillmentState(request, env);
        if (!order.valid) return json({ ok: false, error: 'invalid_session' }, 400);
        const state = order.fulfillment === 'granted'
          ? order.access === 'activation_needed' ? 'activation' : 'granted'
          : order.payment === 'failed' || order.fulfillment === 'failed' ? 'failed' : 'pending';
        return html(await renderPublishedPage(env, `thanks-${state}`, null) || renderThanksPage(env, state), state === 'pending' ? 202 : 200, BUYER_STATE_HEADERS);
      }
      if (path === '/offer') {
        const state = await getOfferJourneyState(request, env);
        if (!state.ok) return json({ ok: false, error: state.error }, state.status || 403);
        if (state.pending) return html(await renderPublishedPage(env, 'thanks-pending', null) || renderThanksPage(env, 'pending'), 202, BUYER_STATE_HEADERS);
        if (state.complete) {
          const completeState = state.access === 'activation_needed' ? 'activation' : 'granted';
          return html(await renderPublishedPage(env, `thanks-${completeState}`, null) || renderThanksPage(env, completeState), 200, BUYER_STATE_HEADERS);
        }
        const offerPageKey = `offer-${String(state.offer || '').replace(/_/g, '-')}`;
        return html(await renderPublishedPage(env, offerPageKey, null, { SOURCE_SESSION_ID: url.searchParams.get('session_id') || '' }, { trialEnd: state.trialEnd }) || renderOfferPage(env, state, url.searchParams.get('session_id') || ''), 200, BUYER_STATE_HEADERS);
      }
      if (path === '/preview-checkout') return html(await renderPublishedPage(env, 'preview-checkout', null) || renderPage(previewCheckoutHtml, env, null));
      if (path === '/health') return handleHealth(env);
      if (path === '/api/stats') return handleStats(request, env);
    }

    if (method === 'POST') {
      if (path === '/api/checkout' && isPreviewMode(env)) {
        return json({ ok: false, error: 'preview_locked' }, 423);
      }
      if (path === '/api/lead') return handleLead(request, env, ctx);
      if (path === '/api/checkout') return handleCheckout(request, env);
      if (path === '/api/offer-checkout') return handleOfferCheckout(request, env);
      if (path === '/api/offer-skip') return handleOfferSkip(request, env);
      if (path === '/api/customer-portal') return handlePortal(request, env);
      if (path === '/api/stripe-webhook') return handleWebhook(request, env);
    }

    const known = ['/', '/offer', '/thanks', '/preview-checkout', '/health', '/api/lead', '/api/stats', '/api/checkout', '/api/offer-checkout', '/api/offer-skip', '/api/customer-portal', '/api/stripe-webhook', '/admin/login', '/admin/editor'];
    if (known.includes(path)) return json({ ok: false, error: 'method_not_allowed' }, 405);

    return json({ ok: false, error: 'not_found' }, 404);
  },
};
