import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {publicPostIdentity} from '../src/lib/reliability-canary/engine.ts';
const require=createRequire(import.meta.url),url='https://www.facebook.com/broker/posts/123456';
const user={id:'owner-a',app_metadata:{eyeonads_pilot:true}};
const baseConfig={owner_id:'owner-a',enabled:true,next_run_at:'2026-10-01T00:00:00Z',pilot_recipient_override:'theshieldsteam@gmail.com',pilot_recipient_authorized_by:'USER_AUTHORIZATION',public_canary_url:'https://www.facebook.com/broker/posts/old',target_verified_at:'2026-09-01T00:00:00Z',expected_target_id:'facebook:publisher:broker'};
const body={url,authorized:true};
const req=(payload=body,origin='https://eyeonads.com')=>new Request('https://eyeonads.com/api/reliability/public-test',{method:'POST',headers:{...(origin?{origin}:{}),'content-type':'application/json'},body:JSON.stringify(payload)});
function fixture(options={}){
 let config=options.config===undefined?{...baseConfig}:options.config;const writes=[],queries=[];let retrieveCalls=0,serviceCalls=0;
 const setup={name:'Greater Impact Realty',discovery_location:'Jonesborough',location:'Tennessee',...options.setup};
 const authDb={auth:{getUser:async()=>({data:{user:options.user===undefined?user:options.user},error:options.authError||null})},from(table){return {select(){return this},eq(key,value){queries.push({table,key,value});return this},async maybeSingle(){return {data:table==='eyeonads_brokerage_setups'?setup:config,error:options.readError||null}}};}};
 const service={from(table){let mutation,filter;return {update(value){mutation=value;return this},insert(value){mutation=value;filter={owner_id:value.owner_id};return this},eq(key,value){filter={[key]:value};return this},select(){return this},async maybeSingle(){writes.push({table,operation:'update',value:mutation,filter});if(options.saveError)return {data:null,error:{code:'ERROR'}};if(config&&config.owner_id===filter.owner_id){config={...config,...mutation};return {data:{public_canary_url:config.public_canary_url,target_verified_at:config.target_verified_at},error:null};}return {data:null,error:null};},async single(){writes.push({table,operation:'insert',value:mutation,filter});config={enabled:false,next_run_at:null,...mutation};return {data:{public_canary_url:config.public_canary_url,target_verified_at:config.target_verified_at},error:null};}};}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/reliability/public-test/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'TEST_SERVICE_SECRET',...options.env}},Date,URL,AbortSignal,require(name){
  if(name==='next/server')return {NextResponse:{json:(body,init={})=>({body,status:init.status||200,headers:init.headers})}};
  if(name==='@/lib/supabase/server')return {createClient:async()=>authDb};
  if(name==='@supabase/supabase-js')return {createClient:()=>{serviceCalls++;return service;}};
  if(name==='@/lib/discovery-jobs')return {sameOrigin:request=>request.headers.get('origin')==='https://eyeonads.com'};
  if(name==='@/lib/reliability-canary/engine')return {publicPostIdentity};
  if(name==='@/lib/reliability-canary/adapters')return {createCanaryDependencies:()=>({retrieve:async()=>{retrieveCalls++;if(options.throwRetrieve)throw Error('PRIVATE_PROVIDER_FAILURE');return {status:'retrieved',public:true,postBound:true,canonicalUrl:url,targetId:'facebook:publisher:broker',text:'COMPLIANCE TEST — FICTIONAL\nEyeOnAds public discovery test for Greater Impact Realty — Jonesborough.\nNo property offer.',capturedAt:new Date().toISOString(),contentHash:'a'.repeat(64),reason:'Private details must not leak',...options.capture};}})};
  throw Error(name);
 }});
 return {...exports,writes,queries,config:()=>config,retrieveCalls:()=>retrieveCalls,serviceCalls:()=>serviceCalls};
}
test('GET returns usable fictional copy and saved readiness without recipient, owner or service secrets',async()=>{
 const f=fixture(),r=await f.GET();assert.equal(r.status,200);assert.match(r.body.copy_template,/COMPLIANCE TEST — FICTIONAL/);assert.match(r.body.copy_template,/Greater Impact Realty — Jonesborough/);assert.match(r.body.copy_template,/not a property advertisement/);
 assert.ok(!JSON.stringify(r.body).includes('theshieldsteam'));assert.ok(!JSON.stringify(r.body).includes('TEST_SERVICE_SECRET'));assert.ok(!JSON.stringify(r.body).includes('owner-a'));assert.equal(r.headers['Cache-Control'],'no-store');assert.ok(f.queries.every(q=>q.value==='owner-a'));
});
test('missing authentication, absent invitation and cross-origin requests cannot fetch or mutate',async()=>{
 for(const [options,request,status] of [[{user:null},req(),401],[{user:{id:'owner-b',app_metadata:{}}},req(),403],[{},req(body,'https://evil.test'),403],[{},req(body,null),403]]){
  const f=fixture(options),r=await f.POST(request);assert.equal(r.status,status);assert.equal(f.retrieveCalls(),0);assert.equal(f.serviceCalls(),0);assert.equal(f.writes.length,0);
 }
});
test('strict body rejects owner, target, recipient, findings overrides and missing attestation',async()=>{
 for(const payload of [null,[],{url}, {...body,authorized:false},{...body,owner_id:'other'},{...body,targetId:'other'},{...body,recipient:'other@test.com'},{...body,expectedFindingCodes:[]},{...body,url:'x'.repeat(3001)}]){
  const f=fixture(),r=await f.POST(req(payload));assert.equal(r.status,400);assert.equal(f.retrieveCalls(),0);assert.equal(f.writes.length,0);
 }
});
test('SSRF, alternate hosts, profile, shortened and ad-library URLs never reach retrieval',async()=>{
 for(const unsafe of ['http://127.0.0.1/posts/1','https://facebook.com.evil.test/a/posts/1','https://user:pass@facebook.com/a/posts/1','https://facebook.com/broker','https://facebook.com/share/p/abc','https://facebook.com/ads/library/?id=123','https://localhost/posts/1']){
  const f=fixture(),r=await f.POST(req({url:unsafe,authorized:true}));assert.equal(r.status,400);assert.equal(f.retrieveCalls(),0);
 }
});
for(const [label,capture,state] of [
 ['unpublished',{status:'unpublished',public:false},'unavailable'],
 ['blocked403',{status:'blocked',public:false,reason:'Private provider 403 details'},'unavailable'],
 ['wrong canonical',{canonicalUrl:'https://www.facebook.com/other/posts/456'},'identity_unverified'],
 ['unbound comment text',{postBound:false},'identity_unverified'],
 ['publisher absent',{targetId:undefined},'identity_unverified'],
 ['publisher invalid',{targetId:'unverified:someone'},'identity_unverified'],
 ['label absent',{text:'Greater Impact Realty — Jonesborough'},'label_missing'],
 ['different brokerage',{text:'COMPLIANCE TEST — FICTIONAL Another Brokerage — Jonesborough'},'brokerage_mismatch'],
 ['different office',{text:'COMPLIANCE TEST — FICTIONAL Greater Impact Realty — Knoxville'},'brokerage_mismatch'],
 ['firm outside labeled passage',{text:'Greater Impact Realty — Jonesborough\nCOMPLIANCE TEST — FICTIONAL\nAnother broker test'},'brokerage_mismatch'],
 ['capture missing',{contentHash:''},'capture_unverified'],
 ['capture stale',{capturedAt:'2020-01-01T00:00:00Z'},'capture_unverified'],
])test(`${label}: verification failure preserves saved target, schedule and recipient`,async()=>{
 const f=fixture({capture}),r=await f.POST(req());assert.equal(r.status,422);assert.equal(r.body.saved,false);assert.equal(r.body.state,state);assert.equal(f.writes.length,0);assert.deepEqual(f.config(),baseConfig);assert.ok(!JSON.stringify(r.body).includes('Private provider'));
});
test('successful verification updates only authenticated owner target fields, preserving schedule and recipient',async()=>{
 const f=fixture(),r=await f.POST(req());assert.equal(r.status,200);assert.equal(r.body.saved,true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].filter.owner_id,'owner-a');
 for(const key of ['enabled','next_run_at','pilot_recipient_override','pilot_recipient_authorized_by']){assert.equal(f.config()[key],baseConfig[key]);assert.ok(!Object.hasOwn(f.writes[0].value,key));}
 assert.equal(f.config().public_canary_url,url);assert.equal(f.config().expected_target_id,'facebook:publisher:broker');assert.deepEqual(Array.from(f.config().expected_finding_codes),[]);assert.match(r.body.message,/does not prove Facebook account ownership/);assert.match(r.body.message,/Saved monthly reports/);
 assert.ok(f.writes.every(w=>w.table==='eyeonads_reliability_configs'));assert.ok(f.queries.every(q=>q.value==='owner-a'));
});
test('new verified config is created disabled and without any guessed recipient',async()=>{
 const f=fixture({config:null}),r=await f.POST(req());assert.equal(r.status,200);assert.equal(f.config().owner_id,'owner-a');assert.equal(f.config().enabled,false);assert.equal(f.config().next_run_at,null);assert.equal(f.config().pilot_recipient_override,undefined);
});
test('missing backend, provider exception or save failure is not claimed saved',async()=>{
 for(const options of [{env:{SUPABASE_SERVICE_ROLE_KEY:''}},{throwRetrieve:true},{saveError:true}]){const f=fixture(options),r=await f.POST(req());assert.equal(r.status,503);assert.equal(r.body.saved,false);assert.ok(!JSON.stringify(r.body).includes('PRIVATE_PROVIDER_FAILURE'));}
});
test('standalone UI provides a real setup action, explicit authorization and recoverable retry without support dead ends',()=>{
 const react=require('react'),{renderToStaticMarkup}=require('react-dom/server');let index=0;
 const setup={brokerage:'Greater Impact Realty',office:'Jonesborough',copy_template:'COMPLIANCE TEST — FICTIONAL\nGreater Impact Realty — Jonesborough',configured:false,public_url:null,verified_at:null};
 const values=[setup,'',false,false,'Not saved: check public visibility.','',false,false];
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/PublicReliabilityTest.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>name==='react'?{...react,useState:initial=>[values[index++]??initial,()=>{}],useEffect:()=>{},useCallback:fn=>fn,useRef:()=>({current:null})}:require(name)});
 const html=renderToStaticMarkup(react.createElement(exports.PublicReliabilityTest));assert.match(html,/Copy test wording/);assert.match(html,/Verify and save public test/);assert.match(html,/Refresh saved setup/);assert.match(html,/I control this Facebook profile/);assert.match(html,/future checks/);assert.ok(!html.includes('/support'));assert.ok(html.includes('type="checkbox"'));
});

test('a URL without a verified publisher is not reported configured',async()=>{
 const f=fixture({config:{...baseConfig,expected_target_id:null}});const r=await f.GET();assert.equal(r.body.configured,false);
});
