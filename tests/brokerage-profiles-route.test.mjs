import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as model from '../src/lib/social-identity.ts';
import {validateBrokerage} from '../src/lib/brokerage.ts';
const time='2026-09-29T12:19:27Z';
const old={id:'spark:1',name:'Example Agent',email:'',social_url:'',social_profiles:{x:model.submittedSocialIdentity('https://x.com/example',time)}};
const input={name:'Synthetic Firm',scope:'both',expected_agents:1,agents:[{id:old.id,name:old.name,email:''}]};
function setup({user={id:'synthetic-owner'},readError=false,writeError=false,scope=['spark:1']}={}) {
 let written;const filters=[];
 const db={auth:{getUser:async()=>({data:{user}})},from:table=>{
  assert.equal(table,'eyeonads_brokerage_setups');
  return {select:()=>({eq:(field,value)=>{filters.push([field,value]);return {maybeSingle:async()=>({data:{agents:[old],discovery_agent_ids:scope},error:readError?{}:null})};}}),upsert:payload=>{written=payload;return {select:()=>({single:async()=>({data:payload,error:writeError?{}:null})})};}};
 }};
 const exports={};
 const stubs={'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/brokerage':{validateBrokerage},'@/lib/social-identity':model};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/api/brokerage/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>stubs[name],URL,Date});
 return {...exports,written:()=>written,filters};
}
const request=(body=input,origin='https://eyeonads.com')=>({headers:{get:name=>({origin,host:'eyeonads.com'})[name]??null},json:async()=>body});
test('legacy roster POST preserves saved platform identities and only reads/writes authenticated owner',async()=>{
 const api=setup();const response=await api.POST(request());assert.equal(response.status,undefined);
 assert.equal(api.written().agents[0].social_profiles.x.recorded_at,old.social_profiles.x.recorded_at);
 assert.equal(api.written().owner_id,'synthetic-owner');assert.deepEqual(api.filters,[['owner_id','synthetic-owner']]);
 assert.equal(api.written().discovery_agent_ids,undefined);assert.equal(api.written().schedule,undefined);
});
test('roster profile patches remain unverified and cannot forge persisted ownership',async()=>{
 const api=setup();await api.POST(request({...input,agents:[{...input.agents[0],social_profiles:{instagram:'https://instagram.com/example'}}]}));
 assert.equal(api.written().agents[0].social_profiles.instagram.ownership,'unverified');assert.ok(api.written().agents[0].social_profiles.x);
 const forged=setup();assert.equal((await forged.POST(request({...input,agents:[{...input.agents[0],social_profiles:{x:{url:'https://x.com/example',ownership:'verified'}}}]}))).status,400);assert.equal(forged.written(),undefined);
});
test('auth, foreign origin, read error, scoped removal and normalized duplicate IDs cannot mutate roster',async()=>{
 const anon=setup({user:null});assert.equal((await anon.POST(request())).status,401);assert.equal(anon.written(),undefined);
 for(const origin of ['https://foreign.test','bad origin']){const api=setup();assert.equal((await api.POST(request(input,origin))).status,403);assert.equal(api.written(),undefined);}
 const read=setup({readError:true});assert.equal((await read.POST(request())).status,503);assert.equal(read.written(),undefined);
 const remove=setup();assert.equal((await remove.POST(request({...input,agents:[]}))).status,400);assert.equal(remove.written(),undefined);
 const dup=setup();assert.equal((await dup.POST(request({...input,expected_agents:2,agents:[{id:'id',name:'One',email:'one@example.test'},{id:' id ',name:'Two',email:'two@example.test'}]}))).status,400);assert.equal(dup.written(),undefined);
});
test('failed database save is not reported as successful profile persistence',async()=>{
 const api=setup({writeError:true});assert.equal((await api.POST(request())).status,503);
});
