import test from 'node:test';
import assert from 'node:assert/strict';
import {runMonthlyCanary, monthlyControls, publicPostIdentity} from '../src/lib/reliability-canary/engine.ts';
import {resolveBrokerRecipient, deliveryAfterSend, mayAttemptDelivery, expiredSendLease} from '../src/lib/reliability-canary/delivery.ts';
const url='https://www.facebook.com/verified-page/posts/123456';
const config={ownerId:'owner-a',publicCanaryUrl:url,expectedTargetId:'verified-page',targetVerifiedAt:'2026-09-01T00:00:00Z',requiredLabel:'COMPLIANCE TEST — FICTIONAL',expectedFindingCodes:['housing_discrimination']};
const args={config,period:'2026-09',now:'2026-09-23T21:00:00Z',queryInputs:{brokerage:'Example Realty',office:'Jonesborough',agentNames:['Les Example'],state:'TN'}};
function fixture(overrides={}) {
 const calls={discover:[],retrieve:[],assess:[]};
 const checkpoints=new Map();
 const deps={
  async discover(input){calls.discover.push(input);return {urls:[url+'?tracking=ignored'],notes:[],complete:true};},
  async retrieve(input){calls.retrieve.push(input);return {status:'retrieved',canonicalUrl:url,targetId:'verified-page',public:true,text:config.requiredLabel+' Families with children are not allowed to rent this home.',capturedAt:args.now,contentHash:'sha256-known',reason:'Public post captured.'};},
  async assess(input){calls.assess.push(input);return {findingCodes:/not allowed|preferred race|disabilities will not/.test(input.text)?['housing_discrimination']:[],summary:'Independent assessment',complete:true};},
  async readCheckpoint(key){return checkpoints.get(key)||null;},async writeCheckpoint(key,value){checkpoints.set(key,value);},...overrides,
 };
 return {deps,calls,checkpoints};
}
test('blind discovery receives only normal query inputs; URL and expected findings do not leak',async()=>{
 const f=fixture();const report=await runMonthlyCanary(args,f.deps);
 assert.equal(report.outcome,'pass');assert.deepEqual(f.calls.discover,[args.queryInputs]);
 assert.ok(!JSON.stringify(f.calls.discover).includes('123456'));assert.ok(!JSON.stringify(f.calls.discover).includes('housing_discrimination'));
 for(const input of f.calls.assess)assert.deepEqual(Object.keys(input).sort(),['imageEvidence','state','text']);
 assert.equal(report.metrics.recall,1);assert.equal(report.metrics.controlsPassed,2);
});
test('a direct retrieval success does not repair a blind discovery miss',async()=>{
 const f=fixture({discover:async()=>({urls:[],complete:true,notes:[]})});
 const r=await runMonthlyCanary(args,f.deps);assert.equal(r.discovery.status,'fail');assert.equal(r.retrieval.status,'pass');assert.equal(r.metrics.recall,0);assert.equal(r.outcome,'fail');
});
test('unconfigured test is blocked even when both independent controls pass',async()=>{
 const f=fixture();const r=await runMonthlyCanary({...args,config:{...config,publicCanaryUrl:null}},f.deps);
 assert.equal(r.outcome,'blocked');assert.equal(r.metrics.recall,null);assert.equal(r.metrics.controlsPassed,2);assert.equal(f.calls.discover.length,0);assert.equal(f.calls.retrieve.length,0);
});
for(const missing of [{status:'unpublished'},{public:false},{targetId:'wrong-target'},{text:'Not labeled'},{contentHash:''},{capturedAt:undefined},{capturedAt:'2026-08-31T23:59:59Z'},{capturedAt:'2099-01-01T00:00:00Z'},{canonicalUrl:'https://www.facebook.com/another/posts/999'}])test(`unavailable or unverifiable test never passes: ${JSON.stringify(missing)}`,async()=>{
 const base=fixture();const original=base.deps.retrieve;base.deps.retrieve=async u=>({...await original(u),...missing});
 const r=await runMonthlyCanary(args,base.deps);assert.equal(r.metrics.configuredTargets,1);assert.equal(r.metrics.verifiedPublicTargets,0);assert.equal(r.retrieval.status,'blocked');assert.equal(r.discovery.status,'blocked');assert.equal(r.outcome,'blocked');assert.equal(r.metrics.recall,null);
});
test('control miss and clean false positive fail assessment',async()=>{
 const f=fixture({assess:async()=>({findingCodes:['wrong_finding'],summary:'Wrong',complete:true})});const r=await runMonthlyCanary(args,f.deps);
 assert.equal(r.assessment.status,'fail');assert.equal(r.controls[0].stage.status,'fail');assert.equal(r.controls[1].stage.status,'fail');
 assert.deepEqual(r.controls[1].stage.evidence.unexpected,['wrong_finding']);
});
test('incomplete assessment and provider exceptions never become passes',async()=>{
 const f=fixture({assess:async()=>({findingCodes:[],summary:'Partial',complete:false})});assert.equal((await runMonthlyCanary(args,f.deps)).assessment.status,'error');
 const g=fixture({discover:async()=>{throw Error('secret-provider-error');}});const r=await runMonthlyCanary(args,g.deps);assert.equal(r.outcome,'error');assert.ok(!JSON.stringify(r).includes('secret-provider-error'));
});
test('checkpoints prevent repeated successful stage calls and are bound to owner, period and inputs',async()=>{
 const f=fixture();await runMonthlyCanary(args,f.deps);await runMonthlyCanary(args,f.deps);
 assert.equal(f.calls.discover.length,1);assert.equal(f.calls.retrieve.length,1);assert.equal(f.calls.assess.length,3);
 await runMonthlyCanary({...args,config:{...config,ownerId:'owner-b'}},f.deps);assert.equal(f.calls.discover.length,2);assert.equal(f.calls.assess.length,6);
 await runMonthlyCanary({...args,period:'2026-10'},f.deps);assert.equal(f.calls.discover.length,3);
});
test('failed stages retry but a saved control does not',async()=>{
 const f=fixture();let n=0;f.deps.discover=async()=>{n++;throw Error('outage');};
 await runMonthlyCanary(args,f.deps);await runMonthlyCanary(args,f.deps);assert.equal(n,2);assert.equal(f.calls.assess.length,3);
});
test('controls rotate deterministically and remain clearly fictional',()=>{
 const a=monthlyControls('2026-09'),b=monthlyControls('2026-10');assert.notEqual(a[0].id,b[0].id);assert.deepEqual(a,monthlyControls('2026-12'));
 for(const c of [...a,...b])assert.match(c.text,/COMPLIANCE TEST — FICTIONAL/);
 assert.throws(()=>monthlyControls('2026-13'));
});
test('Facebook identities ignore tracking but never accept profiles or hostile URLs',()=>{
 assert.equal(publicPostIdentity(url),publicPostIdentity('https://m.facebook.com/story.php?story_fbid=123456&id=verified-page'));
 for(const u of ['https://facebook.com/verified-page','https://facebook.com.evil.test/a/posts/123456','http://facebook.com/a/posts/123456','https://user:pass@facebook.com/a/posts/123456'])assert.equal(publicPostIdentity(u),null);
 assert.equal(publicPostIdentity('https://www.facebook.com/ads/library/?id=42'),'facebook:ad:42');
});
test('broker delivery resolves only verified signup identity or service-authorized pilot override',()=>{
 const owner={id:'owner-a',email:'broker@real.test',emailConfirmedAt:args.now,synthetic:false};
 assert.equal(resolveBrokerRecipient(owner,{ownerId:owner.id}).status,'ready');
 assert.equal(resolveBrokerRecipient({...owner,emailConfirmedAt:null},{ownerId:owner.id}).status,'blocked');
 assert.equal(resolveBrokerRecipient({...owner,synthetic:true},{ownerId:owner.id}).status,'blocked');
 assert.equal(resolveBrokerRecipient(owner,{ownerId:'other'}).status,'blocked');
 assert.equal(resolveBrokerRecipient({...owner,synthetic:true},{ownerId:owner.id,pilotOverride:{email:'theshieldsteam@gmail.com',authorizedAt:args.now,authorizedBy:'user-request'}}).source,'authorized_pilot_override');
 assert.equal(resolveBrokerRecipient(owner,{ownerId:owner.id,pilotOverride:{email:'attacker@real.test',authorizedAt:args.now,authorizedBy:'user-request'}}).status,'blocked');
});
test('accepted is not delivered; unknown SMTP outcome and expired leases are never auto-retried',()=>{
 const sending={status:'sending',attempts:1,retrySafe:false};
 const accepted=deliveryAfterSend(sending,{kind:'accepted',providerMessageId:'provider-1'});assert.equal(accepted.status,'accepted');assert.equal(mayAttemptDelivery(accepted),false);
 const unknown=deliveryAfterSend(sending,{kind:'unknown',reason:'Connection dropped after DATA'});assert.equal(unknown.status,'uncertain');assert.equal(mayAttemptDelivery(unknown),false);
 assert.equal(mayAttemptDelivery(expiredSendLease(sending)),false);
 const rejected=deliveryAfterSend(sending,{kind:'rejected_before_acceptance',reason:'Provider 4xx before acceptance'});assert.equal(mayAttemptDelivery(rejected),true);
 assert.equal(mayAttemptDelivery({...rejected,attempts:3}),false);
 assert.throws(()=>deliveryAfterSend(sending,{kind:'delivered',providerMessageId:'p',verifiedDeliveryEventId:''}));
});

test('incomplete callback values and retrieval errors are not cached across recovery attempts',async()=>{
 const f=fixture();let discoveryCalls=0,retrievalCalls=0,assessmentCalls=0;
 f.deps.discover=async()=>({urls:[url],notes:[],complete:++discoveryCalls>1});
 const originalRetrieve=f.deps.retrieve;f.deps.retrieve=async u=>++retrievalCalls===1?{status:'error',public:false,reason:'Temporary network error'}:originalRetrieve(u);
 const originalAssess=f.deps.assess;f.deps.assess=async input=>{assessmentCalls++;return assessmentCalls<=2?{findingCodes:[],summary:'Incomplete',complete:false}:originalAssess(input);};
 const first=await runMonthlyCanary(args,f.deps);assert.equal(first.retrieval.status,'error');assert.equal(first.outcome,'error');
 const second=await runMonthlyCanary(args,f.deps);assert.equal(second.outcome,'pass');assert.equal(discoveryCalls,2);assert.equal(retrievalCalls,2);assert.equal(assessmentCalls,5);
});
