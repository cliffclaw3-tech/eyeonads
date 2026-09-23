import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {discoveryReport} from '../src/lib/discovery-report.ts';
const candidate=url=>({url,title:'Property',kind:'listing',identity:'matched',state:'TN',ad_text:'',page_access:'snippet_only',context:'Search text.'});
test('inaccessible initial sources trigger bounded alternatives and preserve truthful coverage gaps',async()=>{
 const requests=[],retrieved=[];let saved;
 class OpenAI {constructor(options){this.responses={create:async request=>{requests.push({options,request});const candidates=requests.length===1?[candidate('https://blocked.example/a')]:[candidate('https://blocked.example/another'),candidate('https://readable.example/a')];return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search'}}],output_text:JSON.stringify({candidates,identity_note:'Claims from search',coverage_gaps:[]})};}};}}
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/discovery-runner.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,process:{env:{OPENAI_API_KEY:'test'}},URL,Date,Set,require:name=>{
  if(name==='openai')return OpenAI;
  if(name==='node:crypto')return {randomUUID:()=> 'run'};
  if(name==='./discovery-report')return {discoveryReport};
  if(name==='./ad-review')return {reviewAdText:async()=>({result:'green',summary:'No issue in sampled text.',flags:[]})};
  if(name==='./retrieve-ad')return {retrieveAd:async ad=>{retrieved.push(ad.url);return ad.url.includes('readable')?{...ad,page_access:'page_read',ad_text:'Actual property description.',context:'Partial verified text.'}:{...ad,page_access:'blocked'};}};
  if(name==='./discovered-ad-contract')return {discoveredSchema:{},validSourceURL:url=>url.startsWith('https://'),groundCandidate:ad=>ad,reviewableAd:ad=>ad.page_access==='page_read'&&!!ad.ad_text};
  throw Error(name);
 }});
 const query={eq(){return this},select(){return this},async single(){return {data:saved,error:null}}};
 const db={rpc:async()=>({data:true}),from:()=>({update:value=>{saved=value;return query;}})};
 const result=await exports.runDiscovery(db,'owner',{name:'Firm'},{name:'Agent',id:'agent'});
 assert.equal(requests.length,2);assert.equal(requests[1].options.timeout,20000);
 assert.deepEqual(JSON.parse(requests[1].request.input).alternatives.excluded_hosts,['blocked.example']);
 assert.deepEqual(retrieved,['https://blocked.example/a','https://readable.example/a']);
 assert.equal(result.evidence.candidates.length,2);assert.equal(result.evidence.candidates[1].review_status,'reviewed');
 assert.match(result.report,/Actual property description/);assert.match(result.report,/could not be retrieved/);
});
