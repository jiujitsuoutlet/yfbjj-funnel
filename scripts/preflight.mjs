#!/usr/bin/env node
/**
 * Deploy gate. Refuses to let a half-configured page take paid traffic.
 * Every check reports independently: one run tells you everything that is missing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'wrangler.toml');
const LOCKED_STAGING = process.argv.includes('--locked-staging');

/** Minimal reader for this file's flat `key = "value"` shape. */
function readToml(path, staging = false) {
  const out = {};
  let section = '';
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      section = line.replace(/^\[+|\]+$/g, '');
      continue;
    }
    const productionSection = section === 'vars' || section === 'd1_databases';
    const stagingSection = staging
      && (section === 'env.staging.vars' || section === 'env.staging.d1_databases');
    if (!productionSection && !stagingSection) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    const value = rest.replace(/\s*#.*$/, '').trim().replace(/^["']|["']$/g, '');
    if (stagingSection || !(key in out)) out[key] = value;
  }
  return out;
}

const failures = [];
const passes = [];
const fail = (msg) => failures.push(msg);
const pass = (msg) => passes.push(msg);

let cfg = {};
try {
  cfg = readToml(CONFIG, LOCKED_STAGING);
} catch (err) {
  console.error(`PREFLIGHT FAILED\n  - cannot read wrangler.toml: ${err.message}`);
  process.exit(1);
}

/* 1. Stripe offer and AutoCreator entitlement mappings */
const STRIPE_PRICE_VARS = [
  'STRIPE_PRICE_BUNDLE',
  'STRIPE_PRICE_HEAD_TO_TOES',
  'STRIPE_PRICE_LIFETIME',
  'STRIPE_PRICE_TWO_MONTH',
  'STRIPE_PRICE_CERTIFICATION',
];
const AUTOCREATOR_ENTITLEMENT_VARS = [
  'AUTOCREATOR_GUARD_RETENTION_BUNDLE_SLUG',
  'AUTOCREATOR_HEAD_TO_TOES_BUNDLE_SLUG',
  'AUTOCREATOR_LIFETIME_ENTITLEMENT_TARGET',
  'AUTOCREATOR_MONTHLY_ENTITLEMENT_TARGET',
  'AUTOCREATOR_CERTIFICATION_LEVEL_1_BUNDLE_SLUG',
  'AUTOCREATOR_CERTIFICATION_LEVEL_2_BUNDLE_SLUG',
  'AUTOCREATOR_CERTIFICATION_LEVEL_3_BUNDLE_SLUG',
];

const priceIds = [];
for (const key of STRIPE_PRICE_VARS) {
  const value = String(cfg[key] || '').trim();
  if (!value) fail(`${key} is empty. Use the existing verified Stripe Price ID.`);
  else if (!/^price_[A-Za-z0-9]+$/.test(value)) fail(`${key} is not a Stripe Price ID: "${value}"`);
  else {
    priceIds.push(value);
    pass(`${key} set (${value})`);
  }
}
if (priceIds.length === STRIPE_PRICE_VARS.length && new Set(priceIds).size !== priceIds.length) {
  fail('Stripe offer mapping reuses a Price ID. Each of the five offers must map to its own verified Price.');
}

const twoMonthProduct = String(cfg.STRIPE_PRODUCT_TWO_MONTH || '').trim();
if (!twoMonthProduct) fail('STRIPE_PRODUCT_TWO_MONTH is empty. Use the verified Two-Month Access Product ID.');
else if (!/^prod_[A-Za-z0-9]+$/.test(twoMonthProduct)) fail(`STRIPE_PRODUCT_TWO_MONTH is not a Stripe Product ID: "${twoMonthProduct}"`);
else pass(`STRIPE_PRODUCT_TWO_MONTH set (${twoMonthProduct})`);

for (const key of AUTOCREATOR_ENTITLEMENT_VARS) {
  const value = String(cfg[key] || '').trim();
  if (!value) fail(`${key} is empty. Retrieve the exact grant key from authenticated AutoCreator before enabling payment.`);
  else if (/PLACEHOLDER|REPLACE_ME|\[\[/i.test(value)) fail(`${key} is still a placeholder: "${value}"`);
  else pass(`${key} set (${value})`);
}

for (const key of ['STRIPE_WEBHOOK_READY', 'AUTOCREATOR_FULFILLMENT_READY']) {
  if (LOCKED_STAGING) {
    if (cfg[key] !== 'false') fail(`${key} must remain "false" for the locked staging deployment.`);
    else pass(`${key} safely locked for initial staging`);
  } else if (cfg[key] !== 'true') {
    fail(`${key} is not the exact string "true". Complete and record the live readiness proof first.`);
  } else pass(`${key} = "true"`);
}

const stripeSource = readFileSync(join(ROOT, 'src', 'stripe.js'), 'utf8');
if (LOCKED_STAGING) {
  if (/export const FULFILLMENT_IMPLEMENTED\s*=\s*false\b/.test(stripeSource)) {
    pass('AutoCreator fulfillment remains code-locked for initial staging');
  } else {
    fail('FULFILLMENT_IMPLEMENTED must remain false for locked staging.');
  }
} else if (!/export const FULFILLMENT_IMPLEMENTED\s*=\s*true\b/.test(stripeSource)) {
  fail('AutoCreator fulfillment is not implemented. Checkout remains fail-closed until authenticated grant, read-back, retry, and lifecycle behavior is built and tested.');
} else {
  pass('AutoCreator fulfillment implementation is enabled');
}
if (!/export const AUTOCREATOR_CLIENT_IMPLEMENTED\s*=\s*true\b/.test(stripeSource)) {
  fail('The authenticated AutoCreator client is not implemented. Checkout remains fail-closed.');
} else pass('authenticated AutoCreator client implementation is enabled');
for (const key of ['STRIPE_WEBHOOK_SECRET', 'AUTOCREATOR_API_KEY']) {
  if (!stripeSource.includes(`env.${key}`)) fail(`runtime readiness no longer requires the ${key} Cloudflare Secret.`);
  else pass(`runtime readiness requires ${key} without exposing its value`);
}
const readinessMigration = readFileSync(join(ROOT, 'migrations', '0006_fulfillment_outbox.sql'), 'utf8');
if (!readinessMigration.includes('fulfillment_readiness') || !readinessMigration.includes('entitlement_outbox')) {
  fail('migration 0006 does not contain both the readiness sentinel and durable entitlement outbox.');
} else pass('readiness sentinel and durable entitlement outbox migration present');
const flowMigration = readFileSync(join(ROOT, 'migrations', '0007_offer_journey.sql'), 'utf8');
const editorMigration = readFileSync(join(ROOT, 'migrations', '0008_content_editor.sql'), 'utf8');
const certificationMigration = readFileSync(join(ROOT, 'migrations', '0009_certification_offer.sql'), 'utf8');
const autoCreatorSource = readFileSync(join(ROOT, 'src', 'autocreator.js'), 'utf8');
if (!flowMigration.includes('checkout_flows') || !flowMigration.includes('offer_transitions')) {
  fail('migration 0007 does not contain the cookie-bound offer state machine.');
} else pass('cookie-bound offer state migration present');
if (!autoCreatorSource.includes('members.grantBundleEntitlement')
  || !autoCreatorSource.includes('members.setMembership')
  || !autoCreatorSource.includes('members.listBundleEntitlements')
  || !autoCreatorSource.includes('subscriptions.getActive')) {
  fail('authenticated AutoCreator grant and read-back client paths are incomplete.');
} else pass('AutoCreator bundle and plan grant/read-back client paths present');
if (!stripeSource.includes("offerKey !== 'bundle'") || !stripeSource.includes('FLOW_COOKIE')) {
  fail('initial Checkout is not locked to Guard or the child sequence is not cookie-bound.');
} else pass('initial Checkout is Guard-only and child sequence is cookie-bound');
if (!editorMigration.includes('editor_pages') || !editorMigration.includes('editor_sessions') || !editorMigration.includes('editor_page_versions')) {
  fail('migration 0008 does not contain the editor page, session, and version tables.');
} else pass('editor migration contains page, session, and version tables');
if (!certificationMigration.includes("'certification'")
  || !certificationMigration.includes("'offer-certification'")
  || !stripeSource.includes("two_month: 'certification'")
  || !stripeSource.includes('certification: null')) {
  fail('Certification is not present in both the D1 offer constraints and server-owned sequence.');
} else pass('Certification is present in the D1 offer constraints and server-owned sequence');
if (Object.hasOwn(cfg, 'ADMIN_PASSWORD')) {
  fail('ADMIN_PASSWORD must be a Cloudflare Secret, not a wrangler.toml variable.');
} else pass('ADMIN_PASSWORD is absent from non-secret Wrangler variables');

/* 2. optional deadline: empty intentionally hides the deadline block */
const deadline = (cfg.OFFER_DEADLINE || '').trim();
if (!deadline) {
  pass('OFFER_DEADLINE intentionally unset; deadline block stays hidden');
} else {
  const when = new Date(deadline);
  if (Number.isNaN(when.getTime())) {
    fail(`OFFER_DEADLINE is not a valid date: "${deadline}". Use ISO 8601, e.g. "2026-09-01T23:59:00Z".`);
  } else if (when.getTime() <= Date.now()) {
    fail(`OFFER_DEADLINE is in the past (${when.toISOString()}). The deadline bar would not render and the offer would read as expired.`);
  } else {
    pass(`OFFER_DEADLINE set and in the future (${when.toISOString()})`);
  }
}

/* 3. preview mode off */
const preview = cfg.PREVIEW_MODE ?? 'true';
if (LOCKED_STAGING && preview === 'true') {
  pass('PREVIEW_MODE = "true" for locked staging');
} else if (LOCKED_STAGING) {
  fail(`PREVIEW_MODE must be "true" for locked staging, found "${preview}".`);
} else if (preview !== 'false') {
  fail(`PREVIEW_MODE is "${cfg.PREVIEW_MODE ?? '(unset)'}". Set PREVIEW_MODE = "false" or every CTA routes to /preview-checkout instead of the cart.`);
} else {
  pass('PREVIEW_MODE = "false"');
}

/* 4. real D1 database id */
const dbId = (cfg.database_id || '').trim();
if (!dbId || dbId === 'REPLACE_WITH_D1_DATABASE_ID') {
  fail('database_id is still the placeholder in wrangler.toml. Run `wrangler d1 create yfbjj_funnel` and paste the real id.');
} else if (!/^[0-9a-f-]{36}$/i.test(dbId)) {
  fail(`database_id does not look like a D1 uuid: "${dbId}"`);
} else {
  pass(`database_id set (${dbId})`);
}

/* 5. no unfilled copy placeholders left in any served page */
const WORKER_PAGES = ['landing-a.html', 'landing-b.html', 'offer.html', 'thanks.html', 'preview-checkout.html'];
const leftovers = [];

function sweep(label, html) {
  // Strip comments first: a commented-out example is guidance, not a leak.
  const visible = html.replace(/<!--[\s\S]*?-->/g, '');
  const hits = visible.match(/\[\[[A-Z0-9_]+[^\]]*\]\]/g) || [];
  for (const hit of new Set(hits)) leftovers.push(`${label}: ${hit}`);
}

for (const page of WORKER_PAGES) {
  try {
    sweep(page, readFileSync(join(ROOT, 'src', 'pages', page), 'utf8'));
  } catch {
    fail(`cannot read src/pages/${page}`);
  }
}

if (leftovers.length) {
  fail(`${leftovers.length} unfilled copy placeholder${leftovers.length > 1 ? 's' : ''} would render on a served page:\n      ${leftovers.join('\n      ')}`);
} else {
  pass('no unfilled copy placeholders in any served page');
}

/* 5c. both A/B variants are complete pages */
// A variant that silently lost its price block or its CTA would still render,
// and would quietly lose the test. Check the load-bearing parts of each.
for (const variant of ['a', 'b']) {
  const file = `landing-${variant}.html`;
  let page = '';
  try {
    page = readFileSync(join(ROOT, 'src', 'pages', file), 'utf8');
  } catch {
    fail(`variant ${variant.toUpperCase()} is missing: src/pages/${file}`);
    continue;
  }
  const missing = [];
  if (!page.includes('data-cart="bundle"')) missing.push('a bundle CTA');
  if (!page.includes('data-price="bundle"')) missing.push('the price block');
  if (!page.includes('id="lead-form"')) missing.push('the lead capture form');
  if (!page.includes('{{PAGE_CONFIG_JSON}}')) missing.push('the page config island');
  if (!page.includes('>8</b>') || !page.includes('mobility collections')) missing.push('the eight-collection offer summary');
  if (missing.length) fail(`variant ${variant.toUpperCase()} (${file}) is missing ${missing.join('; ')}`);
  else pass(`variant ${variant.toUpperCase()} renders complete (CTA, price, form, eight-collection offer summary)`);
}

/* 5d. the variant actually rides into Stripe Checkout metadata */
const pageJs = readFileSync(join(ROOT, 'src', 'pages', '_page.js'), 'utf8');
if (!pageJs.includes("fetch('/api/checkout'")) fail('src/pages/_page.js does not start Stripe Checkout through POST /api/checkout.');
else pass('landing page starts Stripe Checkout through the guarded first-party endpoint');
if (!pageJs.includes('variant: VARIANT') || !pageJs.includes("utm_content: VARIANT ? 'variant-' + VARIANT")) {
  fail('src/pages/_page.js does not send the assigned variant in Stripe Checkout metadata. The A/B test would measure leads, not purchases.');
} else pass('variant rides into Stripe Checkout metadata');
if (!stripeSource.includes("entitlement_key: entitlementKey")) {
  fail('src/stripe.js does not snapshot the configured AutoCreator entitlement in Checkout metadata.');
} else pass('Checkout metadata snapshots the configured AutoCreator grant key');

/* 5e. every image a page references actually exists */
// A renamed original or a skipped `npm run build:img` would otherwise ship a
// page full of broken <img> boxes to paid traffic.
const imageRefs = new Set();
const scanPages = [
  ...WORKER_PAGES.map((f) => ['src/pages', f]),
];
for (const [dir, file] of scanPages) {
  let html = '';
  try {
    html = readFileSync(join(ROOT, dir, file), 'utf8');
  } catch {
    continue;
  }
  for (const m of html.matchAll(/\/img\/([a-z0-9-]+\.(?:webp|jpg))/g)) imageRefs.add(m[1]);
}
if (imageRefs.size) {
  const broken = [...imageRefs].filter((f) => !existsSync(join(ROOT, 'public', 'img', f)));
  if (broken.length) {
    fail(`${broken.length} referenced image${broken.length > 1 ? 's are' : ' is'} missing from public/img. Run \`npm run build:img\`: ${broken.slice(0, 6).join(', ')}`);
  } else {
    pass(`${imageRefs.size} referenced image files all present in public/img`);
  }
}

/* 6. secrets scan */
try {
  execFileSync('bash', [join(ROOT, 'scripts', 'scan-secrets.sh')], { cwd: ROOT, stdio: 'pipe' });
  pass('secrets scan clean');
} catch (err) {
  const output = [err.stdout, err.stderr].filter(Boolean).map(String).join('').trim();
  fail(`secrets scan FAILED. Run \`npm run scan\` for the full output.\n      ${output.split('\n').slice(-3).join('\n      ')}`);
}

/* ------------------------------------------------------------------ report */
for (const line of passes) console.log(`  ok    ${line}`);

if (failures.length) {
  console.error(`\n${LOCKED_STAGING ? 'LOCKED STAGING ' : ''}PREFLIGHT FAILED - ${failures.length} blocker${failures.length > 1 ? 's' : ''}, do not deploy:\n`);
  failures.forEach((line, i) => console.error(`  ${i + 1}. ${line}`));
  console.error('');
  process.exit(1);
}

console.log(`\n${LOCKED_STAGING ? 'LOCKED STAGING ' : ''}PREFLIGHT PASSED - safe to deploy.`);
