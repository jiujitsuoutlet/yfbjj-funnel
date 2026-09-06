import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const routes = await readFile(new URL('../src/editor/routes.js', import.meta.url), 'utf8');

test('buyer-specific offer and thanks responses are private and never shared cached', () => {
  assert.match(worker, /BUYER_STATE_HEADERS = \{ 'Cache-Control': 'private, no-store', Vary: 'Cookie' \}/);
  const stateResponses = worker.match(/html\([^\n]+BUYER_STATE_HEADERS\)/g) || [];
  assert.ok(stateResponses.length >= 4, `expected buyer-state cache headers on resolved branches, found ${stateResponses.length}`);
  assert.match(worker, /pendingHeaders = \{ \.\.\.BUYER_STATE_HEADERS, Refresh:/);
  assert.match(worker, /202,\s*pendingHeaders/);
});

test('published routing uses fixed server-derived page keys and trusted trial end', () => {
  assert.match(worker, /`landing-\$\{variant\}`/);
  assert.match(worker, /`thanks-\$\{state\}`/);
  assert.match(worker, /state\.trialEnd/);
  assert.doesNotMatch(worker, /state\.trial_end/);
  assert.match(routes, /\/api\\\/admin\\\/pages\\\/\(\[a-z0-9-\]\+\)/);
  assert.match(routes, /validateContentDocument/);
});

test('admin pages and APIs are no-store and body-limited', () => {
  assert.match(routes, /'Cache-Control': 'no-store'/);
  assert.match(routes, /body_too_large/);
  assert.match(worker, /path === '\/admin'/);
});
