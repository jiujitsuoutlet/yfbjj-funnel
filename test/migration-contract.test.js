import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('a pending checkout flow may reference its Stripe Session before webhook order insertion', () => {
  const migration = readFileSync(new URL('../migrations/0007_offer_journey.sql', import.meta.url), 'utf8');
  assert.match(migration, /root_session_id TEXT UNIQUE/);
  assert.doesNotMatch(migration, /FOREIGN KEY\s*\(root_session_id\)\s*REFERENCES stripe_orders/);
});
