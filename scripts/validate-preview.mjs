#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../wrangler.preview.toml', import.meta.url), 'utf8');
const failures = [];
const requireMatch = (pattern, message) => {
  if (!pattern.test(config)) failures.push(message);
};

requireMatch(/^name = "yfbjj-funnel-visual-staging"$/m, 'staging Worker name is not isolated');
requireMatch(/^workers_dev = true$/m, 'workers.dev must be enabled');
requireMatch(/^PREVIEW_MODE = "true"$/m, 'PREVIEW_MODE must be exactly "true"');
requireMatch(/^PREVIEW_NO_D1 = "true"$/m, 'PREVIEW_NO_D1 must be exactly "true"');

if (/^routes\s*=|\[\[d1_databases\]\]|database_id\s*=|THRIVECART_BUNDLE_URL\s*=\s*"[^\"]+"/m.test(config)) {
  failures.push('routes, D1, or a live cart URL are forbidden in visual staging');
}

if (failures.length) {
  console.error(`PREVIEW VALIDATION FAILED\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}

console.log('PREVIEW VALIDATION PASSED');
console.log('  + isolated workers.dev name');
console.log('  + preview fail-closed flags enabled');
console.log('  + no routes, D1 binding, or cart URL');
