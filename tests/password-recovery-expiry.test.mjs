import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeRecovery, INVALID_RECOVERY, RECOVERY_SECONDS } from '../src/lib/password-recovery.ts';

test('reset refuses expired JWT or recovery window before identity lookup or password mutation', async (t) => {
  const now = 2_000_000_000;
  t.mock.method(Date, 'now', () => now * 1000);
  for (const { label, exp, age, status } of [
    { label: 'just inside recovery window', exp: now + 1, age: RECOVERY_SECONDS - 1, status: 200 },
    { label: 'exact recovery deadline', exp: now + 1, age: RECOVERY_SECONDS, status: 401 },
    { label: 'past recovery deadline', exp: now + 1, age: RECOVERY_SECONDS + 1, status: 401 },
    { label: 'exact JWT expiry', exp: now, age: 0, status: 401 },
    { label: 'past JWT expiry', exp: now - 1, age: 0, status: 401 },
  ]) {
    const calls = [];
    const auth = {
      getClaims: async () => ({ data: { claims: {
        sub: 'offline-user', exp, amr: [{ method: 'recovery', timestamp: now - age }],
      } } }),
      getUser: async () => { calls.push('getUser'); return { data: { user: { id: 'offline-user' } } }; },
      updateUser: async () => { calls.push('updateUser'); return {}; },
      signOut: async ({ scope }) => { calls.push(`signOut:${scope}`); return {}; },
    };
    const result = await completeRecovery(auth, 'offline-password', 'offline-password');
    assert.equal(result.status, status, label);
    assert.deepEqual(calls, status === 200 ? ['getUser', 'updateUser', 'signOut:local'] : [], label);
    if (status === 401) assert.equal(result.error, INVALID_RECOVERY, label);
  }
});
