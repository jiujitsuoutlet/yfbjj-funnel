const EVENTS = new Set(['landing_view', 'checkout_start', 'checkout_error', 'offer_view', 'offer_accept', 'offer_decline', 'access_click']);
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const VARIANTS = new Set(['a', 'b']);
const OFFERS = new Set(['bundle', 'head_to_toes', 'lifetime', 'two_month', 'certification']);

function clean(value, max = 100) {
  return typeof value === 'string' ? value.trim().slice(0, max) || null : null;
}

function clientKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

export async function recordConversionEvent(request, env) {
  if (!env.DB) return { ok: false, status: 503, error: 'analytics_unavailable' };
  let body;
  try { body = await request.json(); } catch { return { ok: false, status: 400, error: 'invalid_json' }; }
  if (!body || !EVENTS.has(body.event)) return { ok: false, status: 400, error: 'invalid_event' };
  const now = Date.now();
  const windowStart = Math.floor(now / 60000) * 60000;
  const bucket = `${clientKey(request)}:${windowStart}`;
  try {
    await env.DB.prepare(`INSERT INTO conversion_rate_limits (bucket_key, window_start, count) VALUES (?1, ?2, 1)
      ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`).bind(bucket, windowStart).run();
    const limited = await env.DB.prepare('SELECT count FROM conversion_rate_limits WHERE bucket_key = ?1').bind(bucket).first();
    if (Number(limited && limited.count) > 60) return { ok: false, status: 429, error: 'rate_limited' };
    const cleanupRoll = crypto.getRandomValues(new Uint8Array(1))[0];
    if (cleanupRoll === 0) await env.DB.prepare('DELETE FROM conversion_rate_limits WHERE window_start < ?1').bind(now - 86400000).run();
    const variant = VARIANTS.has(body.variant) ? body.variant : null;
    const offer = OFFERS.has(body.offer) ? body.offer : null;
    const device = DEVICES.has(body.device) ? body.device : null;
    await env.DB.prepare(`INSERT INTO conversion_events
      (id, event_type, variant, offer, source, device_class, utm_source, utm_medium, utm_campaign, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
      .bind(crypto.randomUUID(), body.event, variant, offer, clean(body.source, 64), device,
        clean(body.utm_source), clean(body.utm_medium), clean(body.utm_campaign), new Date(now).toISOString()).run();
    return { ok: true, status: 201 };
  } catch (error) {
    console.error('conversion event insert failed', { message: error && error.message });
    return { ok: false, status: 500, error: 'storage_failed' };
  }
}

export async function conversionSnapshot(env) {
  const rows = await env.DB.prepare(`SELECT event_type, coalesce(variant, 'unassigned') AS variant,
    coalesce(offer, '') AS offer, coalesce(source, 'direct') AS source,
    coalesce(device_class, 'unknown') AS device, count(*) AS n
    FROM conversion_events GROUP BY event_type, variant, offer, source, device`).all();
  const events = rows.results || [];
  const byVariant = {};
  const byOffer = {};
  const bySource = {};
  const byDevice = {};
  for (const row of events) {
    byVariant[row.variant] ||= {};
    byVariant[row.variant][row.event_type] = (byVariant[row.variant][row.event_type] || 0) + Number(row.n);
    if (row.offer) {
      byOffer[row.offer] ||= {};
      byOffer[row.offer][row.event_type] = (byOffer[row.offer][row.event_type] || 0) + Number(row.n);
    }
    bySource[row.source] = (bySource[row.source] || 0) + Number(row.n);
    byDevice[row.device] = (byDevice[row.device] || 0) + Number(row.n);
  }
  return { byVariant, byOffer, bySource, byDevice };
}

export const AB_DECISION_RULE = Object.freeze({
  minimum_visitors_per_variant: 500,
  minimum_purchases_per_variant: 30,
  decision: 'Choose a winner only after both gates are met. Use paid conversion as the primary metric and revenue per visitor as the tie-breaker. Do not auto-publish a winner.',
});
