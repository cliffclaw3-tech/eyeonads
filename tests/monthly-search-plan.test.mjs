import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPostSearchPlan, searchPlanExecuted } from '../src/lib/reliability-canary/search-plan.ts';

const identity = { brokerage: 'Harbor Example Realty', office: 'Example Town', state: 'TN' };
const plan = publicPostSearchPlan(identity);
const search = (query, status = 'completed') => ({ type: 'web_search_call', status, action: { type: 'search', query } });

test('brokerage sampling neither invents a Page path nor selects a roster prefix', () => {
  assert.equal(plan.length, 3);
  assert.equal(plan[1], 'site:facebook.com "Harbor Example Realty"');
  assert.ok(plan.every(q => !q.includes('facebook.com/') && !q.includes(' OR ')));
  assert.deepEqual(publicPostSearchPlan({ ...identity, agentNames: ['Person A'], publicCanaryUrl: 'https://facebook.com/answer/posts/123', requiredLabel: 'secret answer' }), plan);
  assert.deepEqual(publicPostSearchPlan({ ...identity, agentNames: Array.from({length: 88}, (_, i) => `Person ${i}`) }), plan);
});

test('identity quoting prevents quotes, control characters and URLs escaping into query structure', () => {
  assert.equal(publicPostSearchPlan({ ...identity, brokerage: 'Harbor"\nRealty\\' })[1], 'site:facebook.com "Harbor Realty"');
  for (const brokerage of ['', 'https://facebook.com/answer', 'a'.repeat(201)]) assert.throws(() => publicPostSearchPlan({ ...identity, brokerage }));
});

test('all planned searches must have completed evidence; model complete text is insufficient', () => {
  assert.equal(searchPlanExecuted(plan, { output: plan.map(q => search(q)) }), true);
  assert.equal(searchPlanExecuted(plan, { complete: true, output: [search(plan[0]), search(plan[0]), search(plan[0])] }), false);
  assert.equal(searchPlanExecuted(plan, { output: [search(plan[0]), search(plan[1]), search(plan[2], 'failed')] }), false);
  assert.equal(searchPlanExecuted(plan, { output: [{ type: 'message', content: plan.join('\n') }] }), false);
  assert.equal(searchPlanExecuted(plan, { output: [...plan.map(q => search(q)), search('invented fourth query')] }), false);
  assert.equal(searchPlanExecuted(plan, { output: [...plan.map(q => search(q)), search(plan[0])] }), false);
  assert.equal(searchPlanExecuted(plan, { output: [...plan.map(q => search(q)), search('failed extra', 'failed')] }), false);
  assert.equal(searchPlanExecuted(plan, { output: [...plan.map(q => search(q)), {type:'web_search_call',status:'completed',action:{type:'search'}}] }), false);
});

test('missing optional qualifiers reduce the bounded sample and duplicates do not inflate it', () => {
  assert.deepEqual(publicPostSearchPlan({...identity, office:'', state:' '}), [plan[1]]);
  assert.equal(publicPostSearchPlan({...identity, office:'TN', state:'TN'}).length, 2);
});

test('query arrays and whitespace/case normalize but substituted paths or appended terms do not', () => {
  assert.equal(searchPlanExecuted(plan, { output: [{ type: 'web_search_call', status: 'completed', action: {type:'search', queries: plan.map(q => `  ${q.toUpperCase()}  `)} }] }), true);
  assert.equal(searchPlanExecuted(plan, {output: plan.map(q => search(q + ' "for sale"'))}), false);
  assert.equal(searchPlanExecuted(plan, {output: plan.map(q => search(q.replace('facebook.com', 'facebook.com/HarborRealty/posts')))}), false);
  assert.equal(searchPlanExecuted(plan, {output: [{type:'web_search_call', status:'completed', action:{type:'open_page', queries:plan}}]}), false);
  assert.equal(searchPlanExecuted(plan, null), false);
});
