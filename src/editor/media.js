const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_BYTES = 768000;

function validSignature(bytes, type) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (type === 'image/avif') return String.fromCharCode(...bytes.slice(4, 12)).includes('ftypavif');
  return false;
}

function decode(base64) {
  try {
    const raw = atob(base64);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch { return null; }
}

export async function listMedia(env) {
  const rows = await env.DB.prepare('SELECT id, filename, content_type, byte_length, created_at FROM editor_media ORDER BY created_at DESC LIMIT 100').all();
  return (rows.results || []).map((row) => ({ ...row, url: `/media/${row.id}` }));
}

export async function mediaPaths(env) {
  const rows = await env.DB.prepare('SELECT id FROM editor_media').all();
  return (rows.results || []).map((row) => `/media/${row.id}`);
}

export async function saveMedia(env, payload, actor) {
  const filename = typeof payload.filename === 'string' ? payload.filename.trim().slice(0, 120) : '';
  const contentType = payload.contentType;
  const data = typeof payload.data === 'string' ? payload.data : '';
  if (!filename || !TYPES.has(contentType)) return { ok: false, status: 400, error: 'invalid_media' };
  const bytes = decode(data);
  if (!bytes || !bytes.length || bytes.length > MAX_BYTES || !validSignature(bytes, contentType)) return { ok: false, status: 400, error: 'invalid_media' };
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO editor_media
    (id, filename, content_type, byte_length, data_base64, created_at, created_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, filename, contentType, bytes.length, data, new Date().toISOString(), actor).run();
  return { ok: true, media: { id, filename, content_type: contentType, byte_length: bytes.length, url: `/media/${id}` } };
}

export async function serveMedia(env, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await env.DB.prepare('SELECT content_type, data_base64 FROM editor_media WHERE id = ?1').bind(id).first();
  if (!row) return null;
  const bytes = decode(row.data_base64);
  if (!bytes) return null;
  return new Response(bytes, { headers: { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
