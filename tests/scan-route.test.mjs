import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import { validScanInput, validAnalysis } from '../src/lib/scan-contract.ts';
function route({user={id:'test-user'}, failSave=false, sink=false, paid=false}={}) {
  const writes=[]; let providerCalls=0;
  const supabase={auth:{getUser:async()=>({data:{user}})},from:()=>({insert:row=>{writes.push(row);return {select:()=>({single:async()=>failSave?{error:{message:'private'}}:{data:{id:'saved-test-id'}}})};}})};
  const testModule={exports:{}};
  const require=(name)=> {
    if(name==='next/server') return {NextResponse:{json:(body,options={})=>({body,status:options.status??200})}};
    if(name==='@/lib/supabase/server') return {createClient:async()=>supabase};
    if(name==='@/lib/ad-review') return {reviewAdText:async()=>{providerCalls++;throw Error('Provider calls forbidden');}};
    if(name==='node:crypto') return {createHash};
    if(name==='@/lib/image-review') return {reviewAdImage:async()=>{providerCalls++;return {status:'partial',observations:{creative_kind:'property_photo',eho:'not_visible',brokerage:'uncertain',contact:'uncertain',license:'not_visible',sold_claim:'not_visible',notes:'Property photograph.'},notes:'Partial image review only.'};}};
    if(name==='@/lib/scan-contract') return {validScanInput,validAnalysis};
    if(name==='openai'||name==='@anthropic-ai/sdk') return class {constructor(){providerCalls++;throw Error('Provider calls forbidden');}};
    throw Error(`Unexpected import ${name}`);
  };
  const js=ts.transpileModule(fs.readFileSync('src/app/api/scan/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(js,{module:testModule,exports:testModule.exports,require,Buffer,process:{env:{EYEONADS_CANARY_SINK:sink?'1':'0',EYEONADS_PAID_ANALYSIS_ENABLED:paid?'1':'0'}},console:{error(){}}});
  return {post:body=>testModule.exports.POST({json:async()=>body}),writes,calls:()=>providerCalls};
}
test('actual route fails unauthenticated and mismatched identities before persistence/provider',async()=>{
  for(const [options,body,status] of [[{user:null},{ad_copy:'test',state:'TN'},401],[{},{ad_copy:'test',state:'TN',user_id:'other'},403]]) {
    const r=route(options);assert.equal((await r.post(body)).status,status);assert.equal(r.writes.length,0);assert.equal(r.calls(),0);
  }
});
test('actual route returns saved id only after successful DB adapter readback',async()=>{
  const r=route(); const result=await r.post({ad_copy:'License 123. Equal Housing Opportunity.',state:'TN'});
  assert.equal(result.status,200);assert.equal(result.body.result.persisted,true);assert.equal(result.body.result.scan_id,'saved-test-id');
  assert.equal(result.body.result.result,'yellow');assert.equal(r.writes[0].user_id,'test-user');assert.equal(r.calls(),0);
});
test('DB error is not false saved success',async()=>{
  const r=route({failSave:true});const result=await r.post({ad_copy:'test',state:'TN'});
  assert.equal(result.status,503);assert.equal(result.body.result,undefined);assert.ok(!JSON.stringify(result).includes('private'));
});
test('sink disables image provider and persistence as well as text provider',async()=>{
  const r=route({sink:true});const result=await r.post({ad_copy:'test',state:'TN',image_base64:'data:image/png;base64,YQ=='});
  assert.equal(result.status,200);assert.equal(result.body.result.persisted,false);assert.equal(r.writes.length,0);assert.equal(r.calls(),0);
});
test('unavailable vision reports uncertainty without fabricated missing-image flags',async()=>{
  const r=route();const result=await r.post({ad_copy:'License 123. Equal Housing Opportunity.',state:'TN',image_base64:'data:image/png;base64,YQ=='});
  assert.equal(result.body.result.image_analysis_status,'unavailable');
  assert.equal(result.body.result.result,'yellow');
  assert.equal(result.body.result.flags.length,1);
  assert.equal(result.body.result.flags[0].rule,'Image review unavailable');
  assert.match(r.writes[0].ai_explanation,/unavailable/);
});

test('saved upload keeps exact bounded image, filename, digest and review scope on its own scan',async()=>{
  const r=route();const image='data:image/png;base64,YQ==';
  const saved=await r.post({ad_copy:'Ad A',state:'TN',image_base64:image,image_filename:'house-a.png'});
  const attachment=r.writes[0].image_attachment;
  assert.equal(attachment.filename,'house-a.png');assert.equal(attachment.data_url,image);
  assert.equal(attachment.sha256,createHash('sha256').update('a').digest('hex'));
  assert.equal(attachment.review_status,'unavailable');assert.match(attachment.captured_at,/^\d{4}-/);
  assert.equal(saved.body.result.image_attachment.data_url,image);
  await r.post({ad_copy:'Ad B',state:'TN'});assert.equal(r.writes[1].image_attachment,null);
  assert.equal(r.writes[0].image_attachment.filename,'house-a.png');
});
test('shared image review preserves partial scope and cannot fabricate property-photo logo violations',async()=>{
 const r=route({paid:true});const result=await r.post({ad_copy:'License 123. Equal Housing Opportunity.',state:'TN',image_base64:'data:image/png;base64,YQ=='});
 assert.equal(result.body.result.image_analysis_status,'partial');assert.equal(r.calls(),1);
 assert.equal(result.body.result.flags.length,1);assert.equal(result.body.result.flags[0].rule,'Image coverage is partial');
 assert.equal(r.writes[0].image_attachment.review_status,'partial');assert.equal(r.writes[0].image_attachment.observations.eho,'not_visible');
});
