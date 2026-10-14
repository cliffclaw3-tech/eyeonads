import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterCsv } from '../src/lib/roster-csv.ts';

test('reads common roster columns, quoted commas and repeated rows', () => {
  const csv = '\uFEFFFirst Name,Last Name,Email Address,Office\r\n"Anne Marie",Oakes,anne@example.com,"Jonesborough, TN"\r\nBethany,Wisdom,bethany@example.com,Knoxville\r\nBethany,Wisdom,bethany@example.com,Knoxville';
  assert.deepEqual(parseRosterCsv(csv), [
    { name: 'Anne Marie Oakes', email: 'anne@example.com', social_url: '', office: 'Jonesborough, TN' },
    { name: 'Bethany Wisdom', email: 'bethany@example.com', social_url: '', office: 'Knoxville' },
  ]);
});

test('rejects malformed and empty rosters instead of presenting a false success', () => {
  assert.throws(() => parseRosterCsv('Name,Email\n"Unclosed,agent@example.com'), /unfinished quoted field/);
  assert.throws(() => parseRosterCsv('Email\nagent@example.com'), /Name column/);
  assert.throws(() => parseRosterCsv('Name,Email\nJane Smith,wrong'), /email address/);
  assert.throws(() => parseRosterCsv('Name,Email\n'), /No agent names/);
});
