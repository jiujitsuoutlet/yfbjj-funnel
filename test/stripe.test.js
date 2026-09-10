import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFERS,
  addCalendarMonths,
  getOrderFulfillmentState,
  handleCheckout,
  handleQaProofLogin,
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
  STRIPE_PRICE_HEAD_TO_TOES: 'price_head',
  STRIPE_PRICE_HEAD_TO_TOES_BUMP: 'price_head_bump',
  STRIPE_PRICE_TWO_MONTH: 'price_monthly',
  STRIPE_PRODUCT_TWO_MONTH: 'prod_trial',
  STRIPE_PRICE_CERTIFICATION: 'price_certification',
  AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG: 'guard-retention',
  AUTOCREATOR_HEAD_TO_TOES_BUNDLE_SLUG: 'head-slug',
  AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET: 'full-monthly',
  AUTOCREATOR_CERTIFICATION_LEVEL_1_BUNDLE_SLUG: 'level-1-instructors-course',
  AUTOCREATOR_CERTIFICATION_LEVEL_2_BUNDLE_SLUG: 'level-2-instructor-course',
  AUTOCREATOR_CERTIFICATION_LEVEL_3_BUNDLE_SLUG: 'level-3-instructors-course',
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

test('all five offers require an explicit Stripe Price and AutoCreator entitlement mapping', () => {
  assert.deepEqual(OFFERS, {
    bundle: { priceVar: 'STRIPE_PRICE_BUNDLE', entitlementKeyVars: ['AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG'], mode: 'payment' },
    head_to_toes: { priceVar: 'STRIPE_PRICE_HEAD_TO_TOES', entitlementKeyVars: ['AUTOCREATOR_HEAD_TO_TOES_BUNDLE_SLUG'], mode: 'payment' },
    lifetime: { priceVar: 'STRIPE_PRICE_LIFETIME', entitlementKeyVars: ['AUTOCREATOR_LIFETIME_ENTITLEMENT_TARGET'], mode: 'payment' },
    two_month: { priceVar: 'STRIPE_PRICE_TWO_MONTH', entitlementKeyVars: ['AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET'], mode: 'subscription' },
    certification: {
      priceVar: 'STRIPE_PRICE_CERTIFICATION',
      entitlementKeyVars: [
        'AUTOCREATOR_CERTIFICATION_LEVEL_1_BUNDLE_SLUG',
        'AUTOCREATOR_CERTIFICATION_LEVEL_2_BUNDLE_SLUG',
        'AUTOCREATOR_CERTIFICATION_LEVEL_3_BUNDLE_SLUG',
      ],
      mode: 'payment',
    },
  });
  assert.deepEqual(resolveOffer({ ...env, AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG: '' }, 'bundle'), {
    ok: false,
    error: 'offer_not_configured',
    missing: ['AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG'],
  });
  assert.deepEqual(resolveOffer(env, 'certification'), {
    ok: true,
    offer: OFFERS.certification,
    priceId: 'price_certification',
    entitlementKeys: [
      'level-1-instructors-course',
      'level-2-instructor-course',
      'level-3-instructors-course',
    ],
    entitlementKey: 'level-1-instructors-course,level-2-instructor-course,level-3-instructors-course',
  });
  assert.deepEqual(resolveOffer({ ...env, AUTOCREATOR_CERTIFICATION_LEVEL_2_BUNDLE_SLUG: '' }, 'certification'), {
    ok: false,
    error: 'offer_not_configured',
    missing: ['AUTOCREATOR_CERTIFICATION_LEVEL_2_BUNDLE_SLUG'],
  });
});

test('checkout fails closed before Stripe when fulfillment is not implemented', async () => {
  let calls = 0;
  const stripe = { checkout: { sessions: { create: async () => { calls++; } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer: 'bundle' }),
  });
  const response = await handleCheckout(request, { ...env, DB: database() }, { stripe, fulfillmentImplemented: false });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { ok: false, error: 'checkout_not_ready' });
  assert.equal(calls, 0);
});

test('functional staging requires its proof secret and applies only the configured no-charge coupon', async () => {
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => {
    created = params;
    return { url: 'https://checkout.test/proof' };
  } } } };
  const proofEnv = {
    ...env,
    DB: database(),
    QA_PROOF_MODE: 'true',
    QA_PROOF_SECRET: 'proof-secret',
    QA_STRIPE_COUPON_ID: 'coupon-proof',
  };
  const requestFor = (proof, cookie = '') => new Request('https://staging.test/api/checkout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(proof ? { 'x-yfbjj-qa-proof': proof } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ offer: 'bundle' }),
  });

  const blocked = await handleCheckout(requestFor(null), proofEnv, { stripe });
  assert.equal(blocked.status, 403);
  assert.deepEqual(await body(blocked), { ok: false, error: 'qa_proof_required' });
  assert.equal(created, undefined);

  const allowed = await handleCheckout(requestFor('proof-secret'), proofEnv, { stripe });
  assert.equal(allowed.status, 200);
  assert.deepEqual(created.discounts, [{ coupon: 'coupon-proof' }]);
  assert.equal(created.metadata.qa_proof, 'true');
  assert.equal(created.payment_intent_data.metadata.qa_proof, 'true');

  const login = await handleQaProofLogin(new Request('https://staging.test/qa', {
    method: 'POST',
    headers: { origin: 'https://staging.test', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=proof-secret',
  }), proofEnv);
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/?qa=active');
  const proofCookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(proofCookie, /^yfbjj_qa=[a-f0-9]{64}$/);
  assert.equal(proofCookie.includes('proof-secret'), false);

  created = undefined;
  const cookieAllowed = await handleCheckout(requestFor(null, proofCookie), {
    ...proofEnv,
    DB: database(),
  }, { stripe });
  assert.equal(cookieAllowed.status, 200);
  assert.deepEqual(created.discounts, [{ coupon: 'coupon-proof' }]);
});

test('QA proof login stays disabled outside functional staging and rejects bad codes', async () => {
  const requestFor = (code) => new Request('https://staging.test/qa', {
    method: 'POST',
    headers: { origin: 'https://staging.test', 'content-type': 'application/x-www-form-urlencoded' },
    body: `code=${encodeURIComponent(code)}`,
  });
  const disabled = await handleQaProofLogin(requestFor('proof-secret'), env);
  assert.equal(disabled.status, 404);

  const rejected = await handleQaProofLogin(requestFor('wrong-code'), {
    ...env,
    QA_PROOF_MODE: 'true',
    QA_PROOF_SECRET: 'proof-secret',
    QA_STRIPE_COUPON_ID: 'coupon-proof',
  });
  assert.equal(rejected.status, 303);
  assert.equal(rejected.headers.get('location'), '/qa?error=invalid');
  assert.equal(rejected.headers.get('set-cookie'), null);
});

test('checkout preserves first-party attribution in session and payment metadata', async () => {
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => { created = params; return { url: 'https://checkout.test/s' }; } } } };
  const DB = database();
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'bundle', attribution: { variant: 'b', utm_source: 'email', ignored: 'no' } }),
  });
  const response = await handleCheckout(request, { ...env, DB }, {
    stripe,
    fulfillmentImplemented: true,
  });
  assert.equal(response.status, 200);
  assert.equal(created.metadata.variant, 'b');
  assert.equal(created.metadata.utm_source, 'email');
  assert.equal(created.metadata.offer, 'bundle');
  assert.equal(created.metadata.price_id, 'price_bundle');
  assert.equal(created.metadata.entitlement_key, 'guard-retention');
  assert.match(created.metadata.flow_hash, /^[a-f0-9]{64}$/);
  assert.equal(created.customer_creation, 'always');
  assert.deepEqual(created.payment_intent_data, {
    metadata: created.metadata,
    setup_future_usage: 'off_session',
  });
  assert.match(response.headers.get('set-cookie'), /^yfbjj_flow=/);
  const flowInsert = DB.calls.findIndex(({ sql }) => sql.includes('INSERT INTO checkout_flows'));
  const rootUpdate = DB.calls.findIndex(({ sql }) => sql.includes('UPDATE checkout_flows SET root_session_id'));
  assert.ok(flowInsert >= 0 && rootUpdate > flowInsert);
  assert.equal(DB.calls.some(({ sql }) => sql.includes('INSERT INTO stripe_orders')), false);
});

test('checkout adds the server-owned Head to Toes order bump to the same payment', async () => {
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => {
    created = params;
    return { id: 'cs_bump', url: 'https://checkout.test/bump' };
  } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      offer: 'bundle', order_bump: 'head_to_toes',
      price_id: 'price_attacker', entitlement_key: 'attacker',
    }),
  });
  const response = await handleCheckout(request, { ...env, DB: database() }, { stripe });
  assert.equal(response.status, 200);
  assert.deepEqual(created.line_items, [
    { price: 'price_bundle', quantity: 1 },
    { price: 'price_head_bump', quantity: 1 },
  ]);
  assert.equal(created.metadata.price_id, 'price_bundle');
  assert.equal(created.metadata.entitlement_key, 'guard-retention');
  assert.equal(created.metadata.order_bump, 'head_to_toes');
  assert.equal(created.metadata.order_bump_price_id, 'price_head_bump');
  assert.equal(created.metadata.order_bump_entitlement_key, 'head-slug');
  assert.deepEqual(created.payment_intent_data, {
    metadata: created.metadata,
    setup_future_usage: 'off_session',
  });
});

test('checkout ignores unsupported browser-supplied order bumps', async () => {
  let created;
  const stripe = { checkout: { sessions: { create: async (params) => {
    created = params;
    return { id: 'cs_plain', url: 'https://checkout.test/plain' };
  } } } };
  const request = new Request('https://staging.test/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offer: 'bundle', order_bump: 'certification' }),
  });
  assert.equal((await handleCheckout(request, { ...env, DB: database() }, { stripe })).status, 200);
  assert.deepEqual(created.line_items, [{ price: 'price_bundle', quantity: 1 }]);
  assert.equal(created.metadata.order_bump, undefined);
});

test('initial checkout rejects every non-Guard offer and calendar months clamp', async () => {
  assert.equal(addCalendarMonths(new Date('2027-01-31T12:00:00Z'), 1).toISOString(), '2027-02-28T12:00:00.000Z');
  assert.equal(addCalendarMonths(new Date('2028-01-31T12:00:00Z'), 1).toISOString(), '2028-02-29T12:00:00.000Z');
  for (const offer of ['head_to_toes', 'lifetime', 'two_month', 'certification']) {
    const request = new Request('https://staging.test/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer }),
    });
    const result = await handleCheckout(request, { ...env, DB: database() }, { fulfillmentImplemented: true });
    assert.equal(result.status, 400);
    assert.deepEqual(await body(result), { ok: false, error: 'initial_offer_only' });
  }
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
  ), { valid: true, payment: 'paid', fulfillment: 'granted', access: 'active' });
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
  orderStatus, fulfillmentStatus, accessState = 'active', flowRow } = {}) {
  const calls = [];
  const state = {
    eventStatus,
    eventUpdatedAt,
    outboxStatus,
    outboxLeaseExpires,
    orderStatus,
    fulfillmentStatus,
    accessState,
    flowRow: flowRow || { root_session_id: 'cs_fixture', customer_id: 'cus_fixture', current_offer: null, status: 'front_checkout', pending_session_id: 'cs_fixture' },
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
            if (sql.includes('SELECT status, fulfillment_status, access_state FROM stripe_orders')) {
              return state.orderStatus ? { status: state.orderStatus, fulfillment_status: state.fulfillmentStatus, access_state: state.accessState } : null;
            }
            if (sql.includes('SELECT root_session_id, customer_id, current_offer, status, pending_session_id')) {
              return state.flowRow;
            }
            if (sql.includes('UPDATE checkout_flows SET customer_id')) return { flow_hash: 'flow_fixture' };
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
              state.accessState = values[2];
            } else if (sql.includes("status = 'paid_stale'")) {
              state.orderStatus = 'paid_stale';
              state.fulfillmentStatus = 'failed';
              state.stale = true;
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
    metadata: { offer: 'bundle', price_id: 'price_bundle', entitlement_key: 'guard-retention', flow_hash: 'flow_fixture', variant: 'a' },
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

test('authenticated unsupported events are acknowledged before readiness and D1', async () => {
  const timestamp = 2_000_000_000;
  const DB = database();
  const event = { id: 'evt_invoice_paid', type: 'invoice.paid', data: { object: { id: 'in_fixture' } } };
  const response = await handleWebhook(await webhookRequest(event, timestamp), {
    ...env,
    DB,
    STRIPE_WEBHOOK_READY: 'false',
    AUTOCREATOR_FULFILLMENT_READY: 'false',
  }, { timestamp: timestamp * 1000 });
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { ok: true, ignored: true });
  assert.equal(DB.calls.length, 0);
});

test('functional staging acknowledges live production events without writing them to staging D1', async () => {
  let prepared = false;
  const response = await handleWebhook(new Request('https://staging.test/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 'fixture' }, body: '{}',
  }), {
    ...env,
    QA_PROOF_MODE: 'true',
    DB: { prepare: () => { prepared = true; throw new Error('should not write'); } },
  }, {
    stripe: { webhooks: { constructEventAsync: async () => ({
      id: 'evt_production',
      type: 'checkout.session.completed',
      data: { object: { metadata: { offer: 'bundle' } } },
    }) } },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { ok: true, ignored: true, reason: 'non_qa_event' });
  assert.equal(prepared, false);
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

test('paid order bump grants both products and skips the duplicate Head to Toes offer', async () => {
  const timestamp = 2_000_000_000;
  const DB = database();
  const event = checkoutEvent('checkout.session.completed');
  event.data.object.amount_total = 2300;
  Object.assign(event.data.object.metadata, {
    order_bump: 'head_to_toes',
    order_bump_price_id: 'price_head_bump',
    order_bump_entitlement_key: 'head-slug',
  });
  let grant;
  const result = await handleWebhook(await webhookRequest(event, timestamp), { ...env, DB }, {
    timestamp: timestamp * 1000,
    autocreator: { grant: async (input) => { grant = input; } },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(grant.entitlementKeys, ['guard-retention', 'head-slug']);
  assert.equal(grant.operationKey, 'grant:cs_fixture:guard-retention,head-slug');
  const order = DB.calls.find(({ sql }) => sql.includes('INSERT INTO stripe_orders'));
  assert.equal(order.values[6], 'guard-retention,head-slug');
  assert.deepEqual(JSON.parse(order.values[10]), {
    variant: 'a', order_bump: 'head_to_toes', offer: 'bundle', price_id: 'price_bundle',
    entitlement_key: 'guard-retention', flow_hash: 'flow_fixture',
  });
  const transition = DB.calls.find(({ sql }) => sql.includes('UPDATE checkout_flows SET customer_id'));
  assert.equal(transition.values[4], 'lifetime');
});

test('tampered order bump metadata fails before fulfillment', async () => {
  const timestamp = 2_000_000_000;
  const DB = database();
  const event = checkoutEvent('checkout.session.completed');
  Object.assign(event.data.object.metadata, {
    order_bump: 'head_to_toes',
    order_bump_price_id: 'price_attacker',
    order_bump_entitlement_key: 'head-slug',
  });
  let grants = 0;
  const result = await handleWebhook(await webhookRequest(event, timestamp), { ...env, DB }, {
    timestamp: timestamp * 1000,
    autocreator: { grant: async () => { grants++; } },
  });
  assert.equal(result.status, 500);
  assert.equal(grants, 0);
  assert.equal(DB.calls.some(({ sql }) => sql.includes('INSERT INTO stripe_orders')), false);
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

test('late child completion is acknowledged without granting a stale offer', async () => {
  const timestamp = 2_000_000_000;
  const DB = database({ flowRow: {
    root_session_id: 'cs_root', customer_id: 'cus_fixture', current_offer: 'lifetime',
    status: 'offer_ready', pending_session_id: null,
  } });
  const event = checkoutEvent('checkout.session.completed');
  event.data.object.id = 'cs_late_head';
  event.data.object.metadata = {
    offer: 'head_to_toes', price_id: 'price_head', entitlement_key: 'head-slug',
    flow_hash: 'flow_fixture', root_session_id: 'cs_root', parent_session_id: 'cs_root',
  };
  let grants = 0;
  const result = await handleWebhook(await webhookRequest(event, timestamp), { ...env, DB }, {
    timestamp: timestamp * 1000, fulfillmentImplemented: true,
    autocreator: { grant: async () => { grants++; } },
  });
  assert.equal(result.status, 200);
  assert.equal(grants, 0);
  assert.equal(DB.state.stale, true);
  assert.equal(DB.state.eventStatus, 'processed');
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
