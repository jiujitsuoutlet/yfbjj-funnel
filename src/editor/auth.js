const COOKIE = '__Host-yfbjj_admin';
const MAX_AGE = 28_800;
const WINDOW_SECONDS = 900;
const MAX_ATTEMPTS = 5;

const encoder = new TextEncoder();
function hex(bytes) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value)))); }
function randomToken() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function equalHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let different = 0; for (let index = 0; index < a.length; index++) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}
function cookieValue(request) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [name, ...rest] = part.trim().split('='); if (name === COOKIE) return rest.join('=');
  }
  return '';
}
export function sameOrigin(request) { return request.headers.get('origin') === new URL(request.url).origin; }
export function sessionCookie(token) { return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`; }
export function clearSessionCookie() { return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`; }

async function rateLimit(request, env, now) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const bucket = await sha256(`editor-login:${ip}`);
  const windowStart = Math.floor(now.getTime() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  await env.DB.prepare(
    `INSERT INTO editor_login_attempts (bucket_key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(bucket_key) DO UPDATE SET count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
     window_start = ?2`
  ).bind(bucket, windowStart).run();
  const row = await env.DB.prepare('SELECT count FROM editor_login_attempts WHERE bucket_key = ?1').bind(bucket).first();
  return Number(row && row.count) > MAX_ATTEMPTS;
}

export async function login(request, env, { now = new Date() } = {}) {
  if (!env.ADMIN_PASSWORD) return { ok: false, status: 503, error: 'admin_not_configured' };
  if (!env.DB) return { ok: false, status: 503, error: 'editor_storage_unavailable' };
  if (!sameOrigin(request)) return { ok: false, status: 403, error: 'origin_rejected' };
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return { ok: false, status: 415, error: 'json_required' };
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 4096) return { ok: false, status: 413, error: 'body_too_large' };
  if (await rateLimit(request, env, now)) return { ok: false, status: 429, error: 'rate_limited' };
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 4096) return { ok: false, status: 413, error: 'body_too_large' };
  let body; try { body = JSON.parse(raw); } catch { return { ok: false, status: 400, error: 'invalid_json' }; }
  const supplied = await sha256(body && body.password || '');
  const expected = await sha256(env.ADMIN_PASSWORD);
  if (!equalHex(supplied, expected)) return { ok: false, status: 401, error: 'invalid_credentials' };
  const token = randomToken(); const csrf = randomToken();
  const createdAt = now.toISOString(); const expiresAt = new Date(now.getTime() + MAX_AGE * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO editor_sessions (token_hash, csrf_token, expires_at, last_seen_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?4)`
  ).bind(await sha256(token), csrf, expiresAt, createdAt).run();
  await env.DB.prepare(
    `INSERT INTO editor_audit_log (id, actor, action, created_at) VALUES (?1, 'admin', 'login', ?2)`
  ).bind(crypto.randomUUID(), createdAt).run();
  return { ok: true, status: 200, token, csrf, expiresAt };
}

export async function authenticate(request, env, { now = new Date(), touch = true } = {}) {
  if (!env.ADMIN_PASSWORD || !env.DB) return { ok: false, status: 503, error: 'admin_unavailable' };
  const token = cookieValue(request); if (!token) return { ok: false, status: 401, error: 'unauthorized' };
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT csrf_token, expires_at FROM editor_sessions WHERE token_hash = ?1'
  ).bind(tokenHash).first();
  const expiry = row ? Date.parse(row.expires_at) : NaN;
  if (!row || !Number.isFinite(expiry) || expiry <= now.getTime()) {
    if (row) await env.DB.prepare('DELETE FROM editor_sessions WHERE token_hash = ?1').bind(tokenHash).run();
    return { ok: false, status: 401, error: 'session_expired' };
  }
  if (touch) await env.DB.prepare('UPDATE editor_sessions SET last_seen_at = ?2 WHERE token_hash = ?1').bind(tokenHash, now.toISOString()).run();
  return { ok: true, tokenHash, csrf: row.csrf_token, expiresAt: row.expires_at, actor: 'admin' };
}

export async function authorizeMutation(request, env, options) {
  if (!sameOrigin(request)) return { ok: false, status: 403, error: 'origin_rejected' };
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return { ok: false, status: 415, error: 'json_required' };
  const session = await authenticate(request, env, options); if (!session.ok) return session;
  const supplied = request.headers.get('x-csrf-token') || '';
  if (!equalHex(await sha256(supplied), await sha256(session.csrf))) return { ok: false, status: 403, error: 'csrf_rejected' };
  return session;
}

export async function logout(request, env) {
  const session = await authorizeMutation(request, env); if (!session.ok) return session;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM editor_sessions WHERE token_hash = ?1').bind(session.tokenHash),
    env.DB.prepare(`INSERT INTO editor_audit_log (id, actor, action, created_at) VALUES (?1, 'admin', 'logout', ?2)`).bind(crypto.randomUUID(), new Date().toISOString()),
  ]);
  return { ok: true, status: 200 };
}
