import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = join(import.meta.dirname, '..');
const migration = (name) => readFileSync(join(root, 'migrations', name), 'utf8');

test('Certification migration preserves linked rows and expands both registries', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_init.sql', '0002_rate_limits.sql', '0003_ab_test.sql',
    '0004_stripe_staging.sql', '0005_entitlement_mapping.sql',
    '0006_fulfillment_outbox.sql', '0007_offer_journey.sql',
    '0008_content_editor.sql',
  ]) db.exec(migration(name));

  db.exec(`
    INSERT INTO checkout_flows (
      flow_hash, current_offer, status, attribution, expires_at, updated_at
    ) VALUES ('flow_existing', 'two_month', 'offer_ready', '{}', '2027-01-01', '2026-01-01');
    INSERT INTO offer_transitions (
      flow_hash, source_session_id, offer, action, attribution, created_at
    ) VALUES ('flow_existing', 'cs_existing', 'two_month', 'skip', '{}', '2026-01-01');
    UPDATE editor_pages SET draft_json = '{"saved":true}', draft_revision = 4
      WHERE page_key = 'landing-a';
    INSERT INTO editor_page_versions (
      id, page_key, revision, document_json, checksum, created_at, created_by
    ) VALUES ('version_existing', 'landing-a', 4, '{"saved":true}', 'checksum', '2026-01-01', 'admin');
  `);

  db.exec(migration('0009_certification_offer.sql'));

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare("SELECT current_offer FROM checkout_flows WHERE flow_hash = 'flow_existing'").get().current_offer, 'two_month');
  assert.equal(db.prepare("SELECT offer FROM offer_transitions WHERE flow_hash = 'flow_existing'").get().offer, 'two_month');
  assert.equal(db.prepare("SELECT draft_revision FROM editor_pages WHERE page_key = 'landing-a'").get().draft_revision, 4);
  assert.equal(db.prepare("SELECT revision FROM editor_page_versions WHERE id = 'version_existing'").get().revision, 4);
  assert.equal(db.prepare("SELECT title FROM editor_pages WHERE page_key = 'offer-certification'").get().title, 'Offer: Certification');

  db.exec(`
    INSERT INTO checkout_flows (
      flow_hash, current_offer, status, attribution, expires_at, updated_at
    ) VALUES ('flow_cert', 'certification', 'offer_ready', '{}', '2027-01-01', '2026-01-01');
    INSERT INTO offer_transitions (
      flow_hash, source_session_id, offer, action, attribution, created_at
    ) VALUES ('flow_cert', 'cs_cert', 'certification', 'accept', '{}', '2026-01-01');
  `);
  assert.equal(db.prepare("SELECT offer FROM offer_transitions WHERE flow_hash = 'flow_cert'").get().offer, 'certification');
  db.close();
});
