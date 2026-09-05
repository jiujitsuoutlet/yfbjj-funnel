import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultDocument } from '../src/editor/defaults.js';
import { renderContentDocument } from '../src/editor/renderer.js';

test('live and editor share the measured brand stylesheet', () => {
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /baseCss \+ brandCss/);
  assert.match(worker, /css: adminCss \+ brandCss/);
  const css = readFileSync(new URL('../src/pages/_brand.css', import.meta.url), 'utf8');
  for (const color of ['#dc2626', '#e02020', '#f3f4ee', '#0a0a0a', '#0d0d10']) assert.ok(css.includes(color));
  assert.ok(css.includes('section:not([style*="background-color"])'));
});

test('offer branding preserves locked commerce and editable text', () => {
  const document = defaultDocument('offer-lifetime');
  const result = renderContentDocument(document, {pageKey:'offer-lifetime'});
  assert.match(result.body, /data-page-key="offer-lifetime"/);
  assert.match(result.body, /data-offer-accept/);
  assert.match(result.body, /data-offer-skip/);
  assert.match(result.body, /\$247 once/);
});
