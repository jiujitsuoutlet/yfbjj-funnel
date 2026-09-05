import { defaultDocument } from './defaults.js';
import { EDITOR_PAGE_KEYS, validateContentDocument } from './schema.js';
import { upgradeContentDocument } from './upgrade.js';
import { mediaPaths } from './media.js';

function iso(now = new Date()) { return new Date(now).toISOString(); }
async function imagePathsFor(env, document, checkedIn) {
  if (!JSON.stringify(document).includes('"/media/')) return checkedIn;
  return [...checkedIn, ...await mediaPaths(env)];
}
async function checksum(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadEditorPage(env, pageKey, { actor = 'admin', imagePaths = [] } = {}) {
  if (!EDITOR_PAGE_KEYS.includes(pageKey)) return { ok: false, status: 404, error: 'unknown_page' };
  let row = await env.DB.prepare(
    `SELECT page_key, title, draft_json, draft_revision, published_revision, published_at, updated_at
     FROM editor_pages WHERE page_key = ?1`
  ).bind(pageKey).first();
  if (!row) return { ok: false, status: 503, error: 'editor_schema_missing' };
  if (!row.draft_json) {
    const initial = JSON.stringify(defaultDocument(pageKey));
    await env.DB.prepare(
      `UPDATE editor_pages SET draft_json = ?2, draft_revision = 1,
       updated_at = ?3, updated_by = ?4 WHERE page_key = ?1 AND draft_json IS NULL`
    ).bind(pageKey, initial, iso(), actor).run();
    row = await env.DB.prepare(
      `SELECT page_key, title, draft_json, draft_revision, published_revision, published_at, updated_at
       FROM editor_pages WHERE page_key = ?1`
    ).bind(pageKey).first();
  }
  let document;
  try { document = upgradeContentDocument(pageKey, JSON.parse(row.draft_json)); } catch { return { ok: false, status: 500, error: 'draft_corrupt' }; }
  const checked = validateContentDocument(document, { pageKey, imagePaths: await imagePathsFor(env, document, imagePaths) });
  if (!checked.ok) return { ok: false, status: 500, error: 'draft_invalid', details: checked.errors };
  return { ok: true, page: { ...row, document: checked.value, draft_json: undefined } };
}

export async function saveDraft(env, pageKey, document, expectedRevision, { actor = 'admin', imagePaths = [] } = {}) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, status: 400, error: 'invalid_revision' };
  const checked = validateContentDocument(document, { pageKey, imagePaths: await imagePathsFor(env, document, imagePaths) });
  if (!checked.ok) return { ok: false, status: 400, error: 'invalid_document', details: checked.errors };
  const now = iso();
  const nextRevision = expectedRevision + 1;
  const operationId = crypto.randomUUID();
  const statements = [env.DB.prepare(
    `UPDATE editor_pages SET draft_json = ?2, draft_revision = draft_revision + 1,
     updated_at = ?3, updated_by = ?4, last_operation_id = ?5
     WHERE page_key = ?1 AND draft_revision = ?6`
  ).bind(pageKey, JSON.stringify(checked.value), now, actor, operationId, expectedRevision), env.DB.prepare(
    `INSERT INTO editor_audit_log (id, actor, action, page_key, revision, created_at)
     SELECT ?1, ?2, 'draft_save', page_key, draft_revision, ?3
     FROM editor_pages WHERE page_key = ?4 AND draft_revision = ?5 AND last_operation_id = ?6`
  ).bind(crypto.randomUUID(), actor, now, pageKey, nextRevision, operationId)];
  let results;
  try { results = await env.DB.batch(statements); } catch { return { ok: false, status: 503, error: 'draft_save_failed' }; }
  if (!results || !results[0] || Number(results[0].meta && results[0].meta.changes) !== 1) {
    return { ok: false, status: 409, error: 'stale_draft' };
  }
  const verified = await env.DB.prepare('SELECT draft_revision FROM editor_pages WHERE page_key = ?1').bind(pageKey).first();
  if (!verified || verified.draft_revision !== nextRevision) return { ok: false, status: 409, error: 'stale_draft' };
  return { ok: true, revision: nextRevision, savedAt: now };
}

export async function publishDraft(env, pageKey, expectedRevision, { actor = 'admin', imagePaths = [] } = {}) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, status: 400, error: 'invalid_revision' };
  const row = await env.DB.prepare(
    'SELECT draft_json, draft_revision, published_json, published_revision, published_at FROM editor_pages WHERE page_key = ?1'
  ).bind(pageKey).first();
  if (!row || row.draft_revision !== expectedRevision || !row.draft_json) return { ok: false, status: 409, error: 'stale_draft' };
  let document;
  try { document = upgradeContentDocument(pageKey, JSON.parse(row.draft_json)); } catch { return { ok: false, status: 400, error: 'invalid_document' }; }
  const checked = validateContentDocument(document, { pageKey, imagePaths: await imagePathsFor(env, document, imagePaths) });
  if (!checked.ok) return { ok: false, status: 400, error: 'invalid_document', details: checked.errors };
  const value = JSON.stringify(checked.value);
  if (row.published_revision === expectedRevision && row.published_json) {
    try {
      const published = upgradeContentDocument(pageKey, JSON.parse(row.published_json));
      const publishedChecked = validateContentDocument(published, { pageKey, imagePaths: await imagePathsFor(env, published, imagePaths) });
      if (publishedChecked.ok && JSON.stringify(publishedChecked.value) === value) {
        return { ok: true, revision: expectedRevision, publishedAt: row.published_at };
      }
    } catch { /* continue through the guarded publish path */ }
  }
  const now = iso();
  const versionId = crypto.randomUUID();
  const digest = await checksum(value);
  const statements = [
    env.DB.prepare(
      `INSERT INTO editor_page_versions
       (id, page_key, revision, document_json, checksum, created_at, created_by)
       SELECT ?1, page_key, draft_revision, ?2, ?3, ?4, ?5
       FROM editor_pages WHERE page_key = ?6 AND draft_revision = ?7`
    ).bind(versionId, value, digest, now, actor, pageKey, expectedRevision),
    env.DB.prepare(
      `UPDATE editor_pages SET draft_json = ?2, published_json = ?2, published_revision = draft_revision,
       published_at = ?3, updated_at = ?3, updated_by = ?4
       WHERE page_key = ?1 AND draft_revision = ?5`
    ).bind(pageKey, value, now, actor, expectedRevision),
    env.DB.prepare(
      `INSERT INTO editor_audit_log (id, actor, action, page_key, revision, created_at)
       SELECT ?1, ?2, 'publish', page_key, published_revision, ?3
       FROM editor_pages WHERE page_key = ?4 AND draft_revision = ?5 AND published_revision = ?5`
    ).bind(crypto.randomUUID(), actor, now, pageKey, expectedRevision),
  ];
  let results;
  try { results = await env.DB.batch(statements); } catch { return { ok: false, status: 409, error: 'publish_conflict' }; }
  if (!results || Number(results[0] && results[0].meta && results[0].meta.changes) !== 1 || Number(results[1] && results[1].meta && results[1].meta.changes) !== 1) {
    return { ok: false, status: 409, error: 'publish_conflict' };
  }
  const verified = await env.DB.prepare(
    'SELECT published_revision FROM editor_pages WHERE page_key = ?1'
  ).bind(pageKey).first();
  if (!verified || verified.published_revision !== expectedRevision) return { ok: false, status: 409, error: 'publish_conflict' };
  try {
    await env.DB.prepare(
      `DELETE FROM editor_page_versions WHERE page_key = ?1 AND id NOT IN
       (SELECT id FROM editor_page_versions WHERE page_key = ?1 ORDER BY revision DESC LIMIT 50)`
    ).bind(pageKey).run();
  } catch (error) {
    console.error('editor version retention cleanup failed', { pageKey, message: error && error.message });
  }
  return { ok: true, revision: expectedRevision, publishedAt: now };
}

export async function listVersions(env, pageKey) {
  if (!EDITOR_PAGE_KEYS.includes(pageKey)) return { ok: false, status: 404, error: 'unknown_page' };
  const rows = await env.DB.prepare(
    `SELECT id, revision, checksum, created_at, created_by
     FROM editor_page_versions WHERE page_key = ?1 ORDER BY revision DESC LIMIT 50`
  ).bind(pageKey).all();
  return { ok: true, versions: rows.results || [] };
}

export async function restoreVersion(env, pageKey, versionId, expectedRevision, { actor = 'admin', imagePaths = [] } = {}) {
  const version = await env.DB.prepare(
    'SELECT document_json FROM editor_page_versions WHERE id = ?1 AND page_key = ?2'
  ).bind(versionId, pageKey).first();
  if (!version) return { ok: false, status: 404, error: 'version_not_found' };
  let document;
  try { document = upgradeContentDocument(pageKey, JSON.parse(version.document_json)); } catch { return { ok: false, status: 500, error: 'version_corrupt' }; }
  const saved = await saveDraft(env, pageKey, document, expectedRevision, { actor, imagePaths });
  if (!saved.ok) return saved;
  try {
    await env.DB.prepare(
      `INSERT INTO editor_audit_log (id, actor, action, page_key, revision, created_at, detail_json)
       VALUES (?1, ?2, 'restore', ?3, ?4, ?5, ?6)`
    ).bind(crypto.randomUUID(), actor, pageKey, saved.revision, iso(), JSON.stringify({ versionId })).run();
  } catch (error) {
    console.error('editor restore audit write failed', { pageKey, versionId, message: error && error.message });
  }
  return { ...saved, restoredFrom: versionId };
}

export async function loadPublishedDocument(env, pageKey, { imagePaths = [] } = {}) {
  if (!env.DB || !EDITOR_PAGE_KEYS.includes(pageKey)) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT published_json FROM editor_pages WHERE page_key = ?1'
    ).bind(pageKey).first();
    if (!row || !row.published_json) return null;
    const document = upgradeContentDocument(pageKey, JSON.parse(row.published_json));
    const checked = validateContentDocument(document, { pageKey, imagePaths: await imagePathsFor(env, document, imagePaths) });
    return checked.ok ? checked.value : null;
  } catch (error) {
    console.error('published editor content unavailable', { pageKey, message: error && error.message });
    return null;
  }
}
