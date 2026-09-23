// Read-only/invalid-input smoke checks. Never submits a recovery email or credentials.
import assert from 'node:assert/strict';
const base = process.env.RECOVERY_TEST_URL || 'http://127.0.0.1:3187';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local candidate only');
let checks = 0;
async function check(path, status, content) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual' });
  assert.equal(response.status, status);
  if (content) assert.match(await response.text(), content);
  checks++;
  return response;
}
await check('/login', 200); // Content verified in a hydrated browser (client-rendered page).
await check('/forgot-password', 200, /Send reset link/);
await check('/reset-password', 200, /This reset link is invalid or has expired/);
await check('/reset-password?invalid=1', 200, /Request a new reset link/);
await check('/signup', 200);
const dashboard = await check('/dashboard', 307);
assert.equal(new URL(dashboard.headers.get('location'), base).pathname, '/login');
for (const path of ['/auth/recovery/callback', '/auth/recovery/callback?code=bad', '/auth/recovery/callback?error=expired', '/auth/recovery/callback?code=bad&code=bad']) {
  const response = await check(path, 303);
  assert.equal(response.headers.get('location'), '/reset-password?invalid=1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}
for (const route of ['request', 'reset']) {
  const response = await fetch(`${base}/auth/recovery/${route}`, { method: 'POST', headers: { origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  checks++;
}
console.log(`PASS: ${checks} local HTTP checks; no email requests or account mutations.`);
