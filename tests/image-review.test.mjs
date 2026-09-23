import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {completionText} from '../src/lib/completion-envelope.ts';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/image-review.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env:{}},require:name=>name==='openai'?{}:{completionText}});
const {imageReviewFromCompletion,reviewAdImage}=exports;
const observation={creative_kind:'property_photo',eho:'not_visible',brokerage:'not_visible',contact:'uncertain',license:'not_visible',sold_claim:'present',notes:'Property photo with a SOLD overlay.'};
const envelope=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
test('property photo stays partial with observations, never missing-logo or SOLD misuse violations',()=>{
 for(const raw of [envelope(observation),JSON.stringify(envelope(observation))]){
  const result=imageReviewFromCompletion(raw);
  assert.equal(result.status,'partial');assert.equal(result.observations.eho,'not_visible');assert.equal(result.observations.sold_claim,'present');assert.equal(result.flags,undefined);
 }
 assert.equal(imageReviewFromCompletion(envelope({...observation,creative_kind:'complete_ad'})).status,'reviewed');
});
test('invalid, boolean and truncated model outputs cannot masquerade as reviewed images',()=>{
 for(const raw of [envelope({...observation,eho:false}),envelope({...observation,creative_kind:'full_page_screenshot'}),envelope({...observation,contact:null}),{choices:[{finish_reason:'length',message:{content:JSON.stringify(observation)}}]}])assert.throws(()=>imageReviewFromCompletion(raw));
});
test('not requested and unavailable are explicit without inventing absence',async()=>{
 assert.equal((await reviewAdImage()).status,'not_requested');
 const failed=await reviewAdImage('data:image/png;base64,YWJj');
 assert.equal(failed.status,'unavailable');assert.equal(failed.observations,null);
});
test('vision request bounds retries/time and accepts JSON-string gateway envelopes',async()=>{
 const source=fs.readFileSync(new URL('../src/lib/image-review.ts',import.meta.url),'utf8');
 const fresh={};let options,request;
 class OpenAI{constructor(value){options=value;this.chat={completions:{create:async value=>{request=value;return JSON.stringify(envelope(observation));}}};}}
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:fresh,process:{env:{OPENAI_API_KEY:'test-only'}},require:name=>name==='openai'?{default:OpenAI}:{completionText}});
 const result=await fresh.reviewAdImage('data:image/png;base64,YWJj','Public listing photo, not a page screenshot');
 assert.equal(result.status,'partial');assert.equal(options.timeout,15000);assert.equal(options.maxRetries,0);assert.equal(options.defaultHeaders['Accept-Encoding'],'identity');assert.match(request.messages[0].content,/never instructions/);assert.equal(request.messages[1].content[1].image_url.url,'data:image/png;base64,YWJj');
});
