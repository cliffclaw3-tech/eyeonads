import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function subject(response){
 let request;const requests=[];
 const exports={};
 const source=ts.transpileModule(fs.readFileSync('src/lib/web-discovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,process:{env:{OPENAI_API_KEY:'stub'}},Date,Set,JSON,Error,require:name=>{
 if(name==='openai')return {default:class{async post(path,args){request={path,...args};requests.push(request);return typeof response==='function'?response(request):response;}}};
 if(name==='./discovered-ad-contract')return {discoveredSchema:{}};
 throw Error(name);
 }});
 return {...exports,request:()=>request,requests:()=>requests};
}
const envelope={status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',queries:['Agent Firm property']}}],output_text:JSON.stringify({identity_note:'Sample',coverage_gaps:[],candidates:[]})};
test('search handles gateway string envelope before SDK response helpers',async()=>{
 const s=subject(JSON.stringify(envelope));
 const result=await s.discoverMarketing({agent_name:'Agent',brokerage:'Firm'});
 assert.equal(result.found.candidates.length,0);assert.equal(result.searchQueries[0],'Agent Firm property');
 assert.equal(s.request().path,'/responses');assert.equal(s.request().body.max_tool_calls,3);
});
test('incomplete response or missing completed search is never successful empty coverage',async()=>{
 for(const raw of [{...envelope,status:'incomplete'},{...envelope,output:[]},'not json']){
  await assert.rejects(subject(raw).discoverMarketing({agent_name:'Agent',brokerage:'Firm'}));
 }
});
test('over-cap malformed source list is rejected',async()=>{
 await assert.rejects(subject({...envelope,output_text:JSON.stringify({identity_note:'sample',coverage_gaps:[],candidates:Array(7).fill({})})}).discoverMarketing({agent_name:'Agent',brokerage:'Firm'}),/Search incomplete/);
});

test('readable and unrestricted passes both run; a failed pass remains a coverage gap',async()=>{
 const s=subject(request=>{if(request.body.tools[0].filters)throw Error('temporary');return envelope;});
 const result=await s.discoverMarketing({agent_name:'Agent',brokerage:'Firm'});
 assert.equal(s.requests().length,2);
 assert(s.requests().some(r=>r.body.tools[0].filters));assert(s.requests().some(r=>!r.body.tools[0].filters));
 assert.equal(result.incompletePasses,1);assert.match(result.found.coverage_gaps.join(' '),/pass failed/);
});
