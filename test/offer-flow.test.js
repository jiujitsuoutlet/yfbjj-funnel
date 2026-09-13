import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { handleOfferCheckout, handleOfferSkip, getOrderFulfillmentState, handleWebhook } from '../src/stripe.js';

const token = 'opaque-fixture-token';
const flowHash = await (async () => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
})();

const baseEnv = {
  PREVIEW_MODE: 'false', STRIPE_SECRET_KEY: 'fixture', STRIPE_WEBHOOK_SECRET: 'fixture',
  AUTOCREATOR_API_KEY: 'fixture', STRIPE_WEBHOOK_READY: 'true', AUTOCREATOR_FULFILLMENT_READY: 'true',
  STRIPE_PRICE_HEAD_TO_TOES: 'price_head', AUTOCREATOR_HEAD_TO_TOES_BUNDLE_SLUG: 'head-slug',
  STRIPE_PRICE_LIFETIME: 'price_lifetime', AUTOCREATOR_LIFETIME_ENTITLEMENT_TARGET: 'price_plan_lifetime',
  STRIPE_PRICE_TWO_MONTH: 'price_monthly', AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET: 'price_plan_monthly',
  STRIPE_PRODUCT_TWO_MONTH: 'prod_trial',
  STRIPE_PRICE_CERTIFICATION: 'price_certification',
  AUTOCREATOR_CERTIFICATION_LEVEL_1_BUNDLE_SLUG: 'level-1-instructors-course',
  AUTOCREATOR_CERTIFICATION_LEVEL_2_BUNDLE_SLUG: 'level-2-instructor-course',
  AUTOCREATOR_CERTIFICATION_LEVEL_3_BUNDLE_SLUG: 'level-3-instructors-course',
};

function flowDatabase(overrides = {}) {
  const state = {
    status: 'offer_ready', current_offer: 'head_to_toes', pending_session_id: null,
    pending_checkout_url: null, authorized_session_id: 'cs_parent', two_month_trial_end: null,
    outboxStatuses: new Map(), orders: new Map(),
    ...overrides,
  };
  return {
    state,
    prepare(sql) {
      return { bind(...values) { return {
        first: async () => {
          if (sql.includes('FROM checkout_flows WHERE flow_hash')) {
            if (state.expired) return null;
            return {
              flow_hash: flowHash, root_session_id: 'cs_root', customer_id: 'cus_1', email: 'buyer@example.com',
              current_offer: state.current_offer, status: state.status,
              authorized_session_id: state.authorized_session_id, pending_session_id: state.pending_session_id,
              pending_checkout_url: state.pending_checkout_url, attribution: '{"variant":"b","utm_source":"email"}',
              expires_at: '2099-01-01T00:00:00.000Z', two_month_trial_end: state.two_month_trial_end, version: 1,
            };
          }
          if (sql.includes('FROM stripe_orders WHERE session_id')) {
            const stored = state.orders.get(values[0]);
            if (stored) return stored;
            if (values[0] !== 'cs_parent') return null;
            return {
              status: 'paid', fulfillment_status: state.fulfillment || 'granted', access_state: 'active',
              flow_hash: flowHash, customer_id: 'cus_1', email: 'buyer@example.com',
            };
          }
          if (sql.includes('FROM fulfillment_readiness')) return { schema_version: 1 };
          if (sql.includes("UPDATE entitlement_outbox SET status = 'processing'")) {
            const status = state.outboxStatuses.get(values[0]);
            if (!status || ['pending', 'failed'].includes(status)) {
              state.outboxStatuses.set(values[0], 'processing');
              return { status: 'processing' };
            }
            return null;
          }
          if (sql.includes('SELECT status FROM entitlement_outbox')) {
            const status = state.outboxStatuses.get(values[0]);
            return status ? { status } : null;
          }
          if (sql.includes("UPDATE checkout_flows SET status = 'checkout_pending'")) {
            if (sql.includes("AND status = 'offer_ready'")) {
              if (state.status !== 'offer_ready') return null;
            } else {
              const marker = sql.includes('pending_session_id = ?7') ? values[6] : values[5];
              if (state.status !== 'checkout_pending' || state.pending_session_id !== marker) return null;
              if (state.failRecordOnce) { state.failRecordOnce = false; throw new Error('database_unavailable_after_charge'); }
            }
            state.status = 'checkout_pending'; state.pending_session_id = values[1];
            if (sql.includes('pending_checkout_url = ?3')) state.pending_checkout_url = values[2];
            if (sql.includes('two_month_trial_end = ?3')) state.two_month_trial_end = values[2];
            return { flow_hash: flowHash };
          }
          if (sql.includes('UPDATE checkout_flows SET authorized_session_id')) {
            if (!['offer_ready', 'checkout_pending'].includes(state.status)) return null;
            state.authorized_session_id = values[1]; state.current_offer = values[2]; state.status = values[3];
            state.pending_session_id = null; state.pending_checkout_url = null;
            return { flow_hash: flowHash };
          }
          if (sql.includes('UPDATE checkout_flows SET current_offer')) {
            if (!['offer_ready', 'checkout_pending'].includes(state.status)) return null;
            state.current_offer = values[1]; state.status = values[2]; state.two_month_trial_end = values[3];
            state.pending_session_id = null; state.pending_checkout_url = null;
            return { flow_hash: flowHash };
          }
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT INTO stripe_orders')) {
            if (state.failOrderOnce) { state.failOrderOnce = false; throw new Error('interrupted_before_order_insert'); }
            state.orders.set(values[0], {
              session_id: values[0], customer_id: values[1], payment_intent_id: values[2],
              subscription_id: values[3], offer: values[4], amount_cents: values[7], email: values[8],
              status: values[9], fulfillment_status: 'pending', access_state: 'pending',
              metadata: values[10], flow_hash: values[13],
            });
          }
          if (sql.includes('INSERT INTO entitlement_outbox') && !state.outboxStatuses.has(values[0])) {
            state.outboxStatuses.set(values[0], 'pending');
          }
          if (sql.includes("entitlement_outbox SET status = 'succeeded'")) {
            state.outboxStatuses.set(values[0], 'succeeded');
          }
          if (sql.includes("entitlement_outbox SET status = 'failed'")) {
            state.outboxStatuses.set(values[0], 'failed');
          }
          if (sql.includes("stripe_orders SET fulfillment_status = 'granted'")) {
            const order = state.orders.get(values[0]);
            if (order) {
              order.fulfillment_status = 'granted';
              order.access_state = values[2];
            }
          }
          return { success: true };
        },
      }; } };
    },
  };
}

function request(path, body = {}, sourceSessionId = 'cs_parent') {
  return new Request(`https://funnel.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://funnel.test', cookie: `yfbjj_flow=${token}` },
    body: JSON.stringify({ source_session_id: sourceSessionId, ...body }),
  });
}

function stripe(created) {
  return {
    checkout: { sessions: {
      retrieve: async (id) => id === 'cs_root'
        ? { id, status: 'complete', payment_status: 'paid', customer: 'cus_1', payment_intent: 'pi_root' }
        : { id, status: 'complete', payment_status: 'paid', customer: 'cus_1' },
      create: async (params, options) => {
        created.push({ kind: 'checkout', params, options });
        return { id: 'cs_child', url: 'https://checkout.test/child' };
      },
    } },
    prices: { retrieve: async (id) => ({ id, active: true, type: 'one_time', unit_amount: id === 'price_certification' ? 29700 : 2900, currency: 'usd' }) },
    paymentIntents: {
      retrieve: async (id) => {
        if (id === 'pi_root') return { id, status: 'succeeded', customer: 'cus_1', payment_method: 'pm_saved', setup_future_usage: 'off_session' };
        const record = created.find((item) => item.kind === 'payment_intent');
        return { id, status: 'succeeded', customer: 'cus_1', amount: record && record.params.amount,
          amount_received: record && record.params.amount, metadata: record && record.params.metadata };
      },
      create: async (params, options) => {
        created.push({ kind: 'payment_intent', params, options });
        return { id: 'pi_child', status: 'succeeded', customer: 'cus_1', amount: params.amount, amount_received: params.amount };
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        const record = created.find((item) => item.kind === 'subscription');
        return { id, status: 'trialing', customer: 'cus_1', trial_end: 1800000000,
          metadata: record && record.params.metadata,
          latest_invoice: { status: 'paid', amount_paid: 800, payment_intent: { id: 'pi_invoice' } } };
      },
      create: async (params, options) => {
        created.push({ kind: 'subscription', params, options });
        return {
          id: 'sub_child', status: 'trialing', customer: 'cus_1', trial_end: 1800000000,
          latest_invoice: { status: 'paid', amount_paid: 800, payment_intent: { id: 'pi_invoice' } },
        };
      },
    },
  };
}

test('offer mutations reject missing flow cookie and cross-origin requests', async () => {
  const DB = flowDatabase();
  const noCookie = new Request('https://funnel.test/api/offer-checkout', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://funnel.test' },
    body: JSON.stringify({ source_session_id: 'cs_parent' }),
  });
  assert.equal((await handleOfferCheckout(noCookie, { ...baseEnv, DB }, { stripe: stripe([]), fulfillmentImplemented: true })).status, 401);
  const badOrigin = request('/api/offer-checkout');
  badOrigin.headers.set('origin', 'https://attacker.test');
  assert.equal((await handleOfferCheckout(badOrigin, { ...baseEnv, DB }, { stripe: stripe([]), fulfillmentImplemented: true })).status, 403);
});

test('server derives the sole allowed child offer and charges the saved card once', async () => {
  const DB = flowDatabase();
  const created = [];
  const deps = {
    stripe: stripe(created), fulfillmentImplemented: true,
    autocreator: { grant: async () => ({}) },
  };
  const first = await handleOfferCheckout(request('/api/offer-checkout', {
    offer: 'lifetime', price_id: 'price_attacker', entitlement_key: 'attacker',
  }), { ...baseEnv, DB }, deps);
  assert.equal(first.status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, 'payment_intent');
  assert.equal(created[0].params.amount, 2900);
  assert.equal(created[0].params.customer, 'cus_1');
  assert.equal(created[0].params.payment_method, 'pm_saved');
  assert.equal(created[0].params.confirm, true);
  assert.equal(created[0].params.off_session, true);
  assert.equal(created[0].params.error_on_requires_action, true);
  assert.equal(created[0].params.metadata.root_session_id, 'cs_root');
  assert.equal(created[0].params.metadata.parent_session_id, 'cs_parent');
  assert.equal(created[0].params.metadata.variant, 'b');
  assert.equal(created[0].options.idempotencyKey, `offer:${flowHash}:head_to_toes:v1`);
  assert.equal((await first.json()).one_click, true);
  assert.equal(DB.state.current_offer, 'lifetime');
  assert.equal(created.length, 1);
});

test('a live pending Checkout cannot be declined and ready declines follow the approved order', async () => {
  const DB = flowDatabase({ status: 'checkout_pending', pending_session_id: 'cs_abandoned', pending_checkout_url: 'https://checkout.test/abandoned' });
  const result = await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB }, { stripe: stripe([]) });
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { ok: false, error: 'checkout_still_open' });
  assert.equal(DB.state.current_offer, 'head_to_toes');
  assert.equal(DB.state.status, 'checkout_pending');

  const ready = flowDatabase();
  const skipped = await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB: ready }, { stripe: stripe([]) });
  assert.equal(skipped.status, 200);
  assert.equal(ready.state.current_offer, 'lifetime');
  assert.equal((await skipped.json()).url, '/offer?session_id=cs_parent');

  const lifetime = flowDatabase({ current_offer: 'lifetime' });
  await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB: lifetime }, { stripe: stripe([]), now: () => new Date('2027-01-31T12:00:00Z') });
  assert.equal(lifetime.state.current_offer, 'two_month');
  assert.equal(lifetime.state.two_month_trial_end, null);

  const twoMonth = flowDatabase({ current_offer: 'two_month' });
  await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB: twoMonth }, { stripe: stripe([]) });
  assert.equal(twoMonth.state.current_offer, 'certification');
  assert.equal(twoMonth.state.status, 'offer_ready');

  const certification = flowDatabase({ current_offer: 'certification' });
  const finished = await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB: certification }, { stripe: stripe([]) });
  assert.equal(certification.state.current_offer, null);
  assert.equal(certification.state.status, 'complete');
  assert.equal((await finished.json()).url, '/thanks?session_id=cs_parent');
});

test('monthly downsell charges $8 now and starts $19.99 billing after a 30 day one-click trial', async () => {
  const DB = flowDatabase({ current_offer: 'two_month' });
  const created = [];
  const response = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, {
    stripe: stripe(created), fulfillmentImplemented: true,
    autocreator: { grant: async () => ({}) },
  });
  assert.equal(response.status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, 'subscription');
  assert.deepEqual(created[0].params.items, [{ price: 'price_monthly' }]);
  assert.deepEqual(created[0].params.add_invoice_items, [{
    price_data: { currency: 'usd', product: 'prod_trial', unit_amount: 800 }, quantity: 1,
  }]);
  assert.equal(created[0].params.default_payment_method, 'pm_saved');
  assert.equal(created[0].params.trial_period_days, 30);
  assert.equal(created[0].params.payment_behavior, 'error_if_incomplete');
  assert.equal((await response.json()).one_click, true);
  assert.equal(DB.state.current_offer, 'certification');
});

test('monthly creation accepts the Basil invoice shape without expanding the removed payment_intent field', async () => {
  const DB = flowDatabase({ current_offer: 'two_month' });
  const client = stripe([]);
  client.subscriptions.create = async (params) => {
    assert.deepEqual(params.expand, ['latest_invoice']);
    return { id: 'sub_basil', status: 'trialing', trial_end: 1800000000,
      latest_invoice: { status: 'paid', amount_paid: 800, payments: { data: [
        { payment: { type: 'payment_intent', payment_intent: 'pi_basil' } },
      ] } } };
  };
  const result = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, {
    stripe: client, autocreator: { grant: async () => ({}) },
  });
  assert.equal(result.status, 200);
  assert.equal(DB.state.orders.get('sub_basil').payment_intent_id, 'pi_basil');
});

for (const code of ['payment_intent_action_required', 'invoice_payment_intent_requires_action']) {
  test(`bank-required authentication falls back once for ${code}`, async () => {
    const monthly = code.startsWith('invoice_');
    const DB = flowDatabase({ current_offer: monthly ? 'two_month' : 'lifetime' });
    const created = [];
    const client = stripe(created);
    const requireAction = async () => { throw Object.assign(new Error('Bank confirmation required'), { code }); };
    if (monthly) client.subscriptions.create = requireAction;
    else client.paymentIntents.create = requireAction;
    const result = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, { stripe: client });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).one_click, false);
    assert.equal(created.length, 1);
    assert.equal(created[0].kind, 'checkout');
    assert.equal(DB.state.pending_session_id, 'cs_child');
  });
}

test('isolated QA accepts advance without Stripe redirects or charges', async () => {
  const DB = flowDatabase({ current_offer: 'two_month' });
  const created = [];
  const proofRequest = request('/api/offer-checkout');
  proofRequest.headers.set('x-yfbjj-qa-proof', 'proof-secret');
  const response = await handleOfferCheckout(proofRequest, {
    ...baseEnv,
    DB,
    QA_PROOF_MODE: 'true',
    QA_PROOF_SECRET: 'proof-secret',
    QA_STRIPE_COUPON_ID: 'coupon-proof',
  }, {
    stripe: stripe(created),
    fulfillmentImplemented: true,
    autocreator: { grant: async () => ({}) },
  });
  assert.equal(response.status, 200);
  assert.equal(created.length, 0);
  const payload = await response.json();
  assert.equal(payload.one_click, true);
  assert.equal(payload.no_charge, true);
  assert.match(payload.url, /^\/offer\?session_id=qa_two_month_/);
  assert.equal(DB.state.current_offer, 'certification');
  assert.equal(DB.state.status, 'offer_ready');
  assert.match(DB.state.two_month_trial_end, /^\d{4}-\d{2}-\d{2}T/);
});

test('isolated QA preserves the server-owned offer order across consecutive no-charge accepts', async () => {
  const DB = flowDatabase();
  const created = [];
  const grants = [];
  const proofEnv = {
    ...baseEnv,
    DB,
    QA_PROOF_MODE: 'true',
    QA_PROOF_SECRET: 'proof-secret',
    QA_STRIPE_COUPON_ID: 'coupon-proof',
  };
  const deps = {
    stripe: stripe(created),
    fulfillmentImplemented: true,
    autocreator: { grant: async ({ offer }) => { grants.push(offer); return {}; } },
  };
  let source = 'cs_parent';
  for (const expectedNext of ['lifetime', 'certification', null]) {
    const proofRequest = request('/api/offer-checkout', {}, source);
    proofRequest.headers.set('x-yfbjj-qa-proof', 'proof-secret');
    const response = await handleOfferCheckout(proofRequest, proofEnv, deps);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.one_click, true);
    assert.equal(payload.no_charge, true);
    source = new URL(payload.url, 'https://funnel.test').searchParams.get('session_id');
    assert.match(source, /^qa_/);
    assert.equal(DB.state.current_offer, expectedNext);
  }
  assert.equal(created.length, 0);
  assert.deepEqual(grants, ['head_to_toes', 'lifetime', 'certification']);
  assert.equal(DB.state.status, 'complete');
});

test('isolated QA preserves the lifetime decline and monthly downsell branch without Checkout redirects', async () => {
  const DB = flowDatabase();
  const created = [];
  const env = {
    ...baseEnv, DB, QA_PROOF_MODE: 'true', QA_PROOF_SECRET: 'proof-secret',
    QA_STRIPE_COUPON_ID: 'coupon-proof',
  };
  const deps = {
    stripe: stripe(created), fulfillmentImplemented: true,
    autocreator: { grant: async () => ({}) },
  };
  const proofRequest = (path, source) => {
    const result = request(path, {}, source);
    result.headers.set('x-yfbjj-qa-proof', 'proof-secret');
    return result;
  };

  const head = await handleOfferCheckout(proofRequest('/api/offer-checkout', 'cs_parent'), env, deps);
  const headSource = new URL((await head.json()).url, 'https://funnel.test').searchParams.get('session_id');
  assert.equal(DB.state.current_offer, 'lifetime');

  const lifetimeSkip = await handleOfferSkip(proofRequest('/api/offer-skip', headSource), env, deps);
  assert.equal(lifetimeSkip.status, 200);
  assert.equal(DB.state.current_offer, 'two_month');

  const monthly = await handleOfferCheckout(proofRequest('/api/offer-checkout', headSource), env, deps);
  const monthlyPayload = await monthly.json();
  assert.equal(monthlyPayload.one_click, true);
  assert.equal(monthlyPayload.no_charge, true);
  const monthlySource = new URL(monthlyPayload.url, 'https://funnel.test').searchParams.get('session_id');
  assert.equal(DB.state.current_offer, 'certification');

  const certificationSkip = await handleOfferSkip(proofRequest('/api/offer-skip', monthlySource), env, deps);
  assert.equal(certificationSkip.status, 200);
  assert.match((await certificationSkip.json()).url, /^\/thanks\?session_id=qa_two_month_/);
  assert.equal(DB.state.current_offer, null);
  assert.equal(DB.state.status, 'complete');
  assert.equal(created.length, 0);
});

test('Certification checkout is server-derived, one-time, and fixed to the verified $297 Price', async () => {
  const DB = flowDatabase({ current_offer: 'certification' });
  const created = [];
  const response = await handleOfferCheckout(request('/api/offer-checkout', {
    offer: 'two_month', price_id: 'price_attacker', entitlement_key: 'attacker',
  }), { ...baseEnv, DB }, {
    stripe: stripe(created), fulfillmentImplemented: true,
    autocreator: { grant: async () => ({}) },
  });
  assert.equal(response.status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, 'payment_intent');
  assert.equal(created[0].params.amount, 29700);
  assert.equal(created[0].params.metadata.offer, 'certification');
  assert.equal(created[0].params.metadata.entitlement_key,
    'level-1-instructors-course,level-2-instructor-course,level-3-instructors-course');
  assert.equal(created[0].options.idempotencyKey, `offer:${flowHash}:certification:v1`);
});

test('an older purchase without a reusable card falls back to hosted Checkout', async () => {
  const DB = flowDatabase();
  const created = [];
  const client = stripe(created);
  client.paymentIntents.retrieve = async () => ({
    id: 'pi_root', status: 'succeeded', customer: 'cus_1', payment_method: 'pm_old', setup_future_usage: null,
  });
  const response = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, {
    stripe: client, fulfillmentImplemented: true,
  });
  assert.equal(response.status, 200);
  assert.equal(created[0].kind, 'checkout');
  assert.equal(created[0].params.customer, 'cus_1');
  assert.equal(created[0].params.payment_method_collection, undefined);
  assert.equal((await response.json()).one_click, false);
});

test('a saved-card charge resumes fulfillment without charging twice after a delivery failure', async () => {
  const DB = flowDatabase();
  const created = [];
  const client = stripe(created);
  let attempts = 0;
  const deps = {
    stripe: client,
    fulfillmentImplemented: true,
    autocreator: { grant: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary_delivery_failure');
      return {};
    } },
  };
  const first = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps);
  assert.equal(first.status, 502);
  assert.equal(DB.state.status, 'checkout_pending');
  assert.equal(DB.state.pending_session_id, 'pi_child');
  assert.equal(created.length, 1);

  const retried = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), {
    ok: true, url: '/offer?session_id=pi_child', one_click: true, recovered: true,
  });
  assert.equal(created.length, 1);
  assert.equal(attempts, 2);
  assert.equal(DB.state.current_offer, 'lifetime');
});

test('an accept claims the offer before charging so a concurrent decline cannot orphan the purchase', async () => {
  const DB = flowDatabase();
  const created = [];
  const client = stripe(created);
  const charge = client.paymentIntents.create;
  client.paymentIntents.create = async (...args) => {
    assert.equal(DB.state.status, 'checkout_pending');
    assert.equal(DB.state.pending_session_id, 'attempt_1');
    const skip = await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB }, { stripe: client });
    assert.equal(skip.status, 409);
    assert.equal((await skip.json()).error, 'checkout_still_open');
    return charge(...args);
  };
  const result = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, {
    stripe: client, autocreator: { grant: async () => ({}) },
  });
  assert.equal(result.status, 200);
  assert.equal(created.length, 1);
  assert.equal(DB.state.orders.get('pi_child').fulfillment_status, 'granted');
});

test('a crash after Stripe succeeds retains the original attempt and retries the same provider charge', async () => {
  const DB = flowDatabase({ failRecordOnce: true });
  const created = [];
  const client = stripe(created);
  const charge = client.paymentIntents.create;
  const providerRecords = new Map();
  const keys = [];
  client.paymentIntents.create = async (params, options) => {
    keys.push(options.idempotencyKey);
    if (!providerRecords.has(options.idempotencyKey)) {
      providerRecords.set(options.idempotencyKey, await charge(params, options));
    }
    return providerRecords.get(options.idempotencyKey);
  };
  const deps = { stripe: client, autocreator: { grant: async () => ({}) } };
  const failed = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps);
  assert.equal(failed.status, 502);
  assert.equal(DB.state.pending_session_id, 'attempt_1');
  assert.equal(DB.state.orders.size, 0);
  const resumed = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps);
  assert.equal(resumed.status, 200);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(created.length, 1);
  assert.equal(DB.state.orders.get('pi_child').fulfillment_status, 'granted');
  assert.equal(DB.state.current_offer, 'lifetime');
});

test('the final decline after a saved-card purchase opens its fulfilled thank-you page', async () => {
  for (const session of ['pi_lifetime', 'sub_monthly']) {
    const DB = flowDatabase({ current_offer: 'certification', authorized_session_id: session });
    DB.state.orders.set(session, { status: 'paid', fulfillment_status: 'granted', access_state: 'active',
      flow_hash: flowHash, customer_id: 'cus_1', email: 'buyer@example.com' });
    const client = stripe([]);
    client.subscriptions.retrieve = async () => ({ status: 'active', customer: 'cus_1' });
    const skipped = await handleOfferSkip(request('/api/offer-skip', {}, session), { ...baseEnv, DB }, { stripe: client });
    assert.equal(skipped.status, 200);
    const result = await skipped.json();
    const thanks = await getOrderFulfillmentState(new Request(`https://funnel.test${result.url}`), { ...baseEnv, DB });
    assert.equal(thanks.valid, true);
    assert.equal(thanks.fulfillment, 'granted');
  }
});

test('a QA purchase resumes if the Worker stopped between storing its ID and inserting its order', async () => {
  const DB = flowDatabase({ failOrderOnce: true });
  const created = [];
  const proofEnv = { ...baseEnv, DB, QA_PROOF_MODE: 'true', QA_PROOF_SECRET: 'proof', QA_STRIPE_COUPON_ID: 'coupon_fixture' };
  const deps = { stripe: stripe(created), autocreator: { grant: async () => ({}) } };
  const proofRequest = () => {
    const req = request('/api/offer-checkout');
    req.headers.set('x-yfbjj-qa-proof', 'proof');
    return req;
  };
  assert.equal((await handleOfferCheckout(proofRequest(), proofEnv, deps)).status, 502);
  assert.ok(DB.state.pending_session_id.startsWith('qa_'));
  assert.equal(DB.state.orders.size, 0);
  assert.equal((await handleOfferCheckout(proofRequest(), proofEnv, deps)).status, 200);
  assert.equal(DB.state.current_offer, 'lifetime');
  assert.equal(created.length, 0);
});

for (const recovery of ['buyer', 'webhook', 'monthly-webhook']) test(`real SQLite recovers a provider-response crash through ${recovery} without a second charge`, async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO checkout_flows (flow_hash, root_session_id, customer_id, email, current_offer,
    status, authorized_session_id, attribution, expires_at, version, updated_at)
    VALUES (?, 'cs_root', 'cus_1', 'buyer@example.com', 'head_to_toes', 'offer_ready', 'cs_parent', '{}',
    '2099-01-01', 7, '2026-01-01')`).run(flowHash);
  sqlite.prepare(`INSERT INTO stripe_orders (session_id, customer_id, email, offer, status, fulfillment_status,
    access_state, flow_hash, updated_at) VALUES ('cs_parent', 'cus_1', 'buyer@example.com', 'bundle', 'paid',
    'granted', 'active', ?, '2026-01-01')`).run(flowHash);
  if (recovery === 'monthly-webhook') sqlite.exec("UPDATE checkout_flows SET current_offer = 'two_month'");
  let failRecord = true;
  const DB = { prepare(sql) { return { bind(...values) {
    const params = Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
    return {
      first: async () => {
        if (failRecord && sql.includes('AND pending_session_id = ?6')) {
          failRecord = false;
          throw new Error('worker_interrupted_after_charge');
        }
        return sqlite.prepare(sql).get(params) || null;
      },
      run: async () => sqlite.prepare(sql).run(params),
    };
  } }; } };
  const created = [];
  const client = stripe(created);
  const providerCharge = client.paymentIntents.create;
  let providerResult;
  let providerKey;
  client.paymentIntents.create = async (params, options) => {
    if (providerResult) { assert.equal(options.idempotencyKey, providerKey); return providerResult; }
    providerKey = options.idempotencyKey;
    const skip = await handleOfferSkip(request('/api/offer-skip'), { ...baseEnv, DB }, { stripe: client });
    assert.equal(skip.status, 409);
    providerResult = await providerCharge(params, options);
    return providerResult;
  };
  const deps = { stripe: client, autocreator: { grant: async () => ({ accessState: 'active' }) } };
  assert.equal((await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps)).status, 502);
  assert.equal(sqlite.prepare('SELECT pending_session_id FROM checkout_flows').get().pending_session_id, 'attempt_7');
  if (recovery === 'buyer') {
    assert.equal((await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps)).status, 200);
  } else {
    const monthly = recovery === 'monthly-webhook';
    const record = created[0];
    const event = monthly ? {
      id: 'evt_monthly_recovery', type: 'invoice.paid', data: { object: {
        id: 'in_initial', customer: 'cus_1', billing_reason: 'subscription_create', subscription: 'sub_child',
        status: 'paid', amount_paid: 800, currency: 'usd', payment_intent: 'pi_invoice',
      } },
    } : {
      id: 'evt_payment_recovery', type: 'payment_intent.succeeded', data: { object: {
        id: 'pi_child', status: 'succeeded', customer: 'cus_1', currency: 'usd',
        amount_received: record.params.amount, metadata: record.params.metadata,
      } },
    };
    client.webhooks = { constructEventAsync: async () => event };
    const hookRequest = () => new Request('https://funnel.test/api/stripe-webhook', { method: 'POST', body: '{}' });
    let deliveries = 0;
    deps.autocreator.grant = async () => {
      deliveries++;
      if (deliveries === 1) throw new Error('temporary_grant_failure');
      return { accessState: 'active' };
    };
    assert.equal((await handleWebhook(hookRequest(), { ...baseEnv, DB }, deps)).status, 503);
    assert.equal((await handleWebhook(hookRequest(), { ...baseEnv, DB }, deps)).status, 200);
    const duplicate = await handleWebhook(hookRequest(), { ...baseEnv, DB }, deps);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(deliveries, 2);
    if (monthly) {
      event.data.object.billing_reason = 'subscription_cycle';
      assert.equal((await (await handleWebhook(hookRequest(), { ...baseEnv, DB }, deps)).json()).ignored, true);
      assert.equal(deliveries, 2);
    }
  }
  assert.equal(created.length, 1);
  const purchaseId = recovery === 'monthly-webhook' ? 'sub_child' : 'pi_child';
  assert.equal(sqlite.prepare('SELECT fulfillment_status FROM stripe_orders WHERE session_id = ?').get(purchaseId).fulfillment_status, 'granted');
  assert.equal(sqlite.prepare('SELECT current_offer FROM checkout_flows').get().current_offer, recovery === 'monthly-webhook' ? 'certification' : 'lifetime');
  sqlite.close();
});
