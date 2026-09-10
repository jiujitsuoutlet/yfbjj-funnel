#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { renderContentDocument } from '../src/editor/renderer.js';
import { upgradeContentDocument } from '../src/editor/upgrade.js';

const baseCss = await readFile(new URL('../src/pages/_base.css', import.meta.url), 'utf8');
const brandCss = await readFile(new URL('../src/pages/_brand.css', import.meta.url), 'utf8');

const outputDir = process.argv[2] || '/private/tmp/yfbjj-triple-check';
const query = 'SELECT page_key, published_revision, published_json FROM editor_pages WHERE published_json IS NOT NULL ORDER BY page_key';
const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'yfbjj_funnel', '--remote', '--command', query, '--json'], {
  encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'inherit'],
});
const pages = JSON.parse(raw)[0].results.map((row) => ({
  key: row.page_key,
  revision: row.published_revision,
  document: upgradeContentDocument(row.page_key, JSON.parse(row.published_json)),
}));

const rendered = new Map(pages.map(({ key, revision, document }) => {
  const page = renderContentDocument(document, { pageKey: key, env: {
    BUNDLE_PRICE_CENTS: '1400', HEAD_TO_TOES_BUMP_PRICE_CENTS: '900',
  }, context: { trialEndsAt: '2026-10-06T00:00:00.000Z' } });
  return [key, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="https://welcome.yogaforbjj.net/"><style>${baseCss}\n${brandCss}</style></head><body>${page.body}<script>document.documentElement.dataset.revision=${JSON.stringify(String(revision))}</script></body></html>`];
}));

const auditMedia = {
  '/video/yoga-for-bjj-intro.mp4': 'https://vz-5ecbf445-fd1.b-cdn.net/ad1f2932-955f-4abf-85d0-01c6a065a289/play_720p.mp4',
  '/video/yoga-for-bjj-intro.jpg': 'https://vz-5ecbf445-fd1.b-cdn.net/ad1f2932-955f-4abf-85d0-01c6a065a289/thumbnail.jpg',
};
let port = 0;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (auditMedia[pathname]) {
    const headers = request.headers.range ? { Range: request.headers.range } : {};
    const upstream = httpsRequest(auditMedia[pathname], { method: request.method, headers }, (mediaResponse) => {
      response.writeHead(mediaResponse.statusCode || 502, mediaResponse.headers);
      mediaResponse.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end('media unavailable'); });
    upstream.end();
    return;
  }
  const key = pathname.slice(1);
  const html = rendered.get(key);
  response.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html ? html.replaceAll('="/video/', `="http://127.0.0.1:${port}/video/`) : 'not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
port = server.address().port;
await mkdir(outputDir, { recursive: true });

const requirements = {
  'landing-a': [/Think You're Too Busy\?/, /too busy for yoga/, /\$14/, /\+ \$9/],
  'offer-head-to-toes': [/Head to Toes/i, /\$29/],
  'offer-lifetime': [/\$247/],
  'offer-two-month': [/first 30 days/i, /\$8/, /\$19\.99/],
  'offer-certification': [/\$1,100/, /\$297/, /3-Part Instructor Certification/i],
};
const copyMistakes = [
  /\bour hips\b/, /income steam/i, /\bIm too busy\b/, /but i need it/, /14 year anniversary/i,
  /world class coaches/i, /\bJiu Jitsu\b/, /do private lessons/i, /allow you to have the ability/i,
  /Yoga For BJJ/, /program which is made/i, /programs for everywhere/i,
];
const copyIssues = new Map(pages.map(({ key, document }) => {
  const content = JSON.stringify(document);
  return [key, copyMistakes.filter((pattern) => pattern.test(content)).map(String)];
}));
const viewports = [{ width: 375, height: 812 }, { width: 768, height: 900 }, { width: 1440, height: 900 }];
const browser = await chromium.launch({ args: ['--disable-features=OverlayScrollbar'] });
const failures = [];

for (const { key, revision } of pages) {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/${key}`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
        window.scrollTo(0, y); await new Promise((resolve) => setTimeout(resolve, 20));
      }
      window.scrollTo(0, 0);
    });
    const result = await page.evaluate(() => {
      const clipped = [];
      for (const element of document.querySelectorAll('.editor-element')) {
        const rect = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!['hidden', 'clip'].includes(style.overflow) && !['hidden', 'clip'].includes(style.overflowY)) continue;
          const boundary = parent.getBoundingClientRect();
          if (rect.top < boundary.top - 2 || rect.bottom > boundary.bottom + 2) {
            clipped.push(element.dataset.editorId || element.className); break;
          }
        }
      }
      const offerRows = [...document.querySelectorAll('[data-page-key^="offer-"] .editor-row')];
      const sideBySideOfferRows = offerRows.filter((row) => {
        const columns = [...row.querySelectorAll(':scope > .editor-column')];
        return columns.length > 1 && columns.some((column, i) => i && Math.abs(column.getBoundingClientRect().top - columns[0].getBoundingClientRect().top) < 4);
      }).length;
      return {
        text: document.body.innerText,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src),
        brokenVideos: [...document.querySelectorAll('video')].filter((video) => video.error || !video.currentSrc).map((video) => ({
          src: video.currentSrc || video.getAttribute('src') || '', error: video.error?.code || 0,
        })),
        clipped: [...new Set(clipped)],
        blankButtons: [...document.querySelectorAll('button,a.cta')].filter((button) => !button.textContent.trim()).length,
        sideBySideOfferRows,
        lifetimeAccepts: document.querySelectorAll('[data-page-key="offer-lifetime"] [data-offer-accept]').length,
        lifetimeSkips: document.querySelectorAll('[data-page-key="offer-lifetime"] [data-offer-skip]').length,
        certificationAccepts: document.querySelectorAll('[data-page-key="offer-certification"] [data-offer-accept]').length,
        certificationSkips: document.querySelectorAll('[data-page-key="offer-certification"] [data-offer-skip]').length,
        imageSources: [...document.images].map((image) => image.getAttribute('src') || ''),
      };
    });
    const errors = [...runtimeErrors];
    if (copyIssues.get(key).length) errors.push(`copy: ${copyIssues.get(key).join(', ')}`);
    if (result.overflowX > 1) errors.push(`horizontal overflow ${result.overflowX}px`);
    if (result.brokenImages.length) errors.push(`${result.brokenImages.length} broken image(s)`);
    if (result.brokenVideos.length) errors.push(`broken video: ${JSON.stringify(result.brokenVideos)}`);
    if (result.clipped.length) errors.push(`clipped: ${result.clipped.join(', ')}`);
    if (result.blankButtons) errors.push(`${result.blankButtons} blank action(s)`);
    if (result.sideBySideOfferRows) errors.push(`${result.sideBySideOfferRows} two-column offer row(s)`);
    if (/Price from server configuration|Legal and support links from server|Preview Status from server/.test(result.text)) errors.push('server placeholder visible');
    for (const pattern of requirements[key] || []) if (!pattern.test(result.text)) errors.push(`missing ${pattern}`);
    if (key === 'offer-lifetime' && (result.lifetimeAccepts < 2 || result.lifetimeSkips < 2)) errors.push('missing repeated lifetime actions');
    if (key === 'offer-lifetime' && (!result.imageSources.some((src) => src.includes('keep-reading')) || result.imageSources.length < 2)) errors.push('missing lifetime text-image treatment');
    if (key === 'offer-certification' && (result.certificationAccepts < 2 || result.certificationSkips < 2)) errors.push('missing repeated certification actions');
    await page.screenshot({ path: `${outputDir}/${key}-${viewport.width}.png`, fullPage: true });
    console.log(`${key} r${revision} ${viewport.width}px ${errors.length ? `FAIL ${errors.join('; ')}` : 'PASS'}`);
    if (errors.length) failures.push({ key, revision, width: viewport.width, errors });
    await page.close();
  }
}
await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log(`SUMMARY pages=${pages.length} checks=${pages.length * viewports.length} failures=${failures.length}`);
if (failures.length) process.exitCode = 1;
