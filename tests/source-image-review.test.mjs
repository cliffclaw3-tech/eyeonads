import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-image-review.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function load(readPublicImage,reviewAdImage){const exports={};vm.runInNewContext(js,{exports,require:name=>name==='./public-image'?{readPublicImage}:{reviewAdImage},Date});return exports.reviewSourceImage;}
test('no image or insufficient worker budget makes no provider request',async()=>{
 const run=load(()=>assert.fail('fetch'),()=>assert.fail('vision'));
 assert.equal((await run(undefined,Date.now()+110000)).status,'not_requested');
 assert.equal((await run({url:'https://example.com/a.jpg'},Date.now()+24000)).status,'unavailable');
});
test('source image review retains provenance but never persists base64 content',async()=>{
 const capture={data_url:'data:image/png;base64,aGVsbG8=',source_url:'https://example.com/ad',image_url:'https://example.com/img.png',role:'page_image',alt:'Property',sha256:'abc',retrieved_at:'2026-09-23T19:00:00Z'};
 const run=load(async()=>capture,async(data,context)=>{assert.equal(data,capture.data_url);assert.match(context,/not the complete ad/);return {status:'partial',observations:{creative_kind:'property_photo',eho:'not_visible'},notes:'Partial image only'};});
 const result=await run({url:capture.image_url},Date.now()+110000);
 assert.equal(result.capture.sha256,'abc');assert.equal(result.status,'partial');assert.equal('data_url' in result.capture,false);
});
test('image retrieval failure cannot manufacture missing EHO finding',async()=>{
 const run=load(async()=>{throw Error('403');},()=>assert.fail('vision'));
 const result=await run({url:'https://example.com/a.jpg'},Date.now()+110000);
 assert.equal(result.status,'unavailable');assert.equal(result.observations,null);assert.match(result.notes,/No missing disclosure was established/);
});
