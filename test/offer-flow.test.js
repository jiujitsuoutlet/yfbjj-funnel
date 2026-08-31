import assert from 'node:assert/strict';
import test from 'node:test';
import { handleOfferCheckout, handleOfferSkip } from '../src/stripe.js';

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
};

function flowDatabase(overrides = {}) {
  const state = {
    status: 'offer_ready', current_offer: 'head_to_toes', pending_session_id: null,
    pending_checkout_url: null, authorized_session_id: 'cs_parent', two_month_trial_end: null,
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
          if (sql.includes('FROM stripe_orders WHERE session_id')) return {
            status: 'paid', fulfillment_status: state.fulfillment || 'granted', access_state: 'active',
            flow_hash: flowHash, customer_id: 'cus_1', email: 'buyer@example.com',
          };
          if (sql.includes('FROM fulfillment_readiness')) return { schema_version: 1 };
          if (sql.includes("UPDATE checkout_flows SET status = 'checkout_pending'")) {
            if (state.status !== 'offer_ready') return null;
            state.status = 'checkout_pending'; state.pending_session_id = values[1]; state.pending_checkout_url = values[2];
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
        run: async () => ({ success: true }),
      }; } };
    },
  };
}

function request(path, body = {}) {
  return new Request(`https://funnel.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://funnel.test', cookie: `yfbjj_flow=${token}` },
    body: JSON.stringify({ source_session_id: 'cs_parent', ...body }),
  });
}

function stripe(created) {
  return { checkout: { sessions: {
    retrieve: async () => ({ id: 'cs_parent', status: 'complete', payment_status: 'paid', customer: 'cus_1' }),
    create: async (params, options) => { created.push({ params, options }); return { id: 'cs_child', url: 'https://checkout.test/child' }; },
  } } };
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

test('server derives the sole allowed child offer and accept replay returns one Checkout', async () => {
  const DB = flowDatabase();
  const created = [];
  const deps = { stripe: stripe(created), fulfillmentImplemented: true };
  const first = await handleOfferCheckout(request('/api/offer-checkout', {
    offer: 'lifetime', price_id: 'price_attacker', entitlement_key: 'attacker',
  }), { ...baseEnv, DB }, deps);
  assert.equal(first.status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].params.line_items[0].price, 'price_head');
  assert.equal(created[0].params.customer, 'cus_1');
  assert.equal(created[0].params.metadata.root_session_id, 'cs_root');
  assert.equal(created[0].params.metadata.parent_session_id, 'cs_parent');
  assert.equal(created[0].params.metadata.variant, 'b');
  assert.equal(created[0].options.idempotencyKey, `offer:${flowHash}:head_to_toes`);
  const replay = await handleOfferCheckout(request('/api/offer-checkout'), { ...baseEnv, DB }, deps);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replay, true);
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
  assert.equal(lifetime.state.two_month_trial_end, '2027-03-31T12:00:00.000Z');
});
