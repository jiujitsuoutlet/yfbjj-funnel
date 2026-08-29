#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'https://yfbjj-funnel-visual-staging.sebastian-brosche.workers.dev';
const out = new URL('./', import.meta.url);
const viewports = [[375, 667], [375, 812], [768, 1024], [1024, 768], [1440, 900]];
const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
await mkdir(new URL('screenshots/', out), { recursive: true });

const browser = await chromium.launch();
const results = [];
for (const variant of ['a', 'b']) {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, userAgent, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    const response = await page.goto(`${base}/?v=${variant}`, { waitUntil: 'networkidle' });
    const measurement = await page.evaluate(() => {
      const required = {
        identity: '.identity', headline: 'h1', supportCopy: '.lede', approvedVisual: '.one-screen > picture img',
        collectionSummary: '.offer-count', price: '[data-price="bundle"]', leadForm: '#lead-form',
        cta: '#lead-submit', previewNotice: '#preview-banner', legalSupport: '.site-footer nav',
      };
      const elements = Object.fromEntries(Object.entries(required).map(([name, selector]) => {
        const element = document.querySelector(selector);
        if (!element) return [name, { exists: false }];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [name, {
          exists: true,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          inViewport: rect.left >= -0.5 && rect.top >= -0.5 && rect.right <= innerWidth + 0.5 && rect.bottom <= innerHeight + 0.5,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }];
      }));
      const links = [...document.querySelectorAll('.site-footer nav a')].map((link) => ({ text: link.textContent.trim(), href: link.getAttribute('href') }));
      const controls = [...document.querySelectorAll('input, button, a')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { name: element.textContent.trim() || element.getAttribute('aria-label') || element.getAttribute('name'), width: rect.width, height: rect.height };
      });
      return {
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
        elements,
        links,
        controls,
        brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc),
        config: JSON.parse(document.querySelector('#page-config').textContent),
      };
    });
    const failures = [];
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status()}`);
    if (measurement.scroll.width !== measurement.scroll.clientWidth) failures.push('horizontal page scroll');
    if (measurement.scroll.height !== measurement.scroll.clientHeight) failures.push('vertical page scroll');
    for (const [name, value] of Object.entries(measurement.elements)) {
      if (!value.exists || !value.visible || !value.inViewport) failures.push(`${name} is missing, hidden, or outside the viewport`);
    }
    if (measurement.brokenImages.length) failures.push('broken image');
    if (errors.length) failures.push('browser error');
    if (failedRequests.length) failures.push('failed request');
    if (!measurement.config.PREVIEW_MODE) failures.push('preview mode is not enabled');
    if (measurement.links.some((link) => !link.href || link.href.includes('[['))) failures.push('legal or support link contains a placeholder');
    await page.screenshot({ path: new URL(`screenshots/${variant}-${width}x${height}.png`, out).pathname });
    results.push({ kind: 'visual', variant, width, height, status: response?.status(), ...measurement, errors, failedRequests, failures, pass: failures.length === 0 });
    await context.close();
  }
}

const context = await browser.newContext({ userAgent, ignoreHTTPSErrors: true });
const page = await context.newPage();
const posts = [];
page.on('request', (request) => {
  if (request.method() === 'POST') posts.push(request.url());
});
await page.goto(`${base}/?utm_source=qa&utm_medium=linear&gclid=test-click`, { waitUntil: 'networkidle' });
const naturalVariant = await page.locator('#page-config').evaluate((node) => JSON.parse(node.textContent).VARIANT);
const firstCookie = (await context.cookies()).find((cookie) => cookie.name === 'yfbjj_v');
await page.reload({ waitUntil: 'networkidle' });
const reloadVariant = await page.locator('#page-config').evaluate((node) => JSON.parse(node.textContent).VARIANT);
await page.goto(`${base}/?v=${naturalVariant === 'a' ? 'b' : 'a'}`, { waitUntil: 'networkidle' });
const forcedVariant = await page.locator('#page-config').evaluate((node) => JSON.parse(node.textContent).VARIANT);
const cookieAfterForce = (await context.cookies()).find((cookie) => cookie.name === 'yfbjj_v');
await page.goto(base, { waitUntil: 'networkidle' });
const afterForceVariant = await page.locator('#page-config').evaluate((node) => JSON.parse(node.textContent).VARIANT);
await page.goto(`${base}/?v=a&utm_source=qa&utm_medium=linear&gclid=test-click`, { waitUntil: 'networkidle' });
await page.locator('#email').fill('qa@example.com');
await Promise.all([
  page.waitForURL((url) => url.pathname === '/preview-checkout'),
  page.locator('#lead-submit').click(),
]);
const handoffUrl = page.url();
const functional = {
  kind: 'functional', naturalVariant, reloadVariant, firstCookie: firstCookie?.value || null,
  forcedVariant, cookieAfterForce: cookieAfterForce?.value || null, afterForceVariant,
  handoffUrl, leadPosts: posts,
  cookiePersists: Boolean(firstCookie) && naturalVariant === reloadVariant && firstCookie.value === cookieAfterForce?.value && naturalVariant === afterForceVariant,
  forcedWorks: forcedVariant !== naturalVariant,
  handoffIsPreview: new URL(handoffUrl).pathname === '/preview-checkout',
  attributionSurvives: ['utm_source', 'utm_medium', 'gclid'].every((key) => new URL(handoffUrl).searchParams.has(key)),
  previewMadeNoWrite: posts.length === 0,
};
functional.failures = [
  ...(!functional.cookiePersists ? ['natural cookie did not persist'] : []),
  ...(!functional.forcedWorks ? ['forced variant did not work'] : []),
  ...(!functional.handoffIsPreview ? ['CTA did not route to preview checkout'] : []),
  ...(!functional.attributionSurvives ? ['allowed attribution query carriers were dropped at CTA handoff'] : []),
  ...(!functional.previewMadeNoWrite ? ['preview form made an external POST'] : []),
];
functional.pass = functional.failures.length === 0;
results.push(functional);
await context.close();

const api = await browser.newContext({ userAgent, ignoreHTTPSErrors: true });
const apiPage = await api.newPage();
await apiPage.goto(base, { waitUntil: 'domcontentloaded' });
for (const [name, path, method, expectedStatus, expectedError] of [
  ['checkout', '/api/checkout', 'POST', 423, 'preview_locked'],
  ['lead', '/api/lead', 'POST', 503, 'preview_state_disabled'],
  ['stats', '/api/stats', 'GET', 503, 'preview_state_disabled'],
  ['health', '/health', 'GET', 503, null],
]) {
  const result = await apiPage.evaluate(async ({ path, method }) => {
    const response = await fetch(path, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify({ email: 'qa@example.com' }) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }, { path, method });
  results.push({ kind: 'backend', name, method, path, ...result, pass: result.status === expectedStatus && (!expectedError || result.body.error === expectedError) });
}
await api.close();
await browser.close();

await writeFile(new URL('browser-results.json', out), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.pass === false)) process.exitCode = 1;
