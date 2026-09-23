import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validScanInput, validAnalysis } from '../src/lib/scan-contract.ts';
import { competitorExamples, competitiveBrief } from '../src/lib/competitor-examples.ts';
test('scan rejects malformed, unsupported, oversized and non-image inputs', () => {
  const valid = { ad_copy: 'Synthetic ad', state: 'TN' };
  assert.equal(validScanInput(valid), true);
  for (const bad of [null, {}, {...valid,ad_copy:[]}, {...valid,ad_copy:' '}, {...valid,ad_copy:'x'.repeat(10001)}, {...valid,state:'XX'}, {...valid,image_base64:'https://example.invalid'}, {...valid,user_id:42}]) assert.equal(validScanInput(bad), false);
});
test('provider shape must have usable flags and summary', () => {
  assert.equal(validAnalysis({result:'green',flags:[],summary:'Synthetic'}),true);
  for(const bad of [{result:'green',flags:null,summary:'a'}, {result:'green',flags:[{}],summary:'a'}, {result:'green',flags:[],summary:5}]) assert.equal(validAnalysis(bad),false);
});
test('ten distinct fictional fixtures produce bounded local study output', () => {
  assert.equal(competitorExamples.length,10); assert.equal(new Set(competitorExamples.map(e=>e.id)).size,10);
  for(const e of competitorExamples) assert.match(competitiveBrief(e.id,'my draft'),/Your draft: my draft/);
  assert.throws(()=>competitiveBrief('unknown',''));
});

test('upload filename is bounded and cannot carry path or control characters',()=>{
 const valid={ad_copy:'Ad',state:'TN',image_base64:'data:image/png;base64,YQ==',image_filename:'My home.png'};
 assert.equal(validScanInput(valid),true);
 for(const image_filename of ['',42,'x'.repeat(201),'../secret.png','a\\b.png','bad\nname.png'])assert.equal(validScanInput({...valid,image_filename}),false);
 assert.equal(validScanInput({...valid,image_base64:'data:image/png;base64,'+'A'.repeat(2000000)}),false);
});
