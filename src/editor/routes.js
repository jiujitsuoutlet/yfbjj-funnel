import { authenticate, authorizeMutation, clearSessionCookie, login, logout, sessionCookie } from './auth.js';
import { EDITOR_IMAGE_PATHS } from './images.js';
import { loadEditorPage, listVersions, publishDraft, restoreVersion, saveDraft } from './repository.js';
import { renderContentDocument } from './renderer.js';
import { validateContentDocument } from './schema.js';

const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
    const checked = validateContentDocument(body.value.document, { pageKey, imagePaths: EDITOR_IMAGE_PATHS });
    if (!checked.ok) return json({ ok: false, error: 'invalid_document', details: checked.errors }, 400);
    const rendered = renderContentDocument(checked.value, { pageKey, env, context: body.value.context || {} });
    return json({ ok: true, rendered });
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
