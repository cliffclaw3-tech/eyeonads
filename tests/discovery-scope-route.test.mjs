import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function route({user={id:'owner',app_metadata:{eyeonads_pilot:true}},job=null}={}) {
 const updates=[];const db={auth:{getUser:async()=>({data:{user}})},from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='eyeonads_brokerage_setups'?{agents:[{id:'jones-1'},{id:'other-1'}]}:job})})}),update:row=>{updates.push(row);return {eq:()=>({select:()=>({single:async()=>({data:{discovery_agent_ids:row.discovery_agent_ids,discovery_location:row.discovery_location}})})})};}})};
 const mod={exports:{}};const js=ts.transpileModule(fs.readFileSync('src/app/api/brokerage/discovery-scope/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(js,{module:mod,exports:mod.exports,require:name=>name==='next/server'?{NextResponse:{json:(body,options)=>({body,status:options.status})}}:name==='@/lib/supabase/server'?{createClient:async()=>db}:name==='@/lib/discovery-jobs'?{sameOrigin:r=>r.originOK}:null});
 return {updates,post:(body,originOK=true)=>mod.exports.POST({originOK,json:async()=>body})};
}
test('office scope refuses unauthenticated, nonpilot and cross-origin changes',async()=>{
 for(const [opts,origin,status] of [[{user:null},true,401],[{user:{id:'owner',app_metadata:{}}},true,403],[{},false,403]]){const r=route(opts);assert.equal((await r.post({agent_ids:['jones-1']},origin)).status,status);assert.equal(r.updates.length,0);}
});
test('office scope rejects unsaved IDs, duplicates, empty subsets and active batch changes',async()=>{
 for(const ids of [[],['unknown'],['jones-1','jones-1']]){const r=route();assert.equal((await r.post({agent_ids:ids})).status,400);assert.equal(r.updates.length,0);}
 for(const status of ['running','paused']){const r=route({job:{status}});assert.equal((await r.post({agent_ids:['jones-1']})).status,409);assert.equal(r.updates.length,0);}
});
test('office subset and reset update scope without replacing the full roster',async()=>{
 const r=route();let result=await r.post({agent_ids:['jones-1'],location:'Jonesborough, Tennessee'});assert.equal(result.body.location,'Jonesborough, Tennessee');assert.equal(result.status,200);assert.equal(result.body.scoped_count,1);assert.equal(result.body.roster_count,2);assert.equal(r.updates[0].agents,undefined);
 result=await r.post({agent_ids:null});assert.equal(result.body.scoped_count,2);assert.equal(r.updates[1].discovery_agent_ids,null);assert.equal(r.updates[1].discovery_location,null);assert.equal(r.updates[1].agents,undefined);
});
