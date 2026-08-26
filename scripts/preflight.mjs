#!/usr/bin/env node
/**
 * Deploy gate. Refuses to let a half-configured page take paid traffic.
 * Every check reports independently: one run tells you everything that is missing.
 */
import { readFileSync, readdirSync } from 'node:fs';
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

const WORKER_PAGES = ['landing.html', 'thanks.html', 'preview-checkout.html'];
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
    if (built !== template.replace(/\{\{BASE_CSS\}\}/g, () => css)) stale.push(page);
  }
  if (stale.length) {
    fail(`ThriveCart pages are stale, run \`npm run build:tc\`: ${stale.join(', ')}`);
  } else {
    pass(`${tcPages.length} ThriveCart pages built and current`);
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
