#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8791';
const password = process.argv[3] || 'local-editor-proof';
const browser = await chromium.launch({ args: ['--disable-features=OverlayScrollbar'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(base + '/admin/login');
await page.locator('input[name=password]').fill(password);
await page.locator('button[type=submit]').click();
await page.waitForURL('**/admin/editor');
await page.locator('#save-state').filter({ hasText: /Draft|Saved/ }).waitFor();

for (const key of ['landing-a', 'landing-b']) {
  await page.selectOption('#page-select', key);
  await page.locator('#save-state').filter({ hasText: /Draft|Saved/ }).waitFor();
  await page.locator('#publish').click();
  await page.locator('#save-state').filter({ hasText: /Published/ }).waitFor();
}

await page.setInputFiles('#media-upload', 'public/img/guard-pass-400.webp');
await page.locator('#media-state').filter({ hasText: /Uploaded/ }).waitFor();
await page.locator('#analytics').click();
await page.locator('#history-panel').filter({ hasText: /Winner gate/ }).waitFor();

await page.selectOption('#page-select', 'thanks-granted');
await page.locator('#canvas').filter({ hasText: /Access your courses/ }).waitFor();

for (const width of [375, 1024]) {
  await page.setViewportSize({ width, height: 900 });
  for (const variant of ['a', 'b']) {
    await page.goto(base + '/?v=' + variant, { waitUntil: 'domcontentloaded' });
    await page.locator('text=Trusted by 15,000+ BJJ athletes').waitFor();
    await page.locator('iframe[title="Yoga for BJJ introduction"]').waitFor();
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    assert.ok(layout.page <= layout.viewport, 'horizontal overflow at ' + width + 'px variant ' + variant);
  }
}

assert.deepEqual(errors, []);
console.log('PASS editor login, publish, media upload, analytics, access CTA, and 375/1024 responsive funnel proof');
await browser.close();
