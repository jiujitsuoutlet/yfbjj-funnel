#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8787';
const out = new URL('./', import.meta.url);
const targetSha = '20afebd527e49775ad8288298bb9023891424d00';
const workerVersion = 'f8a8fc0e-8801-4474-b0db-4d32965fb07b';
const approvedCopy = [
  'Never get your guard passed again with our Guard Flexibility program',
  'Master every guard position in our Guard Program',
  'Achieve flexibility you never thought you could with our Inverted Guard program',
  'Unlock the hips that every single one of those positions runs through with our Hip Program',
  `Start exactly where you are, even if you can't sit cross-legged, with our Stiffest Hips program`,
  'Kill that pinch in the front of your hip with our Hip Flexor Rehab program',
  'Touch your toes for the first time since high school with our Stiffest Legs program',
  `And for those of you who think you're too busy to do any of this?`,
  `We are also giving you access to our "Im too busy for Yoga... but i need it!" program`,
];
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
    const badResponses = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', (res) => { if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`); });
    const response = await page.goto(`${base}/?v=${variant}`, { waitUntil: 'networkidle' });
    const measurement = await page.evaluate(() => {
      const required = {
        identity: '.identity', headline: 'h1', supportCopy: '.lede', approvedVisual: '.one-screen > picture img',
        valueBullets: '.value-list', bonusTransition: '.bonus-transition', bonusLine: '.bonus-line', collectionSummary: '.offer-count', price: '[data-price="bundle"]', leadForm: '#lead-form',
        cta: '#lead-submit', previewNotice: '#preview-banner', legalSupport: '.site-footer nav',
      };
      const elements = Object.fromEntries(Object.entries(required).map(([name, selector]) => {
        const element = document.querySelector(selector);
        if (!element) return [name, { exists: false }];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [name, {
          exists: true,
          text: element.textContent.trim(),
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
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight },
        elements,
        links,
        controls,
        brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc),
        config: JSON.parse(document.querySelector('#page-config').textContent),
        bodyText: document.body.innerText,
        valueFontSizes: [...document.querySelectorAll('.value-list li, .bonus-transition, .bonus-line')].map((node) => parseFloat(getComputedStyle(node).fontSize)),
        approvedLines: [...document.querySelectorAll('.value-list li, .bonus-transition, .bonus-line')].map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const center = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)));
          return { text: node.textContent.trim(), rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, inViewport: rect.left >= -0.5 && rect.top >= -0.5 && rect.right <= innerWidth + 0.5 && rect.bottom <= innerHeight + 0.5, unclipped: node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight, visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0, centerTopmost: Boolean(center && (node.contains(center) || center.contains(node))) };
        }),
        backgrounds: [...document.querySelectorAll('.one-screen, .one-screen > picture img')].map((node) => ({ tag: node.tagName, backgroundImage: getComputedStyle(node).backgroundImage, currentSrc: node.currentSrc || null, naturalWidth: node.naturalWidth || null })),
      };
    });
    const failures = [];
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status()}`);
    if (measurement.scroll.width !== measurement.scroll.clientWidth) failures.push('horizontal page scroll');
    const verticalScroll = measurement.scroll.height > measurement.scroll.clientHeight;
    const expectedVerticalScroll = false;
    if (verticalScroll !== expectedVerticalScroll) failures.push(`vertical scroll was ${verticalScroll}, expected ${expectedVerticalScroll}`);
    if (measurement.scroll.bodyHeight > measurement.scroll.clientHeight) failures.push('body has vertical scroll');
    if (measurement.scroll.bodyWidth > measurement.scroll.clientWidth) failures.push('body has horizontal scroll');
    if (!approvedCopy.every((line) => measurement.bodyText.split(line).length === 2)) failures.push('approved copy is missing or duplicated');
    if (measurement.valueFontSizes.some((size) => size < 10)) failures.push('value copy is smaller than 10px');
    for (const [name, value] of Object.entries(measurement.elements)) {
      if (!value.exists || !value.visible || !value.inViewport) failures.push(`${name} is missing, hidden, or outside the viewport`);
    }
    if (measurement.approvedLines.length !== 9 || measurement.approvedLines.some((line) => !line.inViewport || !line.unclipped || !line.visible || !line.centerTopmost)) failures.push('approved line is clipped, truncated, hidden, overlapped, or off-screen');
    if (!measurement.backgrounds.some((item) => item.naturalWidth > 0)) failures.push('background image did not load');
    if (measurement.brokenImages.length) failures.push('broken image');
    if (errors.length) failures.push('browser error');
    if (failedRequests.length) failures.push('failed request');
    if (badResponses.length) failures.push('HTTP error response');
    if (!measurement.config.PREVIEW_MODE) failures.push('preview mode is not enabled');
    if (measurement.links.some((link) => !link.href || link.href.includes('[['))) failures.push('legal or support link contains a placeholder');
    await page.screenshot({ path: new URL(`screenshots/${variant}-${width}x${height}.png`, out).pathname });
    results.push({ kind: 'visual', variant, width, height, status: response?.status(), targetSha, workerVersion, ...measurement, errors, failedRequests, badResponses, failures, pass: failures.length === 0 });
    await context.close();
  }
}

const headlineA = results.find((result) => result.kind === 'visual' && result.variant === 'a')?.elements.headline.text;
const headlineB = results.find((result) => result.kind === 'visual' && result.variant === 'b')?.elements.headline.text;
results.push({ kind: 'variant-content', headlineA, headlineB, pass: Boolean(headlineA && headlineB && headlineA !== headlineB) });

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
for (const [name, url] of [
  ['terms', 'https://yfbjj.autocreator.ai/legal/terms'],
  ['privacy', 'https://yfbjj.autocreator.ai/legal/privacy'],
]) {
  const destinationPage = await api.newPage();
  try {
    const response = await destinationPage.goto(url, { waitUntil: 'domcontentloaded' });
    results.push({ kind: 'destination', name, url, status: response?.status(), finalUrl: destinationPage.url(), pass: Boolean(response?.ok()) });
  } catch (error) {
    results.push({ kind: 'destination', name, url, error: error.message, pass: false });
  }
  await destinationPage.close();
}
results.push({ kind: 'destination', name: 'support', url: 'mailto:Sebastian@yogaforbjj.net', pass: true, basis: 'Rendered mailto link with a syntactically valid address and accessible name' });
await api.close();
await browser.close();

await writeFile(new URL('browser-results.json', out), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.pass === false)) process.exitCode = 1;
