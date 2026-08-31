#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8787';
const out = process.argv[3] || 'artifacts/after';
const pages = [
  ['landing-a', '/?v=a'],
  ['landing-b', '/?v=b'],
  ['thanks', '/thanks'],
  ['preview-checkout', '/preview-checkout'],
];
const widths = [375, 768, 1024, 1440];
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--disable-features=OverlayScrollbar'] });
let failed = false;
for (const width of widths) {
  for (const [name, path] of pages) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).length,
    }));
    await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
    const status = response?.status() || 0;
    if (status >= 400) errors.push(`HTTP ${status}`);
    if (layout.page > layout.viewport) errors.push(`horizontal overflow ${layout.page - layout.viewport}px`);
    if (layout.brokenImages) errors.push(`${layout.brokenImages} broken image(s)`);
    const result = errors.length ? `FAIL ${errors.join('; ')}` : 'PASS';
    console.log(`${name} ${width}px ${result}`);
    if (errors.length) failed = true;
    await page.close();
  }
}
await browser.close();
if (failed) process.exitCode = 1;
