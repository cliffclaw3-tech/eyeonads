import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {validAnalysis} from '../src/lib/scan-contract.ts';
import {completionText} from '../src/lib/completion-envelope.ts';
import {extractTextEvidence,normalizeTextReview} from '../src/lib/text-evidence.ts';
function providerFixture(result){
 const exports={};let captured;
 class OpenAI{constructor(){this.chat={completions:{create:async request=>{captured=request;return JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});}}};}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ad-review.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,process:{env:{}},require(name){if(name==='openai')return {default:OpenAI};if(name==='./scan-contract')return {validAnalysis};if(name==='./completion-envelope')return {completionText};if(name==='./text-evidence')return {extractTextEvidence,normalizeTextReview};throw Error(name);}});
 return {...exports,request:()=>captured};
}
test('reviewAdText fourth argument sends deterministic visible facts and normalizes source-only findings',async()=>{
 const source={result:'yellow',summary:'Partial source needs review.',flags:[{rule:'Incomplete context and third-party syndicated listing',severity:'yellow',explanation:'This is a partial source and third-party page.',recommendation:'Review the full ad.'}]};
 const f=providerFixture(source),result=await f.reviewAdText('Property ad','TN','Partial source',{firmName:'Greater Impact Realty',identityExcerpts:'Agent 443-643-5804 Greater Impact Realty Jonesborough 423-973-8634',partialSource:true});
 assert.equal(result.result,'green');assert.equal(result.flags.length,0);assert.match(result.summary,/not approval/);
 const prompt=f.request().messages[1].content;assert.match(prompt,/"firm_phone_visible":true/);assert.match(prompt,/"phone":"423-973-8634"/);
 assert.match(f.request().messages[0].content,/not issue flags/);assert.match(f.request().messages[0].content,/Presence does not establish/);
});
test('existing three-argument call keeps output contract and findings',async()=>{
 const source={result:'yellow',summary:'Context limitation.',flags:[{rule:'Incomplete context',severity:'yellow',explanation:'Partial context only.',recommendation:'Review.'}]};
 const f=providerFixture(source),result=await f.reviewAdText('Property ad','TN','Manual call');
 assert.equal(result.result,'yellow');assert.equal(result.flags.length,1);assert.equal(result.coverage_notes,undefined);
});
