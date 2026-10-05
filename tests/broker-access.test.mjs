import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBroker } from '../src/lib/broker-access.ts';

const account = role => ({ from: table => {
  assert.equal(table, 'eyeonads_account_roles');
  return { select: field => {
    assert.equal(field, 'role');
    return { eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }) };
  } };
} });

test('agent role cannot open broker functions; broker role can', async () => {
  const user = { id: 'example', app_metadata: {} };
  assert.equal(await isBroker(account('agent'), user), false);
  assert.equal(await isBroker(account('broker'), user), true);
});

test('an unavailable role store fails closed; existing pilot remains a broker', async () => {
  const unavailable = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: Error('unavailable') }) }) }) }) };
  assert.equal(await isBroker(unavailable, { id: 'example', app_metadata: {} }), false);
  assert.equal(await isBroker(unavailable, { id: 'pilot', app_metadata: { eyeonads_pilot: true } }), true);
});
