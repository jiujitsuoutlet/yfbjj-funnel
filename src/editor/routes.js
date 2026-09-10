import { authenticate, authorizeMutation, clearSessionCookie, login, logout, sessionCookie } from './auth.js';
import { EDITOR_IMAGE_PATHS } from './images.js';
import { loadEditorPage, listVersions, publishDraft, restoreVersion, saveDraft } from './repository.js';
import { renderContentDocument } from './renderer.js';
import { validateContentDocument } from './schema.js';
import { listMedia, mediaPaths, saveMedia } from './media.js';
import { AB_DECISION_RULE, conversionSnapshot } from '../analytics.js';

const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-src https://iframe.mediadelivery.net; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra } }); }
function html(body, status = 200) { return new Response(body, { status, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } }); }
function result(value, extra = {}) { return value.ok ? json({ ...value, token: undefined }, value.status || 200, extra) : json({ ok: false, error: value.error, details: value.details }, value.status || 500); }
async function boundedJson(request, limit = 260_000) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) return { ok: false, status: 413, error: 'body_too_large' };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) return { ok: false, status: 413, error: 'body_too_large' };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, status: 400, error: 'invalid_json' }; }
}

export async function handleEditorRoute(request, env, assets) {
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '') || '/'; const method = request.method.toUpperCase();
  if (method === 'GET' && path === '/admin/login') return html(assets.loginHtml.replace('{{ADMIN_CSS}}', assets.css).replace('{{ADMIN_LOGIN_JS}}', assets.loginJs));
  if (method === 'POST' && path === '/admin/login') {
    const value = await login(request, env); if (!value.ok) return result(value);
    return json({ ok: true, csrf: value.csrf, expiresAt: value.expiresAt }, 200, { 'Set-Cookie': sessionCookie(value.token) });
  }
  if (method === 'GET' && path === '/admin/editor') {
    const session = await authenticate(request, env); if (!session.ok) return new Response(null, { status: 302, headers: { ...HEADERS, Location: '/admin/login' } });
    return html(assets.editorHtml.replace('{{ADMIN_CSS}}', assets.css).replace('{{ADMIN_JS}}', assets.js));
  }
  if (!path.startsWith('/api/admin/')) return null;
  if (method === 'GET' && path === '/api/admin/session') {
    const session = await authenticate(request, env); return session.ok ? json({ ok: true, csrf: session.csrf, expiresAt: session.expiresAt }) : result(session);
  }
  if (method === 'POST' && path === '/api/admin/logout') {
    const value = await logout(request, env); return result(value, value.ok ? { 'Set-Cookie': clearSessionCookie() } : {});
  }
  if (method === 'GET' && path === '/api/admin/analytics') {
    const session = await authenticate(request, env); if (!session.ok) return result(session);
    try {
      const [visits, leads, orders, conversion] = await Promise.all([
        env.DB.prepare('SELECT variant, sum(count) AS n FROM variant_visits GROUP BY variant').all(),
        env.DB.prepare('SELECT variant, count(*) AS n FROM leads GROUP BY variant').all(),
        env.DB.prepare(`SELECT json_extract(metadata, '$.variant') AS variant, count(*) AS n, sum(amount_cents) AS cents
          FROM stripe_orders WHERE status IN ('paid', 'complete') GROUP BY json_extract(metadata, '$.variant')`).all(),
        conversionSnapshot(env),
      ]);
      const find = (rows, variant, field) => Number((rows.results || []).find((row) => row.variant === variant)?.[field] || 0);
      const variants = {};
      for (const variant of ['a', 'b']) {
        const visitors = find(visits, variant, 'n'); const purchases = find(orders, variant, 'n'); const revenue = find(orders, variant, 'cents');
        variants[variant] = { visitors, leads: find(leads, variant, 'n'), purchases, revenue_cents: revenue,
          paid_conversion_rate: visitors ? Number((purchases / visitors).toFixed(4)) : null,
          revenue_per_visitor_cents: visitors ? Math.round(revenue / visitors) : null,
          sample_gate_met: visitors >= AB_DECISION_RULE.minimum_visitors_per_variant && purchases >= AB_DECISION_RULE.minimum_purchases_per_variant };
      }
      return json({ ok: true, variants, conversion, abDecisionRule: AB_DECISION_RULE });
    }
    catch { return json({ ok: false, error: 'analytics_unavailable' }, 503); }
  }
  if (method === 'GET' && path === '/api/admin/media') {
    const session = await authenticate(request, env); if (!session.ok) return result(session);
    try { return json({ ok: true, media: await listMedia(env) }); } catch { return json({ ok: false, error: 'media_unavailable' }, 503); }
  }
  if (method === 'POST' && path === '/api/admin/media') {
    const session = await authorizeMutation(request, env); if (!session.ok) return result(session);
    const body = await boundedJson(request, 1_100_000); if (!body.ok) return result(body);
    try { return result(await saveMedia(env, body.value, session.actor)); } catch { return json({ ok: false, error: 'media_save_failed' }, 503); }
  }
  const match = path.match(/^\/api\/admin\/pages\/([a-z0-9-]+)(?:\/(draft|publish|versions|restore|preview))?$/);
  if (!match) return json({ ok: false, error: 'not_found' }, 404);
  const pageKey = match[1]; const action = match[2] || 'page';
  const session = method === 'GET' ? await authenticate(request, env) : await authorizeMutation(request, env);
  if (!session.ok) return result(session);
  if (method === 'GET' && action === 'page') return result(await loadEditorPage(env, pageKey, { actor: session.actor, imagePaths: EDITOR_IMAGE_PATHS }));
  if (method === 'GET' && action === 'versions') return result(await listVersions(env, pageKey));
  if (!['PUT', 'POST'].includes(method)) return json({ ok: false, error: 'method_not_allowed' }, 405);
  const body = await boundedJson(request); if (!body.ok) return result(body);
  if (method === 'PUT' && action === 'draft') return result(await saveDraft(env, pageKey, body.value.document, body.value.expectedRevision, { actor: session.actor, imagePaths: EDITOR_IMAGE_PATHS }));
  if (method === 'POST' && action === 'publish') return result(await publishDraft(env, pageKey, body.value.expectedRevision, { actor: session.actor, imagePaths: EDITOR_IMAGE_PATHS }));
  if (method === 'POST' && action === 'restore') return result(await restoreVersion(env, pageKey, body.value.versionId, body.value.expectedRevision, { actor: session.actor, imagePaths: EDITOR_IMAGE_PATHS }));
  if (method === 'POST' && action === 'preview') {
    const approved = [...EDITOR_IMAGE_PATHS, ...await mediaPaths(env)];
    const checked = validateContentDocument(body.value.document, { pageKey, imagePaths: approved });
    if (!checked.ok) return json({ ok: false, error: 'invalid_document', details: checked.errors }, 400);
    const rendered = renderContentDocument(checked.value, { pageKey, env, context: body.value.context || {} });
    return json({ ok: true, rendered });
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
