import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDocument } from '../src/editor/defaults.js';
import { loadPublishedDocument, publishDraft, saveDraft } from '../src/editor/repository.js';

const images = ['/img/guard-pass-800.webp'];

class MemoryDB {
  constructor(pageKey, document, revision = 1) {
    this.page = { page_key: pageKey, title: pageKey, draft_json: JSON.stringify(document), draft_revision: revision, published_json: null, published_revision: null, published_at: null, updated_at: '', updated_by: '', last_operation_id: null };
    this.versions = [];
    this.audit = [];
  }
  prepare(sql) {
    const db = this;
    return { bind(...args) { return {
      async first() {
        if (sql.includes('SELECT draft_json, draft_revision')) return { draft_json: db.page.draft_json, draft_revision: db.page.draft_revision };
        if (sql.includes('SELECT draft_revision FROM')) return { draft_revision: db.page.draft_revision };
        if (sql.includes('SELECT published_revision')) return { published_revision: db.page.published_revision };
        if (sql.includes('SELECT published_json')) return { published_json: db.page.published_json };
        return null;
      },
      async run() { return { meta: { changes: 0 } }; },
      async all() { return { results: [] }; },
      _sql: sql, _args: args,
    }; } };
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      const { _sql: sql, _args: a } = statement;
      if (sql.startsWith('UPDATE editor_pages SET draft_json') && sql.includes('draft_revision = draft_revision + 1')) {
        if (this.page.page_key === a[0] && this.page.draft_revision === a[5]) {
          this.page.draft_json = a[1]; this.page.draft_revision += 1; this.page.last_operation_id = a[4];
          results.push({ meta: { changes: 1 } });
        } else results.push({ meta: { changes: 0 } });
      } else if (sql.includes("'draft_save'")) {
        if (this.page.draft_revision === a[4] && this.page.last_operation_id === a[5]) this.audit.push({ action: 'draft_save', revision: a[4] });
        results.push({ meta: { changes: 1 } });
      } else if (sql.startsWith('INSERT INTO editor_page_versions')) {
        if (this.page.draft_revision === a[6]) this.versions.push({ id: a[0], revision: a[6], document_json: a[1] });
        results.push({ meta: { changes: 1 } });
      } else if (sql.startsWith('UPDATE editor_pages SET draft_json =')) {
        if (this.page.draft_revision === a[4]) { this.page.draft_json = a[1]; this.page.published_json = a[1]; this.page.published_revision = a[4]; }
        results.push({ meta: { changes: 1 } });
      } else if (sql.includes("'publish'")) {
        if (this.page.published_revision === a[4]) this.audit.push({ action: 'publish', revision: a[4] });
        results.push({ meta: { changes: 1 } });
      }
    }
    return results;
  }
}

test('draft compare-and-set rejects a concurrent stale save without overwriting', async () => {
  const first = defaultDocument('landing-a');
  const db = new MemoryDB('landing-a', first);
  const winner = defaultDocument('landing-a');
  winner.seo.title = 'Winner';
  assert.equal((await saveDraft({ DB: db }, 'landing-a', winner, 1, { imagePaths: images })).revision, 2);
  const stale = defaultDocument('landing-a');
  stale.seo.title = 'Stale';
  const result = await saveDraft({ DB: db }, 'landing-a', stale, 1, { imagePaths: images });
  assert.deepEqual(result, { ok: false, status: 409, error: 'stale_draft' });
  assert.equal(JSON.parse(db.page.draft_json).seo.title, 'Winner');
  assert.deepEqual(db.audit, [{ action: 'draft_save', revision: 2 }]);
});

test('publish validates revision and exposes only the published document', async () => {
  const document = defaultDocument('thanks-granted');
  const db = new MemoryDB('thanks-granted', document, 3);
  assert.deepEqual(await publishDraft({ DB: db }, 'thanks-granted', -1), { ok: false, status: 400, error: 'invalid_revision' });
  const published = await publishDraft({ DB: db }, 'thanks-granted', 3);
  assert.equal(published.ok, true);
  assert.equal(db.versions.length, 1);
  assert.equal(db.audit.filter((row) => row.action === 'publish').length, 1);
  assert.deepEqual(await loadPublishedDocument({ DB: db }, 'thanks-granted'), document);
});

test('public published lookup falls back safely on unavailable or malformed storage', async () => {
  assert.equal(await loadPublishedDocument({}, 'landing-a', { imagePaths: images }), null);
  const bad = new MemoryDB('landing-a', defaultDocument('landing-a'));
  bad.page.published_json = '{bad';
  assert.equal(await loadPublishedDocument({ DB: bad }, 'landing-a', { imagePaths: images }), null);
  const failing = { DB: { prepare() { throw new Error('offline'); } } };
  assert.equal(await loadPublishedDocument(failing, 'landing-a', { imagePaths: images }), null);
});
