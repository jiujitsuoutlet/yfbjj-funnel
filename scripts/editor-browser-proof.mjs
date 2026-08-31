import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.EDITOR_BASE_URL || 'http://localhost:8791';
const password = process.env.EDITOR_TEST_PASSWORD;
if (!password) throw new Error('EDITOR_TEST_PASSWORD is required');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

if (process.env.EDITOR_FALLBACK_ONLY === 'true') {
  await page.goto(`${base}/?v=a`);
  assert.equal(await page.locator('.editor-page').count(), 0);
  assert.match(await page.locator('h1').textContent(), /Keep your guard/);
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  await browser.close();
  console.log('PASS malformed published JSON falls back to the compiled page in a real browser');
  process.exit(0);
}

await page.goto(`${base}/?v=a`);
await page.screenshot({ path: '/tmp/yfbjj-compiled-a-1024.png', fullPage: true });

await page.goto(`${base}/admin/login`);
await page.getByLabel('Password').fill(password);
await Promise.all([page.waitForURL('**/admin/editor'), page.getByRole('button', { name: 'Sign in' }).click()]);
await page.locator('#canvas .announce').click();
assert.match(await page.getByLabel('Text').inputValue(), /Mobility for Brazilian Jiu-Jitsu/);
await page.getByRole('button', { name: 'Mobile' }).click();
const mobileColumns = await page.locator('#canvas .editor-row').first().evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').filter(Boolean).length);
assert.equal(mobileColumns, 1);
await page.getByRole('button', { name: 'Desktop' }).click();
await page.getByText('heading:', { exact: false }).first().click();
const text = page.getByLabel('Text');
const original = await text.inputValue();
const sentence = 'Continuous sentence entry keeps focus and saves every word.';
await text.fill(sentence);
assert.equal(await text.inputValue(), sentence);
await page.getByRole('button', { name: 'Save draft' }).click();
await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.startsWith('Saved'));
await page.reload();
await page.getByText('heading:', { exact: false }).first().click();
assert.equal(await page.getByLabel('Text').inputValue(), sentence);
await page.getByLabel('Text').fill(original);
await page.getByRole('button', { name: 'Save draft' }).click();
await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.startsWith('Saved'));
await page.getByRole('button', { name: 'Publish' }).click();
await page.waitForFunction(() => document.querySelector('#save-state')?.textContent.startsWith('Published'));

for (const width of [375, 1024]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/?v=a`);
  assert.equal(await page.locator('#lead-form').count(), 1);
  assert.equal(await page.locator('.editor-background img').getAttribute('src'), '/img/guard-pass-800.webp');
  assert.match(await page.locator('.announce').textContent(), /Mobility for Brazilian Jiu-Jitsu athletes/);
  assert.equal(await page.locator('.checks ul').evaluate((node) => getComputedStyle(node).listStyleType), 'none');
  assert.equal(await page.locator('footer a').count(), 3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow at ${width}: ${overflow}`);
  const vertical = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  assert.ok(vertical <= 2, `zero-scroll layout overflow at ${width}: ${vertical}`);
  await page.screenshot({ path: `/tmp/yfbjj-published-a-${width}.png`, fullPage: true });
}

await page.goto(`${base}/?v=b`);
assert.match(await page.locator('h1').textContent(), /Your guard isn't the problem/);
assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
await browser.close();
console.log('PASS editor login, continuous edit, save, reload, publish, responsive public render, A/B copy, and console checks');
