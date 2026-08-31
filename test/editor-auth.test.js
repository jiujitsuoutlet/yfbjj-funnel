import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticate, authorizeMutation, sessionCookie, sha256 } from '../src/editor/auth.js';

function envFor(row) {
  return { ADMIN_PASSWORD: 'a-high-entropy-random-admin-secret', DB: { prepare(sql) { return { bind() { return {
    first: async () => sql.includes('SELECT csrf_token') ? row : null,
    run: async () => ({ success: true }),
  }; } }; } } };
}
async function request(headers = {}) {
  return new Request('https://funnel.test/api/admin/pages/landing-a/draft', { method: 'PUT', headers: { cookie: '__Host-yfbjj_admin=token', origin: 'https://funnel.test', 'content-type': 'application/json', ...headers }, body: '{}' });
}

test('admin cookie is host-only, secure, strict, and unreadable to scripts', () => {
  const value = sessionCookie('opaque');
  assert.match(value, /^__Host-yfbjj_admin=opaque;/);
  assert.match(value, /HttpOnly/); assert.match(value, /Secure/); assert.match(value, /SameSite=Strict/); assert.match(value, /Path=\//);
  assert.doesNotMatch(value, /Domain=/);
});

test('missing secret and corrupt or expired session timestamps fail closed', async () => {
  const req = await request();
  assert.equal((await authenticate(req, { DB: {} })).status, 503);
  assert.equal((await authenticate(req, envFor({ csrf_token: 'csrf', expires_at: 'not-a-date' }))).status, 401);
  assert.equal((await authenticate(req, envFor({ csrf_token: 'csrf', expires_at: '2020-01-01T00:00:00Z' }))).status, 401);
});

test('mutation requires exact origin and matching CSRF token', async () => {
  const valid = envFor({ csrf_token: 'csrf', expires_at: '2099-01-01T00:00:00Z' });
  assert.equal((await authorizeMutation(await request({ origin: 'https://attacker.test' }), valid)).status, 403);
  assert.equal((await authorizeMutation(await request({ 'x-csrf-token': 'wrong' }), valid)).status, 403);
  assert.equal((await authorizeMutation(await request({ 'x-csrf-token': 'csrf' }), valid)).ok, true);
  assert.equal((await sha256('same')), (await sha256('same')));
});
