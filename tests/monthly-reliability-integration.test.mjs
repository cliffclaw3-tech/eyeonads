import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function moduleAt(file, stubs = {}, env = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(js, { exports, require: name => Object.hasOwn(stubs, name) ? stubs[name] : require(name), process: { env }, console, URL, Request, Response, Headers, AbortSignal, Buffer, setTimeout, clearTimeout, Date, Error, fetch: () => { throw Error('Real network forbidden in integration tests'); } });
  return exports;
}
const engine = moduleAt('lib/reliability-canary/engine.ts');
const delivery = moduleAt('lib/reliability-canary/delivery.ts');
function adapters({ page, review, response, env = {} } = {}) {
  let request, assessArgs;
  const m = moduleAt('lib/reliability-canary/adapters.ts', {
    openai: { default: class { async post(path, args) { request = { path, args }; return response ?? { status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }], output_text: JSON.stringify({ urls: [], notes: [], complete: true }) }; } } },
    '../public-page': { publicURL: value => { const u = new URL(value); if (u.hostname === '127.0.0.1') throw Error(); return u; }, readPublicPage: async () => { if (page instanceof Error) throw page; return page; }, publicPageFailure: e => ({ cause_code: e.message }) },
    '../ad-review': { reviewAdText: async (...args) => { assessArgs = args; return review || { flags: [], summary: 'No issues detected' }; } },
    './engine': engine,
  }, { OPENAI_API_KEY: 'stub', EYEONADS_PAID_ANALYSIS_ENABLED: '1', SENDGRID_API_KEY: 'stub', ...env });
  return { ...m, request: () => request, assessArgs: () => assessArgs };
}
const report = { version: 1, ownerId: 'owner', period: '2026-09', completedAt: '2026-09-23T22:00:00Z', outcome: 'blocked', discovery: { status: 'blocked', reason: '<not published>' }, retrieval: { status: 'blocked', reason: 'No public test' }, assessment: { status: 'blocked', reason: 'Controls only' }, canaryAssessment: { status: 'blocked', reason: 'No text' }, controls: [{ id: 'clean', kind: 'clean', stage: { status: 'pass', reason: 'Clean' } }], metrics: { recall: null, targetsFoundBlind: 0, knownPublicTargets: 0, controlsPassed: 1 }, limitations: ['Not legal approval'] };
test('monthly blind adapter strips hidden answers and tolerates gateway JSON envelope', async () => {
  const m = adapters({ response: JSON.stringify({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: {sources:[{url:'https://www.facebook.com/person/posts/123'}]} }], output_text: JSON.stringify({ urls: ['https://www.facebook.com/person/posts/123'], notes: [], complete: true }) }) });
  const result = await m.createCanaryDependencies().discover({ brokerage: 'Firm', office: 'Jonesborough', agentNames: ['Agent'], state: 'TN', publicCanaryUrl: 'SECRET_URL', requiredLabel: 'SECRET_LABEL', expectedFindingCodes: ['SECRET_EXPECTED'] });
  assert.equal(result.urls.length, 1); const sent = JSON.stringify(m.request());
  assert.equal(m.request().path, '/responses'); assert(!sent.includes('SECRET')); assert(sent.includes('Agent'));
});
test('monthly retrieval needs same-post canonical and one explicit author identity', async () => {
  const url = 'https://www.facebook.com/broker/posts/123';
  const base = { text: 'COMPLIANCE TEST — FICTIONAL visible post text', url, retrieved_at: '2026-09-23T22:00:00Z', sha256: 'hash' };
  for (const metadata of [undefined, { canonical_url: url, author_urls: [] }, { canonical_url: url, author_urls: ['https://www.facebook.com/broker'], canonical_conflict: true }, { canonical_url: 'https://www.facebook.com/broker/posts/456', author_urls: ['https://www.facebook.com/broker'] }, { canonical_url: url, author_urls: ['https://www.facebook.com/broker', 'https://www.facebook.com/other'] }]) {
    const r = await adapters({ page: { ...base, source_metadata: metadata } }).createCanaryDependencies().retrieve(url);
    assert.equal(r.targetId, undefined);
  }
  const r = await adapters({ page: { ...base, source_metadata: { canonical_url: url, author_urls: ['https://www.facebook.com/broker'], bound_post: {url,text:base.text,author_urls:['https://www.facebook.com/broker']} } } }).createCanaryDependencies().retrieve(url);
  assert.equal(r.targetId, 'facebook:publisher:broker'); assert.match(r.reason, /do not prove account ownership/);
});
test('monthly forbidden source is blocked without inferring target or publication', async () => {
  const r = await adapters({ page: Error('forbidden') }).createCanaryDependencies().retrieve('https://www.facebook.com/broker/posts/123');
  assert.equal(r.status, 'blocked'); assert.equal(r.public, false); assert.equal(r.targetId, undefined);
});
test('monthly assessment uses same reviewer without expected-result instructions', async () => {
  const m = adapters({ review: { flags: [{ rule: 'Fair housing discrimination', explanation: 'Excludes children' }, { rule: 'Unknown substantive issue', explanation: 'Other issue' }], summary: 'Review needed' } });
  const r = await m.createCanaryDependencies().assess({ text: 'Draft', state: 'TN', imageEvidence: [] });
  assert.deepEqual(Array.from(r.findingCodes), ['housing_discrimination', 'other_substantive_issue']);
  assert.equal(m.assessArgs()[0], 'Draft'); assert(!m.assessArgs()[2].includes('housing_discrimination'));
});
test('SendGrid 202 with message ID means accepted, never delivered', async () => {
  let body;
  const r = await adapters().sendMonthlyReport('broker@example.org', report, null, async (_url, options) => { body = JSON.parse(options.body); return new Response(null, { status: 202, headers: { 'x-message-id': 'message1' } }); });
  assert.equal(r.kind, 'accepted'); assert.equal(r.providerMessageId, 'message1');
  assert.equal(body.personalizations[0].to[0].email, 'broker@example.org'); assert.equal(body.content.length, 2);
  assert(body.content[1].value.includes('&lt;not published&gt;')); assert(!body.content[1].value.includes('<not published>')); assert(body.content[0].value.includes('Not measurable'));
});
test('ambiguous send does not become retry-safe; explicit rejection does', async () => {
  const m = adapters();
  for (const fetcher of [async () => { throw Error('Timeout'); }, async () => new Response(null, { status: 202 }), async () => new Response(null, { status: 200 }), async () => new Response(null, { status: 500 }), async () => new Response(null, { status: 503 })]) assert.equal((await m.sendMonthlyReport('a@example.org', report, null, fetcher)).kind, 'unknown');
  assert.equal((await m.sendMonthlyReport('a@example.org', report, null, async () => new Response(null, { status: 429 }))).kind, 'rejected_before_acceptance');
  let called = false;
  assert.equal((await adapters({ env: { SENDGRID_API_KEY: '' } }).sendMonthlyReport('a@example.org', report, null, async () => { called = true; })).kind, 'rejected_before_acceptance'); assert.equal(called, false);
});
test('Resend requires explicit selection and the selected provider credential', async () => {
  for (const env of [{ EMAIL_PROVIDER: 'resend' }, { EMAIL_PROVIDER: 'unsupported', RESEND_API_KEY: 'stub' }, { EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: '', RESEND_API_KEY: 'stub' }, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'stub', ONBOARDING_FROM_EMAIL: 'invalid' }]) {
    let calls = 0;
    const m = adapters({ env });
    assert(m.mailConfigurationError());
    assert.equal((await m.sendMonthlyReport('broker@example.org', report, null, async () => { calls++; })).kind, 'rejected_before_acceptance');
    assert.equal(calls, 0);
  }
  let url;
  await adapters({ env: { RESEND_API_KEY: 'stub' } }).sendMonthlyReport('broker@example.org', report, null, async u => { url = u; return new Response(null, { status: 202, headers: { 'x-message-id': 'sg' } }); });
  assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
});
test('Resend accepts only 200 or 201 with an ID and stable owner/month idempotency', async () => {
  const requests = [];
  const m = adapters({ env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'resend-stub', SENDGRID_API_KEY: '' } });
  for (const status of [200, 201]) {
    const receipt = await m.sendMonthlyReport('broker@example.org', report, null, async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify({ id: 'resend-message' }), { status }); });
    assert.equal(receipt.kind, 'accepted'); assert.equal(receipt.providerMessageId, 'resend-message');
  }
  assert.equal(requests[0].url, 'https://api.resend.com/emails');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer resend-stub');
  assert.equal(requests[0].options.headers['Idempotency-Key'], 'eyeonads-monthly/owner/2026-09');
  assert.equal(requests[1].options.headers['Idempotency-Key'], requests[0].options.headers['Idempotency-Key']);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.from, 'outreach@shieldsenterprises.io'); assert.deepEqual(body.to, ['broker@example.org']);
  assert(body.html.includes('&lt;not published&gt;')); assert(body.text.includes('Not measurable'));
  await adapters({ env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'stub', ONBOARDING_FROM_EMAIL: 'sender@example.org' } }).sendMonthlyReport('broker@example.org', { ...report, ownerId: 'other', period: '2026-10' }, null, async (_url, options) => {
    assert.equal(JSON.parse(options.body).from, 'sender@example.org');
    assert.equal(options.headers['Idempotency-Key'], 'eyeonads-monthly/other/2026-10');
    return new Response(JSON.stringify({ id: 'other-message' }), { status: 200 });
  });
});
test('Resend uncertainty never falls back; confirmed 4xx rejection remains retry-safe', async () => {
  const m = adapters({ env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'stub' } });
  for (const outcome of [() => { throw Error('Timeout'); }, () => new Response('{}', { status: 200 }), () => new Response('{bad-json', { status: 201 }), () => new Response('{"id":"  "}', { status: 200 }), () => new Response('{"id":123}', { status: 201 }), () => new Response('{"id":"unexpected"}', { status: 202 }), () => new Response(null, { status: 500 }), () => new Response(null, { status: 503 })]) {
    let calls = 0;
    const receipt = await m.sendMonthlyReport('broker@example.org', report, null, async url => { calls++; assert.equal(url, 'https://api.resend.com/emails'); return outcome(); });
    assert.equal(receipt.kind, 'unknown'); assert.equal(calls, 1);
  }
  for (const status of [400, 401, 403, 409, 422, 429]) {
    let calls = 0;
    const receipt = await m.sendMonthlyReport('broker@example.org', report, null, async url => { calls++; assert.equal(url, 'https://api.resend.com/emails'); return new Response(null, { status }); });
    assert.equal(receipt.kind, 'rejected_before_acceptance'); assert.equal(calls, 1);
  }
});
const jsonResponse = { json: (body, options = {}) => ({ body, status: options.status || 200 }) };
function api(user, rpcData = [{ id: 'current-run' }]) {
  let queries = [], calls = [];
  const db = { auth: { getUser: async () => ({ data: { user } }) }, rpc: async (name, args) => { calls.push({ name, args }); return { data: rpcData, error: null }; }, from(table) { const q = { select() { return this; }, eq(k, v) { queries.push({ table, k, v }); return this; }, order() { return this; }, in() { return this; }, maybeSingle: async () => ({ data: null, error: null }), limit: async () => ({ data: [], error: null }) }; return q; } };
  const m = moduleAt('app/api/reliability/route.ts', { 'next/server': { NextResponse: jsonResponse }, '@/lib/supabase/server': { createClient: async () => db }, '@/lib/discovery-jobs': { sameOrigin: req => req.headers.get('origin') === 'https://eyeonads.com' } });
  return { ...m, queries, calls };
}
const user = { id: 'owner', app_metadata: { eyeonads_pilot: true } };
const req = body => new Request('https://eyeonads.com/api/reliability', { method: 'POST', headers: { origin: 'https://eyeonads.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('monthly status and mutations require authenticated pilot', async () => {
  for (const [identity, status] of [[null, 401], [{ id: 'other' }, 403]]) { const m = api(identity); assert.equal((await m.GET()).status, status); assert.equal((await m.POST(req({ action: 'run' }))).status, status); assert.equal(m.calls.length, 0); }
});
test('monthly action rejects cross-origin and arbitrary owner/recipient/target overrides', async () => {
  const m = api(user);
  assert.equal((await m.POST(new Request('https://eyeonads.com/api/reliability', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }))).status, 403);
  for (const extra of [{ owner_id: 'victim' }, { recipient: 'attacker@example.org' }, { public_canary_url: 'http://127.0.0.1' }]) assert.equal((await m.POST(req({ action: 'run', ...extra }))).status, 400);
  assert.equal(m.calls.length, 0);
});
test('monthly run-now passes no owner or period; status queries are owner scoped', async () => {
  const m = api(user); assert.equal((await m.POST(req({ action: 'run' }))).status, 200);
  assert.equal(m.calls[0].name, 'eyeonads_start_reliability'); assert.equal(m.calls[0].args, undefined);
  await m.GET(); assert(m.queries.length >= 2); assert(m.queries.every(q => q.k === 'owner_id' && q.v === 'owner'));
  await m.POST(req({ action: 'schedule', enabled: true })); assert.equal(m.calls[1].args.p_enabled, true);
});
test('worker uses exact Bearer auth and cookie-free service client', async () => {
  let options, invoked = 0;
  const m = moduleAt('app/api/reliability/worker/route.ts', { 'server-only': {}, 'next/server': { NextResponse: jsonResponse }, '@supabase/supabase-js': { createClient: (_url, _key, opts) => { options = opts; return {}; } }, '@/lib/reliability-canary/runner': { runReliabilityWorker: async () => { invoked++; return { idle: true }; } } }, { EYEONADS_WORKER_SECRET: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'key', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example' });
  assert.equal((await m.POST(new Request('https://eyeonads.com/api/reliability/worker'))).status, 401);
  assert.equal(invoked, 0);
  assert.equal((await m.POST(new Request('https://eyeonads.com/api/reliability/worker', { headers: { authorization: 'Bearer secret', cookie: 'victim' } }))).status, 200);
  assert.equal(options.auth.persistSession, false); assert.equal(options.cookies, undefined); assert.equal(invoked, 1);
});
function runnerDB({ owner = user, claimed = true, saveReceipt = true } = {}) {
  let sends = 0;
  const state = { calls: [], updates: [], delivery: { run_id: 'run', owner_id: 'owner', status: 'queued', attempts: 0, retry_safe: false }, config: { owner_id: 'owner', enabled: true, next_run_at: '2026-10-01T00:00:00Z', pilot_recipient_override: 'theshieldsteam@gmail.com', pilot_recipient_authorized_at: '2026-09-23T20:00:00Z', pilot_recipient_authorized_by: 'user' } };
  const db = {
    auth: { admin: { getUserById: async id => { assert.equal(id, 'owner'); return { data: { user: owner }, error: null }; } } },
    from(table) {
      let update, filters = [];
      const q = { select() { return this; }, update(value) { update = value; return this; }, eq(k, v) { filters.push([k, v]); return this; }, in() { return this; }, or() { return this; }, lte() { return this; }, lt() { return this; }, order() { return this; },
        maybeSingle: async () => ({ error: null, data: table.endsWith('configs') ? state.config : table.endsWith('runs') ? { report, status: 'complete', owner_id: 'owner' } : { name: 'Firm', discovery_location: 'Jonesborough, Tennessee', discovery_agent_ids: ['yes'], agents: [{ id: 'yes', name: 'Scoped' }, { id: 'no', name: 'Excluded' }] } }),
        limit: async () => ({ error: null, data: (['queued', 'failed'].includes(state.delivery.status)||state.delivery.status==='blocked'&&state.delivery.attempts===0) ? [{ ...state.delivery }] : [] }),
        then(resolve) { if (update) { state.updates.push({ table, update, filters }); if (filters.some(([k, v]) => k === 'run_id' && v === 'run')&&filters.every(([k,v])=>state.delivery[k]===v)) Object.assign(state.delivery, update); } return Promise.resolve({ error: null }).then(resolve); },
      }; return q;
    },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (name === 'eyeonads_claim_reliability_delivery') {
        if (!claimed || state.delivery.status !== 'queued') return { data: [], error: null };
        state.delivery.status = 'sending'; state.delivery.attempts++;
        return { data: [{ ...state.delivery, lease_token: 'token' }], error: null };
      }
      if (name === 'eyeonads_record_reliability_delivery') {
        if (saveReceipt) { state.delivery.status = args.p_status; state.delivery.retry_safe = args.p_retry_safe; }
        return { data: saveReceipt, error: saveReceipt ? null : { message: 'unavailable' } };
      }
      return { data: true, error: null };
    },
  };
  const m = moduleAt('lib/reliability-canary/runner.ts', { 'server-only': {}, './engine': engine, './delivery': delivery, './adapters': { mailConfigurationError: () => null, createCanaryDependencies: () => { throw Error('No live provider'); }, sendMonthlyReport: () => { throw Error('No live provider'); } } });
  const deps = { emailConfigurationError: () => null, send: async () => { sends++; return { kind: 'accepted', providerMessageId: 'message' }; } };
  return { ...m, db, state, deps, sends: () => sends };
}
test('outbox resolves authorized recipient and cannot send twice after acceptance', async () => {
  const m = runnerDB(); assert.equal((await m.processReliabilityDelivery(m.db, m.deps)).delivery, 'accepted');
  assert.equal((await m.processReliabilityDelivery(m.db, m.deps)).delivery, 'idle'); assert.equal(m.sends(), 1);
  const claim = m.state.calls.find(c => c.name === 'eyeonads_claim_reliability_delivery');
  assert.equal(claim.args.p_recipient, 'theshieldsteam@gmail.com'); assert.equal(claim.args.p_source, 'authorized_pilot_override');
});
test('outbox does not send without atomic claim or a verified real recipient', async () => {
  const unclaimed = runnerDB({ claimed: false }); assert.equal((await unclaimed.processReliabilityDelivery(unclaimed.db, unclaimed.deps)).delivery, 'already_claimed'); assert.equal(unclaimed.sends(), 0);
  const synthetic = runnerDB({ owner: { ...user, email: 'les.review.owner@example.com', email_confirmed_at: '2026-09-23T20:00:00Z' } });
  synthetic.state.config.pilot_recipient_override = null;
  assert.equal((await synthetic.processReliabilityDelivery(synthetic.db, synthetic.deps)).delivery, 'blocked'); assert.equal(synthetic.sends(), 0); assert.equal(synthetic.state.delivery.status, 'blocked');
});
test('outbox thrown send is uncertain and failed receipt persistence never triggers re-send', async () => {
  const m = runnerDB();
  assert.equal((await m.processReliabilityDelivery(m.db, { ...m.deps, send: async () => { throw Error('connection lost'); } })).delivery, 'uncertain');
  assert.equal(m.state.delivery.retry_safe, false);
  const n = runnerDB({ saveReceipt: false }); await assert.rejects(n.processReliabilityDelivery(n.db, n.deps), /receipt could not be saved/); assert.equal(n.sends(), 1); assert.equal(n.state.delivery.status, 'sending');
});
test('runner scopes roster and preserves leased successful checkpoints', async () => {
  const m = runnerDB(); let seen;
  const item = { id: 'run', owner_id: 'owner', period: '2026-09', lease_token: 'lease', attempts: 1, config_snapshot: { owner_id: 'owner' }, checkpoints: { prior: { fingerprint: 'saved', value: 'evidence' } } };
  const result = await m.processReliabilityRun(m.db, item, { providers: {}, engine: async (args, deps) => { seen = args; assert.equal((await deps.readCheckpoint('prior')).fingerprint, 'saved'); await deps.writeCheckpoint('newstage', { fingerprint: 'new', value: 'captured' }); return report; } });
  assert.equal(result.completed, true); assert.deepEqual(Array.from(seen.queryInputs.agentNames), ['Scoped']);
  const saved = m.state.calls.find(c => c.name === 'eyeonads_checkpoint_reliability'); assert.equal(saved.args.p_token, 'lease'); assert.equal(saved.args.p_run, 'run');
  assert(m.state.calls.some(c => c.name === 'eyeonads_finish_reliability'));
});
test('runner operational errors retry without fabricating completed reports', async () => {
  const m = runnerDB();
  const result = await m.processReliabilityRun(m.db, { id: 'run', owner_id: 'owner', period: '2026-09', lease_token: 'lease', attempts: 1, config_snapshot: { owner_id: 'owner' } }, { providers: {}, engine: async () => ({ ...report, outcome: 'error' }) });
  assert.equal(result.completed, false); assert(m.state.calls.some(c => c.name === 'eyeonads_fail_reliability')); assert(!m.state.calls.some(c => c.name === 'eyeonads_finish_reliability'));
});

test('monthly UI shows incomplete public setup and accepted-not-delivered mail state', () => {
  let hook = 0;
  const status = { config: { enabled: true, next_run_at: '2026-10-01T00:00:00Z', public_canary_url: null, target_verified_at: null }, runs: [{ id: 'run', period: '2026-09', status: 'complete', report }], deliveries: [{ run_id: 'run', status: 'accepted', recipient: 'broker@example.org' }] };
  const react = require('react');
  const m = moduleAt('components/MonthlyReliability.tsx', { '@/components/PublicReliabilityTest': { PublicReliabilityTest: () => null }, react: { ...react, useState: initial => [hook++ === 0 ? status : initial, () => {}], useEffect: () => {}, useCallback: fn => fn, useRef: value => ({ current: value }) } });
  const html = require('react-dom/server').renderToStaticMarkup(react.createElement(m.MonthlyReliability));
  assert(html.includes('Public test setup is incomplete'));
  assert(html.includes('mailbox delivery is not confirmed'));
  assert(html.includes('Not measurable; no verified public target'));
  assert(html.includes('Known-defect') === false); // This saved report has only its actual clean-control row.
  assert(html.includes('Next check:'));
});

test('blind discovery excludes model-only links and failed tool sources',async()=>{
 const target='https://www.facebook.com/person/posts/123';
 for(const output of [[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://www.facebook.com/person/posts/999'}]}}],[{type:'web_search_call',status:'completed'},{type:'web_search_call',status:'failed',action:{sources:[{url:target}]}}]]){
 const m=adapters({response:{status:'completed',output,output_text:JSON.stringify({urls:[target],notes:[],complete:true})}});const r=await m.createCanaryDependencies().discover({brokerage:'Firm',office:'Town',agentNames:['Agent'],state:'TN'});assert.equal(r.urls.length,0);assert(m.request().args.body.include.includes('web_search_call.action.sources'));
 }
 const m=adapters();const r=m.groundedDiscoveryURLs({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{annotations:[{type:'url_citation',url:target}]}]}]},[target]);assert.equal(r.length,1);
});
test('pre-send configuration block recovers after correction without reviving uncertain or accepted sends',async()=>{
 const m=runnerDB();const first=await m.processReliabilityDelivery(m.db,{...m.deps,emailConfigurationError:()=> 'Not configured'});assert.equal(first.delivery,'blocked');assert.equal(m.state.delivery.attempts,0);assert.equal(m.sends(),0);assert(Date.parse(m.state.delivery.available_at)>Date.now());
 assert.equal((await m.processReliabilityDelivery(m.db,m.deps)).delivery,'accepted');assert.equal(m.sends(),1);
 const transition=m.state.updates.find(x=>x.update.status==='queued');assert(transition.filters.some(([k,v])=>k==='status'&&v==='blocked'));assert(transition.filters.some(([k,v])=>k==='attempts'&&v===0));assert(transition.filters.some(([k,v])=>k==='owner_id'&&v==='owner'));
 for(const status of ['accepted','uncertain','sending','delivered']){m.state.delivery.status=status;await m.processReliabilityDelivery(m.db,m.deps);assert.equal(m.sends(),1);}
 m.state.delivery.status='blocked';m.state.delivery.attempts=1;await m.processReliabilityDelivery(m.db,m.deps);assert.equal(m.sends(),1);
});
test('unresolved pre-send block does not starve the next eligible report',async()=>{
 const m=runnerDB(),original=m.db.from;let lookups=0;
 m.db.auth.admin.getUserById=async()=>({data:{user:++lookups===1?{id:'owner',app_metadata:{}}:user},error:null});
 m.db.from=table=>{const q=original(table);if(table==='eyeonads_reliability_deliveries')q.limit=async()=>({data:[{...m.state.delivery,run_id:'other-run',status:'blocked',attempts:0},{...m.state.delivery}],error:null});return q;};
 assert.equal((await m.processReliabilityDelivery(m.db,m.deps)).delivery,'accepted');assert.equal(m.sends(),1);assert.equal(lookups,2);
});

test('calibration requires substantive discrimination detection, not an EHO or disability mention',()=>{
 const m=adapters(),codes=(rule,explanation)=>Array.from(m.substantiveFindingCodes({result:'yellow',flags:[{rule,explanation,severity:'yellow',recommendation:'Review'}],summary:'Review'}));
 for(const [rule,explanation] of [['Fair housing logo','The Equal Housing Opportunity logo is missing.'],['Disability feature','Accessibility information needs verification.'],['Fair housing disclosure','A nondiscrimination statement is not visible.']])assert.deepEqual(codes(rule,explanation),['other_substantive_issue']);
 for(const [rule,explanation] of [['Discriminatory housing advertising — disability','The wording expresses a limitation or exclusion based on disability.'],['Applicant restriction','Only applicants of a preferred race may apply.'],['Familial-status restriction','The advertising excludes families with children.']])assert.deepEqual(codes(rule,explanation),['housing_discrimination']);
});

test('Facebook canonical declarations on an external redirect cannot verify a public target',async()=>{
 const url='https://www.facebook.com/broker/posts/123';
 const r=await adapters({page:{url:'https://unrelated.example/fake',text:'COMPLIANCE TEST — FICTIONAL',retrieved_at:'2026-09-23T22:00:00Z',sha256:'hash',source_metadata:{canonical_url:url,author_urls:['https://www.facebook.com/broker']}}}).createCanaryDependencies().retrieve(url);
 assert.equal(r.targetId,undefined);
});

test('monthly retrieval excludes comments and unrelated authors without exact-post text binding', async () => {
 const url='https://www.facebook.com/broker/posts/123';
 const page={url,text:'Comment: COMPLIANCE TEST — FICTIONAL Greater Impact Realty Jonesborough',retrieved_at:'2026-09-23T22:00:00Z',sha256:'hash',source_metadata:{canonical_url:url,author_urls:['https://www.facebook.com/other']}};
 for(const bound of [undefined,{url:'https://www.facebook.com/other/posts/999',text:page.text,author_urls:['https://www.facebook.com/other']}]) {
  const r=await adapters({page:{...page,source_metadata:{...page.source_metadata,bound_post:bound}}}).createCanaryDependencies().retrieve(url);
  assert.equal(r.postBound,false); assert.equal(r.targetId,undefined); assert.equal(r.text,undefined);
 }
});
