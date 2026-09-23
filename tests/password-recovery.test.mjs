import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server.js';
import * as recovery from '../src/lib/password-recovery.ts';
import { passwordError, recoveryOrigin, freshRecoveryClaims, hasRecoverySession, requestRecovery, exchangeRecovery, completeRecovery, RECOVERY_MESSAGE } from '../src/lib/password-recovery.ts';

function fixture(overrides = {}) {
  const calls = [];
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    getClaims: async () => ({ data: { claims: { sub: 'isolated-test', exp: now + 3600, amr: [{ method: 'recovery', timestamp: now }] } } }),
    getUser: async () => ({ data: { user: { id: 'isolated-test' } } }),
    exchangeCodeForSession: async () => ({ data: { session: {}, redirectType: 'recovery' } }),
    updateUser: async () => { calls.push('update'); return {}; },
    signOut: async (options) => { calls.push(options.scope); return {}; },
    ...overrides,
  };
  return { auth, calls };
}

test('password boundaries, whitespace and confirmation are enforced', () => {
  for (const value of [undefined, null, {}, '', 'short', '        ', 'x'.repeat(129)]) assert.ok(passwordError(value, value));
  assert.ok(passwordError('synthetic-example', 'mismatch'));
  assert.equal(passwordError('x'.repeat(8), 'x'.repeat(8)), null);
  assert.equal(passwordError('x'.repeat(128), 'x'.repeat(128)), null);
});
test('redirect origin must be configured and safe; never accepts an arbitrary path', () => {
  assert.equal(recoveryOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(recoveryOrigin('https://eyeonads.com/'), 'https://eyeonads.com');
  for (const value of [undefined, 'https://evil.test/path', 'http://evil.test', 'https://user@evil.test', 'https://eyeonads.com/?next=evil']) assert.throws(() => recoveryOrigin(value));
});
test('signed recovery claims must be fresh; normal sign-in claims cannot reset', () => {
  const claims = { exp: 3000, amr: [{ method: 'recovery', timestamp: 1000 }] };
  assert.equal(freshRecoveryClaims(claims, 1001), true);
  assert.equal(freshRecoveryClaims(claims, 1900), false);
  assert.equal(freshRecoveryClaims(claims, 999), false);
  assert.equal(freshRecoveryClaims({ ...claims, exp: 1001 }, 1001), false);
  assert.equal(freshRecoveryClaims({ exp: 3000, amr: [{ method: 'password', timestamp: 1000 }] }, 1001), false);
  for (const amr of [null, {}, [null], [{ method: 'recovery', timestamp: '1000' }]]) assert.equal(freshRecoveryClaims({ exp: 3000, amr }, 1001), false);
});
test('request success, nonexistent account, rate limit and transport errors are indistinguishable', async () => {
  for (const behavior of ['ok', 'missing', 'rate', 'throw']) {
    const auth = { resetPasswordForEmail: async (_email, options) => {
      assert.equal(options.redirectTo, 'http://localhost:3000/auth/recovery/callback');
      if (behavior === 'throw') throw new Error('private provider detail');
      return { error: behavior === 'ok' ? null : { message: 'private provider detail' } };
    } };
    assert.equal(await requestRecovery(auth, 'isolated@example.invalid', 'http://localhost:3000'), RECOVERY_MESSAGE);
  }
});
test('missing and malformed callback codes never reach provider', async () => {
  const { auth } = fixture({ exchangeCodeForSession: () => { throw new Error('must not run'); } });
  for (const code of [null, '', 'bad', '../malformed', 'x'.repeat(513)]) assert.equal(await exchangeRecovery(auth, code), false);
});
test('callback requires successful PKCE exchange and verified recovery session', async () => {
  const code = 'synthetic-code-00000000';
  assert.equal(await exchangeRecovery(fixture().auth, code), true);
  for (const result of [{ data: { session: null } }, { error: {}, data: { session: {} } }]) {
    assert.equal(await exchangeRecovery(fixture({ exchangeCodeForSession: async () => result }).auth, code), false);
  }
  assert.equal(await exchangeRecovery(fixture({ getClaims: async () => ({ error: {}, data: null }) }).auth, code), false);
});
test('revoked sessions, invalid signatures and identity mismatch fail closed', async () => {
  for (const overrides of [
    { getClaims: async () => ({ error: {}, data: null }) },
    { getClaims: async () => { throw new Error('offline'); } },
    { getUser: async () => ({ error: {}, data: { user: null } }) },
    { getUser: async () => ({ data: { user: { id: 'other' } } }) },
  ]) {
    const { auth, calls } = fixture(overrides);
    assert.equal(await hasRecoverySession(auth), false);
    assert.equal((await completeRecovery(auth, 'synthetic-example', 'synthetic-example')).status, 401);
    assert.deepEqual(calls, []);
  }
});
test('server validation prevents update; successful reset signs out recovery session only', async () => {
  const { auth, calls } = fixture();
  assert.equal((await completeRecovery(auth, 'short', 'short')).status, 400);
  assert.equal((await completeRecovery(auth, 'synthetic-example', 'mismatch')).status, 400);
  assert.deepEqual(calls, []);
  assert.equal((await completeRecovery(auth, 'synthetic-example', 'synthetic-example')).status, 200);
  assert.deepEqual(calls, ['update', 'local']);
});
test('provider password errors are sanitized and do not report success', async () => {
  const { auth, calls } = fixture({ updateUser: async () => ({ error: { message: 'sensitive detail' } }) });
  const result = await completeRecovery(auth, 'synthetic-example', 'synthetic-example');
  assert.equal(result.status, 400);
  assert.ok(!result.error.includes('sensitive detail'));
  assert.deepEqual(calls, []);
});

// Execute the actual handlers, cookie adapter and PKCE SDK. Only the provider's
// transport and Next's request cookie store are replaced; no network is used.
function offlineRecovery(t) {
  const now = 2_000_000_000;
  t.mock.method(Date, 'now', () => now * 1000);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  const origin = 'https://recovery.example.invalid';
  const code = 'offline-single-use-recovery-code';
  const calls = [];
  let challenge;
  let consumed = false;
  const user = { id: 'offline-user', aud: 'authenticated', role: 'authenticated', email: 'offline@example.invalid' };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', exp: now + 3600, amr: [{ method: 'recovery', timestamp: now }] })}.c3ludGhldGlj`;
  async function provider(url, options) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://auth.example.invalid');
    const action = `${options.method} ${parsed.pathname}`;
    calls.push(action);
    const body = options.body ? JSON.parse(options.body) : null;
    if (action === 'POST /auth/v1/recover') {
      assert.equal(body.code_challenge_method, 's256');
      challenge = body.code_challenge;
      return Response.json({});
    }
    if (action === 'POST /auth/v1/token') {
      assert.equal(parsed.searchParams.get('grant_type'), 'pkce');
      if (consumed || body.auth_code !== code || createHash('sha256').update(body.code_verifier).digest('base64url') !== challenge) {
        return Response.json({ code: 'invalid_grant', msg: 'Synthetic consumed or invalid recovery code' }, { status: 400 });
      }
      consumed = true;
      return Response.json({ access_token: token, refresh_token: 'offline-refresh-token', token_type: 'bearer', expires_in: 3600, user });
    }
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (action === 'GET /auth/v1/user') return Response.json(user);
    if (action === 'PUT /auth/v1/user') {
      assert.equal(body.password, 'offline-new-password');
      return Response.json(user);
    }
    if (action === 'POST /auth/v1/logout') {
      assert.equal(parsed.searchParams.get('scope'), 'local');
      return Response.json({});
    }
    assert.fail(`Unexpected offline provider operation: ${action}`);
  }
  function load(path, imports) {
    const testModule = { exports: {} };
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(js, {
      module: testModule, exports: testModule.exports, URL,
      process: { env: { NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-anon-key' } },
      require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`); return imports[name]; },
    });
    return testModule.exports;
  }
  function browser() {
    const jar = new Map([['ordinary-auth-cookie', 'unchanged']]);
    const store = {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name, value, options) => options.maxAge === 0 ? jar.delete(name) : jar.set(name, value),
      delete: (name) => jar.delete(name),
    };
    const adapter = load('../src/lib/supabase/recovery.ts', {
      '@supabase/ssr': { createServerClient: (url, key, options) => createServerClient(url, key, { ...options, global: { fetch: provider } }) },
      'next/headers': { cookies: async () => store },
      '@/lib/password-recovery': recovery,
    });
    const imports = { 'next/server': { NextResponse }, '@/lib/supabase/recovery': adapter, '@/lib/password-recovery': recovery };
    const callback = load('../src/app/auth/recovery/callback/route.ts', imports).GET;
    const reset = load('../src/app/auth/recovery/reset/route.ts', imports).POST;
    const request = load('../src/app/auth/recovery/request/route.ts', imports).POST;
    const post = (body) => ({ headers: new Headers({ origin }), json: async () => body });
    return {
      jar,
      request: () => request(post({ email: user.email })),
      callback: () => callback({ nextUrl: new URL(`${origin}/auth/recovery/callback?code=${code}`) }),
      reset: () => reset(post({ password: 'offline-new-password', confirmation: 'offline-new-password' })),
    };
  }
  return { browser, calls };
}

function assertCallback(response, valid) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), valid ? '/reset-password' : '/reset-password?invalid=1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}

function assertCleared(browser) {
  assert.deepEqual([...browser.jar], [['ordinary-auth-cookie', 'unchanged']]);
}

test('consumed callback replay fails closed even with a residual recovery session and copied verifier', async (t) => {
  const { browser, calls } = offlineRecovery(t);
  const original = browser();
  assert.equal((await original.request()).status, 200);
  const verifier = original.jar.get('eyeonads-recovery-code-verifier');
  assert.ok(verifier);
  assertCallback(await original.callback(), true);
  assert.equal(original.jar.has('eyeonads-recovery-code-verifier'), false);
  // Force the consumed-code path at the provider instead of stopping at the SDK's
  // missing-verifier guard, while retaining the otherwise valid recovery session.
  original.jar.set('eyeonads-recovery-code-verifier', verifier);
  assertCallback(await original.callback(), false);
  assertCleared(original);
  const response = await original.reset();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: recovery.INVALID_RECOVERY });
  assert.equal(calls.filter((call) => call === 'POST /auth/v1/token').length, 2);
  assert.equal(calls.filter((call) => call === 'PUT /auth/v1/user').length, 0);
});

test('successful reset consumes browser recovery state; reset and callback replays cannot mutate again', async (t) => {
  const { browser, calls } = offlineRecovery(t);
  const original = browser();
  assert.equal((await original.request()).status, 200);
  assertCallback(await original.callback(), true);
  const first = await original.reset();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });
  assertCleared(original);
  const beforeReplay = [...calls];
  const replay = await original.reset();
  assert.equal(replay.status, 401);
  assert.deepEqual(await replay.json(), { error: recovery.INVALID_RECOVERY });
  assert.equal(replay.headers.get('cache-control'), 'no-store');
  assertCallback(await original.callback(), false);
  assertCleared(original);
  assert.deepEqual(calls, beforeReplay);
  assert.equal(calls.filter((call) => call === 'PUT /auth/v1/user').length, 1);
  assert.equal(calls.filter((call) => call === 'POST /auth/v1/logout').length, 1);
});

test('wrong browser without original PKCE verifier/session cannot exchange or reset; original still works', async (t) => {
  const { browser, calls } = offlineRecovery(t);
  const original = browser();
  const otherDevice = browser();
  assert.equal((await original.request()).status, 200);
  assert.ok(original.jar.has('eyeonads-recovery-code-verifier'));
  assertCleared(otherDevice);
  const beforeWrongBrowser = [...calls];
  assertCallback(await otherDevice.callback(), false);
  const response = await otherDevice.reset();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: recovery.INVALID_RECOVERY });
  assertCleared(otherDevice);
  assert.deepEqual(calls, beforeWrongBrowser);
  assertCallback(await original.callback(), true);
  assert.equal((await original.reset()).status, 200);
  assertCleared(original);
  assert.equal(calls.filter((call) => call === 'PUT /auth/v1/user').length, 1);
});
