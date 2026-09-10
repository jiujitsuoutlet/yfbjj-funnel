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

test('published landing hero grows with edited copy instead of clipping it', () => {
  const css = readFileSync(new URL('../src/pages/_base.css', import.meta.url), 'utf8');
  assert.match(css, /\.editor-page \.editor-preset-landing-hero\{height:auto;min-height:calc\(100dvh - 8\.5rem\)/);
  assert.match(css, /\.editor-page \.editor-preset-landing-hero\{height:auto;min-height:max\(40rem,calc\(100dvh - 6rem\)\)\}/);
  assert.doesNotMatch(css, /\.editor-page \.editor-preset-landing-hero\{height:calc\(100dvh/);
  assert.doesNotMatch(css, /\.editor-page \.editor-preset-landing-hero \.editor-section-inner\{height:100%/);
});

test('offer layouts establish readable rhythm and neutralize legacy negative spacing', () => {
  const css = readFileSync(new URL('../src/pages/_brand.css', import.meta.url), 'utf8');
  assert.match(css, /data-page-key\^="offer-"\] \.editor-column[\s\S]*?display:flex;flex-direction:column;gap:/);
  assert.match(css, /\[data-editor-id="offer-two-heading"\][\s\S]*?margin-top:0!important;margin-bottom:0!important/);
  assert.match(css, /\[data-editor-id="offer-two-copy"\][\s\S]*?\[data-editor-id="offer-two-month-facts"\][\s\S]*?margin-top:0!important;margin-bottom:0!important/);
});

test('coded landing fallbacks do not restore known copy mistakes', () => {
  const defaults = readFileSync(new URL('../src/editor/defaults.js', import.meta.url), 'utf8');
  const landingA = readFileSync(new URL('../src/pages/landing-a.html', import.meta.url), 'utf8');
  const landingB = readFileSync(new URL('../src/pages/landing-b.html', import.meta.url), 'utf8');
  const brandPreview = readFileSync(new URL('../scripts/brand-preview.mjs', import.meta.url), 'utf8');
  for (const source of [defaults, landingA, landingB, brandPreview]) {
    assert.doesNotMatch(source, /\bIm too busy\b|but i need it|14 year anniversary/);
  }
});
