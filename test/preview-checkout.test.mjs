import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

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
