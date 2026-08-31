const DEFAULT_BASE_URL = 'https://yfbjj.autocreator.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 8000;

export class AutoCreatorError extends Error {
  constructor(message, { status = 0, retryable = false, retryAfter = null, code = 'autocreator_error' } = {}) {
    super(message);
    this.name = 'AutoCreatorError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

export function classifyAutoCreatorFailure(status) {
  if (status === 429) return { retryable: true, code: 'rate_limited' };
  if (status >= 500) return { retryable: true, code: 'upstream_failure' };
  if (status === 401) return { retryable: false, code: 'invalid_key' };
  if (status === 403) return { retryable: false, code: 'missing_scope' };
  if (status === 404) return { retryable: false, code: 'tool_unavailable' };
  return { retryable: false, code: 'invalid_request' };
}

function exactRecord(value, key, expected) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value) && value[key] === expected) return value;
  for (const child of Object.values(value)) {
    const found = exactRecord(child, key, expected);
    if (found) return found;
  }
  return null;
}

function isActive(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.revoked_at || record.ended_at || record.cancelled_at) return false;
  const status = String(record.status || '').toLowerCase();
  return !['revoked', 'inactive', 'cancelled', 'canceled', 'failed', 'expired'].includes(status);
}

function memberId(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value)) {
    if (typeof value.member_id === 'string' && value.member_id) return value.member_id;
    if (typeof value.id === 'string' && value.id) return value.id;
  }
  for (const child of Object.values(value)) {
    const found = memberId(child);
    if (found) return found;
  }
  return null;
}

function needsActivation(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.neverSignedIn === true || value.never_signed_in === true) return true;
  return Object.values(value).some((child) => needsActivation(child));
}

export function createAutoCreatorClient(env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const baseUrl = String(env.AUTOCREATOR_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = Number(deps.timeoutMs || env.AUTOCREATOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  async function tool(toolName, args) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let http;
    try {
      http = await fetchImpl(`${baseUrl}/tools/${encodeURIComponent(toolName)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AUTOCREATOR_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ args }),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      throw new AutoCreatorError(timedOut ? 'AutoCreator request timed out' : 'AutoCreator transport failed', {
        retryable: true,
        code: timedOut ? 'timeout' : 'transport_failure',
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try { payload = await http.json(); } catch {
      throw new AutoCreatorError('AutoCreator returned invalid JSON', {
        status: http.status, retryable: http.status >= 500, code: 'invalid_response',
      });
    }
    if (!http.ok) {
      const classification = classifyAutoCreatorFailure(http.status);
      throw new AutoCreatorError('AutoCreator rejected the tool request', {
        status: http.status,
        retryable: classification.retryable,
        retryAfter: http.headers.get('retry-after'),
        code: classification.code,
      });
    }
    if (!payload || payload.ok !== true || payload.tool !== toolName || !('result' in payload)) {
      throw new AutoCreatorError('AutoCreator tool did not return a verified success envelope', {
        status: http.status,
        retryable: payload && payload.ok === false,
        code: 'tool_failure',
      });
    }
    return payload.result;
  }

  async function grant({ offer, entitlementKey, sessionId, email, customerId, subscriptionId }) {
    if (!email) throw new AutoCreatorError('A buyer email is required for fulfillment', { code: 'email_missing' });
    if (offer === 'bundle' || offer === 'head_to_toes') {
      await tool('members.grantBundleEntitlement', {
        email,
        bundle_slug: entitlementKey,
        source: 'stripe_purchase',
        notes: `Stripe Checkout ${sessionId}`,
      });
      const entitlements = await tool('members.listBundleEntitlements', { email });
      const record = exactRecord(entitlements, 'bundle_slug', entitlementKey);
      if (!record || !isActive(record)) {
        throw new AutoCreatorError('AutoCreator bundle read-back did not prove access', {
          retryable: true, code: 'readback_failed',
        });
      }
      const member = await tool('members.findByEmail', { email });
      const id = memberId(member);
      if (!id) throw new AutoCreatorError('AutoCreator member read-back did not return a member ID', { retryable: true, code: 'readback_failed' });
      const access = await tool('members.checkAccess', { member_id: id });
      return { verified: true, activationNeeded: needsActivation(access) };
    }

    if (offer === 'lifetime' || offer === 'two_month') {
      const args = { email, price_id: entitlementKey, status: 'active', create_if_missing: true };
      if (customerId) args.stripe_customer_id = customerId;
      if (subscriptionId) args.stripe_subscription_id = subscriptionId;
      await tool('members.setMembership', args);
      const member = await tool('members.findByEmail', { email });
      const id = memberId(member);
      if (!id) {
        throw new AutoCreatorError('AutoCreator member read-back did not return a member ID', {
          retryable: true, code: 'readback_failed',
        });
      }
      const active = await tool('subscriptions.getActive', { member_id: id });
      const record = exactRecord(active, 'price_id', entitlementKey);
      if (!record || !isActive(record)) {
        throw new AutoCreatorError('AutoCreator membership read-back did not prove access', {
          retryable: true, code: 'readback_failed',
        });
      }
      const access = await tool('members.checkAccess', { member_id: id });
      return { verified: true, activationNeeded: needsActivation(access) };
    }
    throw new AutoCreatorError('Unsupported fulfillment offer', { code: 'unsupported_offer' });
  }

  return { tool, grant };
}
