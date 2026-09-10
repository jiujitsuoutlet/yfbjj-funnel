import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoCreatorError, createAutoCreatorClient } from '../src/autocreator.js';

const env = { AUTOCREATOR_API_KEY: 'fixture_key' };

function ok(tool, result) {
  return new Response(JSON.stringify({ ok: true, tool, result }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

function queued(responses, calls = []) {
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const next = responses.shift();
      return typeof next === 'function' ? next(url, init) : next;
    },
  };
}

test('bundle grant uses the documented envelope and requires exact read-back', async () => {
  const transport = queued([
    ok('members.findByEmail', { member: { id: 'member_1', last_sign_in_at: null } }),
    ok('members.grantBundleEntitlement', { already_existed: true }),
    ok('members.listBundleEntitlements', { items: [{ bundle_slug: 'guard-retention', status: 'active' }] }),
    ok('members.invite', { sent: true }),
  ]);
  const client = createAutoCreatorClient(env, transport);
  const result = await client.grant({
    offer: 'bundle', entitlementKey: 'guard-retention', sessionId: 'cs_1', email: 'buyer@example.com',
  });
  assert.deepEqual(result, { verified: true, activationNeeded: true, emailSent: true });
  assert.equal(transport.calls[1].url, 'https://yfbjj.autocreator.ai/api/v1/tools/members.grantBundleEntitlement');
  assert.equal(transport.calls[0].init.headers.Authorization, 'Bearer fixture_key');
  assert.deepEqual(transport.calls[1].body, { args: {
    email: 'buyer@example.com', bundle_slug: 'guard-retention', notes: 'Stripe Checkout cs_1',
  } });
  assert.deepEqual(transport.calls[3].body, { args: {
    email: 'buyer@example.com', next: '/dashboard', invite_type: 'set_password',
  } });
  assert.equal(transport.calls.length, 4);
});

test('Certification grants all three level bundles and requires every exact read-back', async () => {
  const entitlementKeys = [
    'level-1-instructors-course',
    'level-2-instructor-course',
    'level-3-instructors-course',
  ];
  const transport = queued([
    ok('members.findByEmail', { member: { id: 'member_cert', last_sign_in_at: '2026-01-01T00:00:00Z' } }),
    ok('members.grantBundleEntitlement', { already_existed: false }),
    ok('members.grantBundleEntitlement', { already_existed: false }),
    ok('members.grantBundleEntitlement', { already_existed: true }),
    ok('members.listBundleEntitlements', { items: entitlementKeys.map((bundle_slug) => ({ bundle_slug, status: 'active' })) }),
    ok('members.invite', { sent: true }),
  ]);
  const result = await createAutoCreatorClient(env, transport).grant({
    offer: 'certification', entitlementKeys, sessionId: 'cs_cert', email: 'coach@example.com',
  });
  assert.deepEqual(result, { verified: true, activationNeeded: false, emailSent: true });
  assert.deepEqual(transport.calls.slice(1, 4).map(({ body }) => body.args), entitlementKeys.map((bundle_slug) => ({
    email: 'coach@example.com', bundle_slug, notes: 'Stripe Checkout cs_cert',
  })));
  assert.deepEqual(transport.calls[4].body, { args: { email: 'coach@example.com' } });
  assert.deepEqual(transport.calls[5].body, { args: {
    email: 'coach@example.com', next: '/dashboard', invite_type: 'set_password',
  } });
  assert.equal(transport.calls.length, 6);
});

test('Certification fails closed when any level is missing from bundle read-back', async () => {
  const entitlementKeys = [
    'level-1-instructors-course',
    'level-2-instructor-course',
    'level-3-instructors-course',
  ];
  const transport = queued([
    ok('members.findByEmail', { member: { id: 'member_cert' } }),
    ok('members.grantBundleEntitlement', { already_existed: true }),
    ok('members.grantBundleEntitlement', { already_existed: true }),
    ok('members.grantBundleEntitlement', { already_existed: true }),
    ok('members.listBundleEntitlements', { items: [
      { bundle_slug: 'level-1-instructors-course', status: 'active' },
      { bundle_slug: 'level-2-instructor-course', status: 'active' },
    ] }),
  ]);

  await assert.rejects(createAutoCreatorClient(env, transport).grant({
    offer: 'certification', entitlementKeys, sessionId: 'cs_cert_partial', email: 'coach@example.com',
  }), (error) => {
    assert.ok(error instanceof AutoCreatorError);
    assert.equal(error.code, 'readback_failed');
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(transport.calls.length, 5);
});

test('bundle fulfillment creates a brand-new buyer before granting access', async () => {
  const transport = queued([
    ok('members.findByEmail', { member: null }),
    ok('members.create', { member: { id: 'member_new' } }),
    ok('members.findByEmail', { member: { id: 'member_new', last_sign_in_at: null } }),
    ok('members.grantBundleEntitlement', { already_existed: false }),
    ok('members.listBundleEntitlements', { items: [{ bundle_slug: 'guard-retention', status: 'active' }] }),
    ok('members.invite', { sent: true }),
  ]);
  const result = await createAutoCreatorClient(env, transport).grant({
    offer: 'bundle', entitlementKey: 'guard-retention', sessionId: 'cs_new', email: 'new@example.com',
  });
  assert.deepEqual(result, { verified: true, activationNeeded: true, emailSent: true });
  assert.equal(transport.calls[1].url, 'https://yfbjj.autocreator.ai/api/v1/tools/members.create');
  assert.deepEqual(transport.calls[1].body, { args: { email: 'new@example.com' } });
});

test('plan grant attaches Stripe references and proves the exact active price', async () => {
  const calls = [];
  const transport = queued([
    ok('members.setMembership', { updated: true }),
    ok('members.findByEmail', { id: 'member_2' }),
    ok('subscriptions.getActive', { subscription: { stripe_price_id: 'price_plan', status: 'active' } }),
    ok('members.checkAccess', { access: { granted: true, neverSignedIn: false } }),
    ok('members.invite', { sent: true }),
  ], calls);
  const result = await createAutoCreatorClient(env, transport).grant({
    offer: 'two_month', entitlementKey: 'price_plan', sessionId: 'cs_2', email: 'buyer@example.com',
    customerId: 'cus_1', subscriptionId: 'sub_1',
  });
  assert.deepEqual(result, { verified: true, activationNeeded: false, emailSent: true });
  assert.deepEqual(calls[0].body.args, {
    email: 'buyer@example.com', price_id: 'price_plan', status: 'active', create_if_missing: true,
    stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1',
  });
  assert.deepEqual(calls[3].body, { args: { memberId: 'member_2' } });
  assert.deepEqual(calls[4].body, { args: {
    email: 'buyer@example.com', next: '/dashboard', invite_type: 'set_password',
  } });
});

test('access is never marked verified when the login email cannot be sent', async () => {
  const transport = queued([
    ok('members.findByEmail', { member: { id: 'member_4', last_sign_in_at: null } }),
    ok('members.grantBundleEntitlement', { already_existed: false }),
    ok('members.listBundleEntitlements', { items: [{ bundle_slug: 'guard-retention', status: 'active' }] }),
    new Response('{}', { status: 500 }),
  ]);
  await assert.rejects(createAutoCreatorClient(env, transport).grant({
    offer: 'bundle', entitlementKey: 'guard-retention', sessionId: 'cs_4', email: 'buyer@example.com',
  }), (error) => {
    assert.ok(error instanceof AutoCreatorError);
    assert.equal(error.code, 'upstream_failure');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('transport, auth, rate, envelope, and read-back failures never verify a grant', async () => {
  const cases = [
    [new Response('{}', { status: 401 }), 'invalid_key', false],
    [new Response('{}', { status: 403 }), 'missing_scope', false],
    [new Response('{}', { status: 429, headers: { 'retry-after': '5' } }), 'rate_limited', true],
    [new Response('{}', { status: 500 }), 'upstream_failure', true],
    [new Response('not json', { status: 200 }), 'invalid_response', false],
    [new Response(JSON.stringify({ ok: false, tool: 'members.grantBundleEntitlement', error: 'no' }), { status: 200 }), 'tool_failure', true],
    [ok('wrong.tool', {}), 'tool_failure', false],
  ];
  for (const [http, code, retryable] of cases) {
    const client = createAutoCreatorClient(env, queued([http]));
    await assert.rejects(client.tool('members.grantBundleEntitlement', {}), (error) => {
      assert.ok(error instanceof AutoCreatorError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      return true;
    });
  }

  const readback = queued([
    ok('members.findByEmail', { member: { id: 'member_3' } }),
    ok('members.grantBundleEntitlement', { already_existed: false }),
    ok('members.listBundleEntitlements', { items: [] }),
  ]);
  await assert.rejects(createAutoCreatorClient(env, readback).grant({
    offer: 'bundle', entitlementKey: 'guard-retention', sessionId: 'cs_3', email: 'buyer@example.com',
  }), /did not prove access/);
});

test('timeout is classified retryable', async () => {
  const fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const client = createAutoCreatorClient(env, { fetch, timeoutMs: 2 });
  await assert.rejects(client.tool('members.findByEmail', {}), (error) => {
    assert.equal(error.code, 'timeout');
    assert.equal(error.retryable, true);
    return true;
  });
});
