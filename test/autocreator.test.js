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
    ok('members.grantBundleEntitlement', { already_existed: true }),
    ok('members.listBundleEntitlements', { items: [{ bundle_slug: 'guard-retention', status: 'active' }] }),
    ok('members.findByEmail', { member: { id: 'member_1' } }),
    ok('members.checkAccess', { neverSignedIn: true }),
  ]);
  const client = createAutoCreatorClient(env, transport);
  const result = await client.grant({
    offer: 'bundle', entitlementKey: 'guard-retention', sessionId: 'cs_1', email: 'buyer@example.com',
  });
  assert.deepEqual(result, { verified: true, activationNeeded: true });
  assert.equal(transport.calls[0].url, 'https://yfbjj.autocreator.ai/api/v1/tools/members.grantBundleEntitlement');
  assert.equal(transport.calls[0].init.headers.Authorization, 'Bearer fixture_key');
  assert.deepEqual(transport.calls[0].body, { args: {
    email: 'buyer@example.com', bundle_slug: 'guard-retention', source: 'stripe_purchase', notes: 'Stripe Checkout cs_1',
  } });
});

test('plan grant attaches Stripe references and proves the exact active price', async () => {
  const calls = [];
  const transport = queued([
    ok('members.setMembership', { updated: true }),
    ok('members.findByEmail', { id: 'member_2' }),
    ok('subscriptions.getActive', { subscriptions: [{ price_id: 'price_plan', status: 'active' }] }),
    ok('members.checkAccess', { neverSignedIn: false }),
  ], calls);
  const result = await createAutoCreatorClient(env, transport).grant({
    offer: 'two_month', entitlementKey: 'price_plan', sessionId: 'cs_2', email: 'buyer@example.com',
    customerId: 'cus_1', subscriptionId: 'sub_1',
  });
  assert.deepEqual(result, { verified: true, activationNeeded: false });
  assert.deepEqual(calls[0].body.args, {
    email: 'buyer@example.com', price_id: 'price_plan', status: 'active', create_if_missing: true,
    stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1',
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
