import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarMonths, handleCheckout, handlePortal, handleWebhook } from '../src/stripe.js';

const env = {
  PREVIEW_MODE: 'false',
  STRIPE_SECRET_KEY: 'fixture_secret',
  STRIPE_PRICE_BUNDLE: 'price_bundle',
  STRIPE_PRICE_TWO_MONTH: 'price_monthly',
  STRIPE_PRODUCT_TWO_MONTH: 'prod_trial',
};

async function body(response) { return response.json(); }

test('preview defaults locked and never calls Stripe', async () => {
  let calls = 0;
  const stripe = { checkout: { sessions: { create: async () => { calls++; } } } };
  for (const PREVIEW_MODE of [undefined, 'true', 'FALSE ', 'off']) {
    const response = await handleCheckout(new Request('https://staging.test/api/checkout', { method: 'POST' }),
      { ...env, PREVIEW_MODE }, { stripe });
    assert.equal(response.status, 423);
    assert.deepEqual(await body(response), { ok: false, error: 'preview_locked' });
  }
  assert.equal(calls, 0);
});

test('checkout preserves first-party attribution in session and payment metadata', async () => {
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => { created = params; return { url: 'https://checkout.test/s' }; } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'bundle', attribution: { variant: 'b', utm_source: 'email', ignored: 'no' } }),
  });
  const response = await handleCheckout(request, env, { stripe });
  assert.equal(response.status, 200);
  assert.deepEqual(created.metadata, { variant: 'b', utm_source: 'email', offer: 'bundle', price_id: 'price_bundle' });
  assert.deepEqual(created.payment_intent_data.metadata, created.metadata);
});

test('two-month offer charges $8 once and starts recurring item after two clamped calendar months', async () => {
  assert.equal(addCalendarMonths(new Date('2027-01-31T12:00:00Z'), 1).toISOString(), '2027-02-28T12:00:00.000Z');
  assert.equal(addCalendarMonths(new Date('2028-01-31T12:00:00Z'), 1).toISOString(), '2028-02-29T12:00:00.000Z');
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => { created = params; return { url: 'x' }; } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer: 'two_month' }),
  });
  await handleCheckout(request, env, { stripe, now: () => new Date('2027-01-31T12:00:00Z') });
  assert.equal(created.line_items[0].price_data.unit_amount, 800);
  assert.equal(created.line_items[1].price, 'price_monthly');
  assert.equal(created.subscription_data.trial_end, Date.parse('2027-03-31T12:00:00Z') / 1000);
});

test('portal requires a completed server-retrieved Checkout Session', async () => {
  let portalCalls = 0;
  const stripe = {
    checkout: { sessions: { retrieve: async () => ({ status: 'open', customer: 'cus_fixture' }) } },
    billingPortal: { sessions: { create: async () => { portalCalls++; } } },
  };
  const request = new Request('https://staging.test/api/customer-portal', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: 'cs_fixture' }),
  });
  assert.equal((await handlePortal(request, env, { stripe })).status, 403);
  assert.equal(portalCalls, 0);
});

async function signature(payload, secret, timestamp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const digest = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${digest}`;
}

function database({ duplicate = false, failOrder = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { bind(...values) { calls.push({ sql, values }); return {
        first: async () => duplicate ? null : ({ status: 'processing' }),
        run: async () => {
          if (failOrder && sql.includes('INSERT INTO stripe_orders')) throw new Error('fixture database failure');
          return { success: true };
        },
      }; } };
    },
  };
}

test('webhook rejects invalid signatures before D1', async () => {
  const DB = database();
  const response = await handleWebhook(new Request('https://staging.test/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 't=1,v1=nope' }, body: '{}',
  }), { DB, STRIPE_WEBHOOK_SECRET: 'fixture_webhook_secret' }, { timestamp: 1000 });
  assert.equal(response.status, 400);
  assert.equal(DB.calls.length, 0);
});

test('webhook acknowledges duplicates and retries failed processing', async () => {
  const payload = JSON.stringify({ id: 'evt_fixture', type: 'checkout.session.completed', data: { object: {
    id: 'cs_fixture', customer: 'cus_fixture', payment_status: 'paid', metadata: { offer: 'bundle', variant: 'a' },
  } } });
  const timestamp = 2_000_000_000;
  const headers = { 'stripe-signature': await signature(payload, 'fixture_webhook_secret', timestamp) };
  const duplicateDB = database({ duplicate: true });
  const duplicate = await handleWebhook(new Request('https://staging.test/api/stripe-webhook', { method: 'POST', headers, body: payload }),
    { DB: duplicateDB, STRIPE_WEBHOOK_SECRET: 'fixture_webhook_secret' }, { timestamp: timestamp * 1000 });
  assert.deepEqual(await body(duplicate), { ok: true, duplicate: true });

  const retryDB = database({ failOrder: true });
  const failed = await handleWebhook(new Request('https://staging.test/api/stripe-webhook', { method: 'POST', headers, body: payload }),
    { DB: retryDB, STRIPE_WEBHOOK_SECRET: 'fixture_webhook_secret' }, { timestamp: timestamp * 1000 });
  assert.equal(failed.status, 500);
  assert.ok(retryDB.calls.some(({ sql }) => sql.includes("status = 'failed'")));
  assert.ok(retryDB.calls[0].sql.includes("WHERE stripe_events.status = 'failed'"));
});
