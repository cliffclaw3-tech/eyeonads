import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { recoveryOrigin } from '../src/lib/password-recovery.ts';

function route(user) {
  let queries = 0;
  let mailCalls = 0;
  const supabase = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => { queries++; throw new Error('tenant query must not run'); },
  };
  const testModule = { exports: {} };
  const source = fs.readFileSync('src/app/api/weekly-report/route.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, {
    module: testModule,
    exports: testModule.exports,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } };
      if (name === '@/lib/supabase/server') return { createClient: async () => supabase };
      if (name === '@/lib/password-recovery') return { recoveryOrigin };
      if (name === 'nodemailer') return { createTransport: () => { mailCalls++; throw new Error('mail must not run'); } };
      throw new Error(`Unexpected import: ${name}`);
    },
    process: { env: { NEXT_PUBLIC_APP_URL: 'https://eyeonads.example.invalid', ZOHO_SMTP_USER: 'offline', ZOHO_SMTP_PASSWORD: 'offline' } },
    console: { error() {} },
  });
  return {
    post: (body, origin = 'https://eyeonads.example.invalid') => testModule.exports.POST({ headers: { get: name => name.toLowerCase() === 'origin' ? origin : null }, json: async () => body }),
    queries: () => queries,
    mailCalls: () => mailCalls,
  };
}

test('weekly report refuses anonymous and cross-tenant requests before queries or mail', async () => {
  for (const [user, user_id, status] of [[null, 'victim', 401], [{ id: 'caller' }, 'victim', 403]]) {
    const handler = route(user);
    assert.equal((await handler.post({ user_id })).status, status);
    assert.equal(handler.queries(), 0);
    assert.equal(handler.mailCalls(), 0);
  }
});

test('weekly report rejects cross-origin authenticated requests before report queries or mail', async () => {
  const handler = route({ id: 'caller' });
  const response = await handler.post({ user_id: 'caller' }, 'https://attacker.example.invalid');
  assert.equal(response.status, 403);
  assert.equal(handler.queries(), 0);
  assert.equal(handler.mailCalls(), 0);
});
