import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFERS,
  addCalendarMonths,
  getOrderFulfillmentState,
  handleCheckout,
  handlePortal,
  handleWebhook,
  processEntitlementOperation,
  resolveOffer,
} from '../src/stripe.js';

const env = {
  PREVIEW_MODE: 'false',
  STRIPE_SECRET_KEY: 'fixture_secret',
  STRIPE_WEBHOOK_SECRET: 'fixture_webhook_secret',
  AUTOCREATOR_API_KEY: 'fixture_autocreator_secret',
  STRIPE_WEBHOOK_READY: 'true',
  AUTOCREATOR_FULFILLMENT_READY: 'true',
  STRIPE_PRICE_BUNDLE: 'price_bundle',
  STRIPE_PRICE_TWO_MONTH: 'price_monthly',
  STRIPE_PRODUCT_TWO_MONTH: 'prod_trial',
  AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG: 'guard-retention',
  AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET: 'full-monthly',
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

test('all four offers require an explicit Stripe Price and AutoCreator entitlement mapping', () => {
  assert.deepEqual(OFFERS, {
    bundle: { priceVar: 'STRIPE_PRICE_BUNDLE', entitlementKeyVar: 'AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG', mode: 'payment' },
    head_to_toes: { priceVar: 'STRIPE_PRICE_HEAD_TO_TOES', entitlementKeyVar: 'AUTOCREATOR_HEAD_TO_TOES_BUNDLE_SLUG', mode: 'payment' },
    lifetime: { priceVar: 'STRIPE_PRICE_LIFETIME', entitlementKeyVar: 'AUTOCREATOR_LIFETIME_ENTITLEMENT_TARGET', mode: 'payment' },
    two_month: { priceVar: 'STRIPE_PRICE_TWO_MONTH', entitlementKeyVar: 'AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET', mode: 'subscription' },
  });
  assert.deepEqual(resolveOffer({ ...env, AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG: '' }, 'bundle'), {
    ok: false,
    error: 'offer_not_configured',
    missing: ['AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG'],
  });
});

test('checkout fails closed before Stripe when fulfillment is not implemented', async () => {
  let calls = 0;
  const stripe = { checkout: { sessions: { create: async () => { calls++; } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer: 'bundle' }),
  });
  const response = await handleCheckout(request, { ...env, DB: database() }, { stripe });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { ok: false, error: 'checkout_not_ready' });
  assert.equal(calls, 0);
});

test('checkout preserves first-party attribution in session and payment metadata', async () => {
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => { created = params; return { url: 'https://checkout.test/s' }; } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'bundle', attribution: { variant: 'b', utm_source: 'email', ignored: 'no' } }),
  });
  const response = await handleCheckout(request, { ...env, DB: database() }, {
    stripe,
    fulfillmentImplemented: true,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(created.metadata, {
    variant: 'b',
    utm_source: 'email',
    offer: 'bundle',
    price_id: 'price_bundle',
    entitlement_key: 'guard-retention',
  });
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
  await handleCheckout(request, { ...env, DB: database() }, {
    stripe,
    now: () => new Date('2027-01-31T12:00:00Z'),
    fulfillmentImplemented: true,
  });
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

test('portal preserves the verified Checkout Session on its return URL', async () => {
  let created;
  const stripe = {
    checkout: { sessions: { retrieve: async () => ({ status: 'complete', customer: 'cus_fixture' }) } },
    billingPortal: { sessions: { create: async (params) => { created = params; return { url: 'https://portal.test' }; } } },
  };
  const request = new Request('https://staging.test/api/customer-portal', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: 'cs_fixture' }),
  });
  assert.equal((await handlePortal(request, env, { stripe })).status, 200);
  assert.equal(created.return_url, 'https://staging.test/thanks?session_id=cs_fixture');
});

test('thanks state comes from the durable D1 fulfillment record', async () => {
  const DB = database({ orderStatus: 'paid', fulfillmentStatus: 'granted' });
  assert.deepEqual(await getOrderFulfillmentState(
    new Request('https://staging.test/thanks?session_id=cs_fixture'), { DB }
  ), { valid: true, payment: 'paid', fulfillment: 'granted' });
  assert.deepEqual(await getOrderFulfillmentState(
    new Request('https://staging.test/thanks'), { DB }
  ), { valid: false });
});

async function signature(payload, secret, timestamp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const digest = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${digest}`;
}

function database({ eventStatus, eventUpdatedAt, outboxStatus, outboxLeaseExpires, failOrder = false,
  orderStatus, fulfillmentStatus } = {}) {
  const calls = [];
  const state = {
    eventStatus,
    eventUpdatedAt,
    outboxStatus,
    outboxLeaseExpires,
    orderStatus,
    fulfillmentStatus,
  };
  const DB = {
    calls,
    state,
    prepare(sql) {
      return { bind(...values) {
        calls.push({ sql, values });
        return {
          first: async () => {
            if (sql.includes('FROM fulfillment_readiness')) return { schema_version: 1 };
            if (sql.includes('INSERT INTO stripe_events')) {
              const stale = state.eventStatus === 'processing' && state.eventUpdatedAt <= values[3];
              if (!state.eventStatus || state.eventStatus === 'failed' || stale) {
                state.eventStatus = 'processing';
                state.eventUpdatedAt = values[2];
                return { status: 'processing' };
              }
              return null;
            }
            if (sql.includes('SELECT status FROM stripe_events')) return state.eventStatus ? { status: state.eventStatus } : null;
            if (sql.includes("UPDATE entitlement_outbox SET status = 'processing'")) {
              const stale = state.outboxStatus === 'processing' && state.outboxLeaseExpires <= values[2];
              if (['pending', 'failed'].includes(state.outboxStatus) || stale) {
                state.outboxStatus = 'processing';
                state.outboxLeaseExpires = values[1];
                return { status: 'processing' };
              }
              return null;
            }
            if (sql.includes('SELECT status FROM entitlement_outbox')) return state.outboxStatus ? { status: state.outboxStatus } : null;
            if (sql.includes('SELECT status, fulfillment_status FROM stripe_orders')) {
              return state.orderStatus ? { status: state.orderStatus, fulfillment_status: state.fulfillmentStatus } : null;
            }
            return null;
          },
          run: async () => {
            if (failOrder && sql.includes('INSERT INTO stripe_orders')) throw new Error('fixture database failure');
            if (sql.includes('INSERT INTO stripe_orders')) {
              state.orderStatus = values[9];
              state.fulfillmentStatus ||= 'pending';
            } else if (sql.includes('INSERT INTO entitlement_outbox')) {
              state.outboxStatus ||= 'pending';
            } else if (sql.includes("stripe_events SET status = 'processed'")) {
              state.eventStatus = 'processed';
            } else if (sql.includes("stripe_events SET status = 'failed'")) {
              state.eventStatus = 'failed';
            } else if (sql.includes("entitlement_outbox SET status = 'succeeded'")) {
              state.outboxStatus = 'succeeded';
            } else if (sql.includes("entitlement_outbox SET status = 'failed'")) {
              state.outboxStatus = 'failed';
            } else if (sql.includes("fulfillment_status = 'granted'")) {
              state.fulfillmentStatus = 'granted';
            } else if (sql.includes("fulfillment_status = 'failed'")) {
              state.fulfillmentStatus = 'failed';
            }
            return { success: true };
          },
        };
      } };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return DB;
}

function checkoutEvent(type, paymentStatus = 'paid') {
  return { id: `evt_${type.replaceAll('.', '_')}`, type, data: { object: {
    id: 'cs_fixture', customer: 'cus_fixture', payment_status: paymentStatus, amount_total: 1400,
    customer_details: { email: 'buyer@example.com' },
    metadata: { offer: 'bundle', price_id: 'price_bundle', entitlement_key: 'guard-retention', variant: 'a' },
  } } };
}

async function webhookRequest(event, timestamp) {
  const payload = JSON.stringify(event);
  const valid = await signature(payload, 'fixture_webhook_secret', timestamp);
  return new Request('https://staging.test/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': `${valid},v1=rotated-secret-does-not-match` }, body: payload,
  });
}

test('webhook rejects invalid signatures before D1', async () => {
  const DB = database();
  const response = await handleWebhook(new Request('https://staging.test/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 't=1,v1=nope' }, body: '{}',
  }), { ...env, DB, STRIPE_WEBHOOK_SECRET: 'fixture_webhook_secret' }, { timestamp: 1000 });
  assert.equal(response.status, 400);
  assert.equal(DB.calls.length, 0);
});

test('unpaid completion stays pending and async failure never grants access', async () => {
  const timestamp = 2_000_000_000;
  let grants = 0;
  const pendingDB = database();
  const pending = await handleWebhook(await webhookRequest(checkoutEvent('checkout.session.completed', 'unpaid'), timestamp),
    { ...env, DB: pendingDB }, {
      timestamp: timestamp * 1000, fulfillmentImplemented: true,
      autocreator: { grant: async () => { grants++; } },
    });
  assert.equal(pending.status, 200);
  assert.equal(pendingDB.state.orderStatus, 'pending');
  assert.equal(grants, 0);

  const failedDB = database();
  const failed = await handleWebhook(await webhookRequest(checkoutEvent('checkout.session.async_payment_failed', 'unpaid'), timestamp),
    { ...env, DB: failedDB }, {
      timestamp: timestamp * 1000, fulfillmentImplemented: true,
      autocreator: { grant: async () => { grants++; } },
    });
  assert.equal(failed.status, 200);
  assert.equal(failedDB.state.orderStatus, 'failed');
  assert.equal(grants, 0);
});

test('paid completion grants once and records durable fulfillment', async () => {
  const timestamp = 2_000_000_000;
  const DB = database();
  const keys = [];
  const result = await handleWebhook(await webhookRequest(checkoutEvent('checkout.session.completed'), timestamp),
    { ...env, DB }, {
      timestamp: timestamp * 1000, fulfillmentImplemented: true,
      autocreator: { grant: async ({ operationKey }) => { keys.push(operationKey); } },
    });
  assert.equal(result.status, 200);
  assert.deepEqual(keys, ['grant:cs_fixture:guard-retention']);
  assert.equal(DB.state.orderStatus, 'paid');
  assert.equal(DB.state.fulfillmentStatus, 'granted');
  assert.equal(DB.state.eventStatus, 'processed');
});

test('fresh event claims return retryable 503 while stale processing is reclaimed', async () => {
  const timestamp = 2_000_000_000;
  const freshDB = database({ eventStatus: 'processing', eventUpdatedAt: '2033-05-18T03:33:10.000Z' });
  const fresh = await handleWebhook(await webhookRequest(checkoutEvent('checkout.session.completed'), timestamp),
    { ...env, DB: freshDB }, {
      timestamp: timestamp * 1000, now: () => new Date('2033-05-18T03:33:20.000Z'), fulfillmentImplemented: true,
      autocreator: { grant: async () => {} },
    });
  assert.equal(fresh.status, 503);
  assert.deepEqual(await body(fresh), { ok: false, error: 'event_in_progress' });

  const staleDB = database({
    eventStatus: 'processing', eventUpdatedAt: '2033-05-18T03:20:00.000Z',
    outboxStatus: 'processing', outboxLeaseExpires: '2033-05-18T03:20:00.000Z',
  });
  const keys = [];
  const stale = await handleWebhook(await webhookRequest(checkoutEvent('checkout.session.completed'), timestamp),
    { ...env, DB: staleDB }, {
      timestamp: timestamp * 1000, now: () => new Date('2033-05-18T03:33:20.000Z'), fulfillmentImplemented: true,
      autocreator: { grant: async ({ operationKey }) => { keys.push(operationKey); } },
    });
  assert.equal(stale.status, 200);
  assert.deepEqual(keys, ['grant:cs_fixture:guard-retention']);
  assert.equal(staleDB.state.eventStatus, 'processed');
});

test('AutoCreator retries reuse one stable outbox operation key', async () => {
  const DB = database({ orderStatus: 'paid', fulfillmentStatus: 'pending' });
  const session = checkoutEvent('checkout.session.completed').data.object;
  const mapping = resolveOffer(env, 'bundle');
  const keys = [];
  await assert.rejects(processEntitlementOperation({ DB }, session, mapping, {
    now: () => new Date('2033-05-18T03:33:20.000Z'),
    autocreator: { grant: async ({ operationKey }) => { keys.push(operationKey); throw new Error('network'); } },
  }));
  await processEntitlementOperation({ DB }, session, mapping, {
    now: () => new Date('2033-05-18T03:34:20.000Z'),
    autocreator: { grant: async ({ operationKey }) => { keys.push(operationKey); } },
  });
  assert.deepEqual(keys, ['grant:cs_fixture:guard-retention', 'grant:cs_fixture:guard-retention']);
  assert.equal(DB.state.outboxStatus, 'succeeded');
  assert.equal(DB.state.fulfillmentStatus, 'granted');
});
