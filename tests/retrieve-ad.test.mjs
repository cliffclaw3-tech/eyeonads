import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicPageError,publicPageFailure} from '../src/lib/public-page.ts';
import {completionText,verifiedIdentitySpan} from '../src/lib/completion-envelope.ts';
const source={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-blocks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:source,require:()=>({verifiedIdentitySpan})});
const text='For sale, a bright home offers a covered porch and spacious sunny rooms. Listed by: Wes Shields • Greater Impact Realty Jonesborough. Firm phone 423-973-8634.';
const selection={contains_promotion:true,promotion_ids:[0],disclosure_ids:[],identity_confirmed:true,agent_block_id:0,brokerage_block_id:0,attribution_role:'listing_agent',attribution_ids:[0],attribution_evidence:'Listed by: Wes Shields • Greater Impact Realty Jonesborough.',state:'TN',context:'Partial ad text.'};
const ad={url:'https://example.com/ad',title:'Home',kind:'listing',identity:'matched',state:'TN',ad_text:'',context:'Index lead',page_access:'snippet_only'};
function setup({pageErrors=[],selections=[selection],providerErrors=[],pageText=text}={}){
 let fetches=0,requests=0;const options=[];
 class OpenAI{constructor(config){this.chat={completions:{create:async request=>{options.push({config,request});const i=requests++;if(providerErrors[i])throw providerErrors[i];return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(selections[Math.min(i,selections.length-1)])}}]};}}};}}
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/retrieve-ad.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,process:{env:{OPENAI_API_KEY:'test'}},Date,Set,setTimeout:callback=>{callback();return 1},require:name=>{
 if(name==='openai')return OpenAI;
 if(name==='./completion-envelope')return {completionText};
 if(name==='./source-blocks')return source;
 if(name==='./public-page')return {publicPageFailure,readPublicPage:async()=>{const error=pageErrors[fetches++];if(error)throw error;return {url:ad.url,text:pageText,truncated:false,sha256:'proof',retrieved_at:'2026-09-23T21:00:00Z',image_candidates:[]};}};
 throw Error(name);
 }});return {run:options=>exports.retrieveAd(ad,'Wes Shields','Greater Impact Realty',options),stats:()=>({fetches,requests,options})};
}
test('fresh attributed selection retains exact capture and structured provider contract',async()=>{const h=setup(),r=await h.run();assert.equal(r.retrieval_status,'verified');assert.equal(r.attribution.verified,true);assert.equal(r.capture.sha256,'proof');assert.match(r.ad_text,/covered porch/);assert.equal(h.stats().options[0].request.response_format.type,'json_schema');});
test('permanent public failures are diagnosed without retry or assessment',async()=>{
 for(const [cause,status] of [['forbidden',403],['unauthorized',401],['not_found',404],['challenge',200],['oversize',200],['unsupported_type',200]]){const h=setup({pageErrors:[new PublicPageError(cause,false,status)]}),r=await h.run();assert.equal(r.retrieval_failure.cause,cause);assert.equal(r.retrieval_failure.http_status,status);assert.equal(h.stats().fetches,1);assert.equal(h.stats().requests,0);assert.equal(r.ad_text,'');}
});
test('temporary retrieval retries once, while an expired caller deadline performs no work',async()=>{const h=setup({pageErrors:[new PublicPageError('server_error',true,503)]});assert.equal((await h.run()).retrieval_status,'verified');assert.equal(h.stats().fetches,2);const d=setup();assert.equal((await d.run({deadline:Date.now()-1})).retrieval_failure.cause,'deadline');assert.equal(d.stats().fetches,0);});
test('negative extractor decisions do not retry; invalid IDs retry only once',async()=>{
 for(const [value,status] of [[{...selection,contains_promotion:false,promotion_ids:[]},'no_promotional_content']]){const h=setup({selections:[value]}),r=await h.run();assert.equal(r.retrieval_status,status);assert.equal(h.stats().requests,1);assert.equal(r.ad_text,'');assert.ok(r.capture);}
 const h=setup({selections:[{...selection,promotion_ids:[999]},selection]});assert.equal((await h.run()).retrieval_status,'verified');assert.equal(h.stats().requests,2);
 const fail=setup({selections:[{...selection,promotion_ids:[999]}]});assert.equal((await fail.run()).retrieval_status,'invalid_block_ids');assert.equal(fail.stats().requests,2);
});
test('buyer source attribution cannot leak assessable text even when model claims listing role',async()=>{const h=setup({pageText:'A spacious home with a covered porch. Listed by Other Agent Other Realty. Sold By Greater Impact Realty Jonesborough, Wes Shields.',selections:[{...selection,attribution_role:'listing_agent'}]}),r=await h.run();assert.equal(r.retrieval_status,'identity_unverified');assert.equal(r.ad_text,'');assert.equal(r.identity,'uncertain');assert.equal(r.attribution.verified,false);});

test('missing model identity fields do not veto a verified contiguous source identity',async()=>{
 const h=setup({selections:[{...selection,identity_confirmed:false,agent_block_id:null,brokerage_block_id:null,attribution_role:'unknown',attribution_ids:[],attribution_evidence:''}]});const result=await h.run();assert.equal(result.retrieval_status,'verified');assert.match(result.identity_evidence.brokerage,/Greater Impact Realty/);assert.equal(result.selection_attempts,1);
});
