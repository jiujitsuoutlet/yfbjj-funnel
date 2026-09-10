#!/usr/bin/env node
import { createHash } from 'node:crypto';

const ACCOUNT_ID = 'cb8ab13b857925cdb9b3c0fd9d4ec4bf';
const PRODUCTION_DATABASE_ID = '0cce4280-1113-45f5-b0da-bd5979f7cace';
const STAGING_DATABASE_ID = 'e2ebcc63-f373-451e-84a9-9118f8053f82';
const apply = process.argv.includes('--apply');
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');

async function query(databaseId, sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.result?.[0]?.success) {
    throw new Error(`D1 query failed (${response.status})`);
  }
  return payload.result[0].results || [];
}

function mediaIds(pages) {
  const ids = new Set();
  for (const page of pages) {
    for (const source of [page.draft_json, page.published_json]) {
      for (const match of String(source || '').matchAll(/\/media\/([0-9a-f-]{36})/gi)) ids.add(match[1]);
    }
  }
  return [...ids].sort();
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

const pageSql = `SELECT page_key, title, draft_json, draft_revision, published_json,
  published_revision, published_at, updated_at, updated_by, last_operation_id
  FROM editor_pages ORDER BY page_key`;
const sourcePages = await query(PRODUCTION_DATABASE_ID, pageSql);
const ids = mediaIds(sourcePages);
const sourceMedia = [];
for (const id of ids) {
  const rows = await query(PRODUCTION_DATABASE_ID,
    `SELECT id, filename, content_type, byte_length, data_base64, created_at, created_by
     FROM editor_media WHERE id = ?1`, [id]);
  if (rows.length !== 1) throw new Error(`Published page references missing media ${id}`);
  sourceMedia.push(rows[0]);
}

console.log(`Editor sync ${apply ? 'apply' : 'dry run'}: ${sourcePages.length} pages, ${sourceMedia.length} referenced media files`);
for (const page of sourcePages) {
  console.log(`${page.page_key}: draft r${page.draft_revision}, published r${page.published_revision ?? 0}`);
}
if (!apply) {
  console.log('No changes made. Re-run with --apply to update staging.');
  process.exit(0);
}

for (const media of sourceMedia) {
  await query(STAGING_DATABASE_ID,
    `INSERT INTO editor_media
       (id, filename, content_type, byte_length, data_base64, created_at, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET filename = excluded.filename,
       content_type = excluded.content_type, byte_length = excluded.byte_length,
       data_base64 = excluded.data_base64, created_at = excluded.created_at,
       created_by = excluded.created_by`,
    [media.id, media.filename, media.content_type, media.byte_length, media.data_base64,
      media.created_at, media.created_by]);
}

for (const page of sourcePages) {
  await query(STAGING_DATABASE_ID,
    `UPDATE editor_pages SET title = ?2, draft_json = ?3, draft_revision = ?4,
       published_json = ?5, published_revision = ?6, published_at = ?7,
       updated_at = ?8, updated_by = ?9, last_operation_id = ?10
     WHERE page_key = ?1`,
    [page.page_key, page.title, page.draft_json, page.draft_revision, page.published_json,
      page.published_revision, page.published_at, page.updated_at, page.updated_by,
      page.last_operation_id]);
}

const targetPages = await query(STAGING_DATABASE_ID, pageSql);
if (targetPages.length !== sourcePages.length) throw new Error('Staging page count does not match production');
for (let index = 0; index < sourcePages.length; index += 1) {
  const source = sourcePages[index];
  const target = targetPages[index];
  if (source.page_key !== target.page_key
    || source.draft_revision !== target.draft_revision
    || source.published_revision !== target.published_revision
    || digest(source.draft_json) !== digest(target.draft_json)
    || digest(source.published_json) !== digest(target.published_json)) {
    throw new Error(`Staging verification failed for ${source.page_key}`);
  }
}
for (const media of sourceMedia) {
  const target = (await query(STAGING_DATABASE_ID,
    'SELECT byte_length, data_base64 FROM editor_media WHERE id = ?1', [media.id]))[0];
  if (!target || target.byte_length !== media.byte_length
    || digest(target.data_base64) !== digest(media.data_base64)) {
    throw new Error(`Staging media verification failed for ${media.id}`);
  }
}

console.log('Verified: staging editor pages and referenced media exactly match production.');
