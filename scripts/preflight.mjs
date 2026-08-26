#!/usr/bin/env node
/**
 * Deploy gate. Refuses to let a half-configured page take paid traffic.
 * Every check reports independently: one run tells you everything that is missing.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'wrangler.toml');

/** Minimal reader for this file's flat `key = "value"` shape. */
function readToml(path) {
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    const value = rest.replace(/\s*#.*$/, '').trim().replace(/^["']|["']$/g, '');
    if (!(key in out)) out[key] = value; // first wins: [vars] before any later table
  }
  return out;
}

const failures = [];
const passes = [];
const fail = (msg) => failures.push(msg);
const pass = (msg) => passes.push(msg);

let cfg = {};
try {
  cfg = readToml(CONFIG);
} catch (err) {
  console.error(`PREFLIGHT FAILED\n  - cannot read wrangler.toml: ${err.message}`);
  process.exit(1);
}

/* 1. cart link */
const cart = (cfg.THRIVECART_BUNDLE_URL || '').trim();
if (!cart) {
  fail('THRIVECART_BUNDLE_URL is empty in wrangler.toml. Paste the real ThriveCart link for the $14 bundle.');
} else if (!/^https:\/\/\S+$/.test(cart)) {
  fail(`THRIVECART_BUNDLE_URL is not an https URL: "${cart}"`);
} else {
  pass(`THRIVECART_BUNDLE_URL set (${cart})`);
}

/* 2. deadline set and still in the future */
const deadline = (cfg.OFFER_DEADLINE || '').trim();
if (!deadline) {
  fail('OFFER_DEADLINE is empty in wrangler.toml. Set the offer deadline as ISO 8601, e.g. "2026-09-01T23:59:00Z".');
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
const preview = (cfg.PREVIEW_MODE ?? 'true').trim().toLowerCase();
if (preview !== 'false') {
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

/* 5. no unfilled copy placeholders left in any page */
// ThriveCart wires its own accept and decline URLs when the page is pasted into
// its builder, so these two are expected to sit unfilled in this repo forever.
const TC_EXPECTED = new Set(['[[TC_ACCEPT_URL]]', '[[TC_DECLINE_URL]]']);

const WORKER_PAGES = ['landing-a.html', 'landing-b.html', 'thanks.html', 'preview-checkout.html'];
const leftovers = [];
const expected = [];

function sweep(label, html) {
  // Strip comments first: a commented-out example is guidance, not a leak.
  const visible = html.replace(/<!--[\s\S]*?-->/g, '');
  const hits = visible.match(/\[\[[A-Z0-9_]+[^\]]*\]\]/g) || [];
  for (const hit of new Set(hits)) {
    if (TC_EXPECTED.has(hit)) expected.push(`${label}: ${hit}`);
    else leftovers.push(`${label}: ${hit}`);
  }
}

for (const page of WORKER_PAGES) {
  try {
    sweep(page, readFileSync(join(ROOT, 'src', 'pages', page), 'utf8'));
  } catch {
    fail(`cannot read src/pages/${page}`);
  }
}

// ThriveCart pages are deliverables too, so their copy gaps are blockers as well.
let tcPages = [];
try {
  tcPages = readdirSync(join(ROOT, 'src', 'thrivecart')).filter((f) => f.endsWith('.html'));
} catch {
  /* directory is optional */
}
for (const page of tcPages) {
  sweep(`thrivecart/${page}`, readFileSync(join(ROOT, 'src', 'thrivecart', page), 'utf8'));
}

if (leftovers.length) {
  fail(`${leftovers.length} unfilled copy placeholder${leftovers.length > 1 ? 's' : ''} would render on a live page:\n      ${leftovers.join('\n      ')}`);
} else {
  pass('no unfilled copy placeholders in any page');
}
if (expected.length) {
  pass(`${expected.length} ThriveCart URL placeholder${expected.length > 1 ? 's' : ''} left unfilled on purpose (wired inside ThriveCart)`);
}

/* 5b. generated ThriveCart pages are current */
if (tcPages.length) {
  const css = readFileSync(join(ROOT, 'src', 'pages', '_base.css'), 'utf8');
  const stale = [];
  for (const page of tcPages) {
    const built = readFileSync(join(ROOT, 'src', 'thrivecart', page), 'utf8');
    let template = '';
    try {
      template = readFileSync(join(ROOT, 'src', 'thrivecart', '_src', page), 'utf8');
    } catch {
      stale.push(`${page} has no source in src/thrivecart/_src`);
      continue;
    }
    // Mirror EVERY substitution the generator makes, or this check reports
    // stale forever and stops meaning anything.
    const assetBase = (cfg.ASSET_BASE_URL || '').trim() || '[[ASSET_BASE_URL]]';
    const expected = template
      .replace(/\{\{BASE_CSS\}\}/g, () => css)
      .replace(/\{\{ASSET_BASE\}\}/g, () => assetBase);
    if (built !== expected) stale.push(page);
  }
  if (stale.length) {
    fail(`ThriveCart pages are stale, run \`npm run build:tc\`: ${stale.join(', ')}`);
  } else {
    pass(`${tcPages.length} ThriveCart pages built and current`);
  }
}

/* 5c. both A/B variants are complete pages */
// A variant that silently lost its price block or its CTA would still render,
// and would quietly lose the test. Check the load-bearing parts of each.
const COLLECTIONS = [
  'Guard Flexibility', 'Guard Program', 'Inverted Guard', 'Hip Program',
  'Stiffest Hips', 'Hip Flexor Rehab', 'Stiffest Legs', "I'm too busy for Yoga",
];
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
  const absent = COLLECTIONS.filter((c) => !page.includes(c));
  if (absent.length) missing.push(`${absent.length} of the 8 collections (${absent.join(', ')})`);
  if (missing.length) fail(`variant ${variant.toUpperCase()} (${file}) is missing ${missing.join('; ')}`);
  else pass(`variant ${variant.toUpperCase()} renders complete (CTA, price, form, all 8 collections)`);
}

/* 5d. the variant actually rides the outbound cart URL */
// This is the check that protects the whole test: without the parameter the
// experiment measures clicks instead of money.
const pageJs = readFileSync(join(ROOT, 'src', 'pages', '_page.js'), 'utf8');
const appendsVariant = pageJs.includes('passthrough[variant]');
if (!appendsVariant) {
  fail('src/pages/_page.js no longer appends passthrough[variant] to the cart URL. The A/B test would measure clicks, not purchases.');
} else if (preview !== 'false') {
  pass('variant passthrough present in _page.js (not exercised while PREVIEW_MODE is on)');
} else if (!cart) {
  pass('variant passthrough present in _page.js (no cart URL to test against yet)');
} else {
  // Simulate exactly what the page does at click time.
  try {
    const built = new URL(cart);
    built.searchParams.set('passthrough[variant]', 'b');
    built.searchParams.set('utm_content', 'variant-b');
    const round = new URL(built.toString());
    if (round.searchParams.get('passthrough[variant]') !== 'b') {
      fail(`the variant parameter does not survive on the cart URL: ${built.toString()}`);
    } else {
      pass(`variant rides the cart URL (${built.toString()})`);
    }
  } catch (err) {
    fail(`cannot build a cart URL from THRIVECART_BUNDLE_URL: ${err.message}`);
  }
}

/* 5e. every image a page references actually exists */
// A renamed original or a skipped `npm run build:img` would otherwise ship a
// page full of broken <img> boxes to paid traffic.
const imageRefs = new Set();
const scanPages = [
  ...WORKER_PAGES.map((f) => ['src/pages', f]),
  ...tcPages.map((f) => ['src/thrivecart', f]),
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
  console.error(`\nPREFLIGHT FAILED - ${failures.length} blocker${failures.length > 1 ? 's' : ''}, do not deploy:\n`);
  failures.forEach((line, i) => console.error(`  ${i + 1}. ${line}`));
  console.error('');
  process.exit(1);
}

console.log('\nPREFLIGHT PASSED - safe to deploy.');
