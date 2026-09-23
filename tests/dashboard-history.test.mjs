import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('dashboard reads only the signed-in user’s persisted scans in newest-first order', async () => {
  const calls = [];
  const scans = [{ id: 'saved-scan-2', user_id: 'signed-in-user', result: 'yellow', flags: [], ai_explanation: 'Saved fixture', scanned_at: '2026-09-22T12:00:00.000Z' }];
  function query(table) {
    const result = table === 'user_profiles'
      ? { data: { full_name: 'Fixture Admin', state: 'TN', subscription_tier: 'free' } }
      : { data: scans };
    const chain = {
      select() { calls.push([table, 'select']); return chain; },
      eq(column, value) { calls.push([table, 'eq', column, value]); return chain; },
      order(column, options) { calls.push([table, 'order', column, options]); return chain; },
      limit(value) { calls.push([table, 'limit', value]); return chain; },
      single() { return Promise.resolve(result); },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return chain;
  }
  const moduleHolder = { exports: {} };
  const source = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    module: moduleHolder,
    exports: moduleHolder.exports,
    require(name) {
      if (name === 'next/navigation') return { redirect: () => { throw Error('unexpected redirect'); } };
      if (name === 'next/link') return ({ children }) => children;
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'signed-in-user', email: 'fixture@example.invalid' } } }) }, from: query }) };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  await moduleHolder.exports.default();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([table]) => table === 'compliance_scans'))), [
    ['compliance_scans', 'select'],
    ['compliance_scans', 'eq', 'user_id', 'signed-in-user'],
    ['compliance_scans', 'order', 'scanned_at', { ascending: false }],
    ['compliance_scans', 'limit', 5],
  ]);
  assert.ok(!source.includes('ad_accounts'));
});
