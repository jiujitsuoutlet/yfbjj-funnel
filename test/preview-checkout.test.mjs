import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const port = 8799;
const origin = `http://127.0.0.1:${port}`;
let worker;
let output = '';

before(async () => {
  worker = spawn(
    process.execPath,
    ['./node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  worker.stdout.on('data', (chunk) => { output += chunk; });
  worker.stderr.on('data', (chunk) => { output += chunk; });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`wrangler dev exited early:\n${output}`);
    try {
      const response = await fetch(`${origin}/preview-checkout`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`wrangler dev did not become ready:\n${output}`);
});

after(async () => {
  if (!worker || worker.exitCode !== null) return;
  worker.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => worker.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (worker.exitCode === null) worker.kill('SIGKILL');
});

test('POST /api/checkout is locked in preview mode without D1', async () => {
  const response = await fetch(`${origin}/api/checkout`, { method: 'POST' });

  assert.equal(response.status, 423);
  assert.deepEqual(await response.json(), { ok: false, error: 'preview_locked' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

for (const variant of ['a', 'b']) {
  test(`variant ${variant} preserves preview attribution and has usable legal links`, async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const writes = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
    });

    try {
      await page.goto(`${origin}/?v=${variant}&utm_source=qa&utm_medium=preview&gclid=click-123`);
      const links = await page.locator('nav[aria-label="Legal and support"] a').evaluateAll((nodes) =>
        nodes.map((node) => node.href)
      );
      assert.deepEqual(links, [
        'https://yfbjj.autocreator.ai/legal/terms',
        'https://yfbjj.autocreator.ai/legal/privacy',
        'mailto:Sebastian@yogaforbjj.net',
      ]);

      await page.locator('#email').fill('qa@example.com');
      await Promise.all([
        page.waitForURL((url) => url.pathname === '/preview-checkout'),
        page.locator('#lead-submit').click(),
      ]);
      const handoff = new URL(page.url());
      assert.equal(handoff.searchParams.get('utm_source'), 'qa');
      assert.equal(handoff.searchParams.get('utm_medium'), 'preview');
      assert.equal(handoff.searchParams.get('gclid'), 'click-123');
      assert.equal(handoff.searchParams.get('passthrough[variant]'), variant);
      assert.equal(handoff.searchParams.get('utm_content'), `variant-${variant}`);
      assert.deepEqual(writes, []);
    } finally {
      await browser.close();
    }
  });
}
