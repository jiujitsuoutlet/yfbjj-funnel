import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../wrangler.preview.toml', import.meta.url), 'utf8');

test('visual staging is isolated and has no D1 or route', () => {
  assert.match(config, /^name = "yfbjj-funnel-visual-staging"$/m);
  assert.doesNotMatch(config, /^routes\s*=|\[\[d1_databases\]\]|database_id\s*=/m);
});

test('visual staging keeps both fail-closed switches on', () => {
  assert.match(config, /^PREVIEW_MODE = "true"$/m);
  assert.match(config, /^PREVIEW_NO_D1 = "true"$/m);
});

test('stateful endpoint guard precedes normal routing', () => {
  const guard = worker.indexOf('if (isPreviewOnlyStaging(env))');
  const normalRoute = worker.indexOf("if (method === 'HEAD' || method === 'GET')", guard);
  assert.ok(guard > 0 && normalRoute > guard);
  for (const route of ['/api/checkout', '/api/lead', '/api/stats', '/api/webhook', '/api/customer-portal', '/api/order', '/api/entitlement']) {
    assert.ok(worker.includes(route), `${route} is not guarded`);
  }
  assert.match(worker, /checkout \? 423 : 503/);
});
