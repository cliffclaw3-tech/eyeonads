import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryReport} from '../src/lib/discovery-report.ts';
const blocked={url:'https://example.com/listing',title:'Example property',kind:'listing',identity:'matched',state:'TN',ad_text:'',page_access:'blocked',context:'Actual page accessible; extracted ad_text snippet_only.',review:null,review_status:'not_reviewed'};
test('final retrieval status overrides contradictory search-stage descriptions',()=>{
 const result=discoveryReport([blocked]);
 assert.match(result.report,/page could not be retrieved/);
 assert.doesNotMatch(result.report,/Actual page accessible|ad_text|snippet_only/);
 assert.match(result.identity_note,/0 sources/);
 assert.match(result.coverage_gaps[0],/No ad assessment is confirmed/);
});
test('assessed advertisements expose exact sampled text and provisional findings',()=>{
 const ad={...blocked,ad_text:'A house with a covered porch.',page_access:'page_read',context:'Partial text; images not reviewed.',review_status:'reviewed',review:{result:'yellow',summary:'Verify firm phone on full ad.',flags:[{rule:'Firm contact',explanation:'Partial context.',recommendation:'Open original source.'}]}};
 const result=discoveryReport([ad,blocked]);
 assert.match(result.identity_note,/1 source had/);
 assert.match(result.report,/Text assessed\nA house with a covered porch\./);
 assert.match(result.report,/Suggested assessment: YELLOW/);
 assert.match(result.report,/Next action: Open original source/);
 assert.match(result.report,/not compliance clearance/);
 assert.equal(result.sources.length,2);
});
