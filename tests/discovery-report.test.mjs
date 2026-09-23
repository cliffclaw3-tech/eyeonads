import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryReport,coverageGap} from '../src/lib/discovery-report.ts';
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
test('image report differentiates partial observation, inaccessible image and legacy unchecked sources',()=>{
 const result=discoveryReport([{...blocked,image_review:{status:'partial',notes:'Only a property photo.',observations:{creative_kind:'property_photo',eho:'not_visible',brokerage:'not_visible',contact:'not_visible',license:'uncertain',notes:'No full ad captured.'},capture:{image_url:'https://example.com/photo.jpg',retrieved_at:'2026-09-23',sha256:'abc'}}},blocked]);
 assert.match(result.report,/Image type: property photo/);assert.match(result.report,/not determinations of a violation/);assert.match(result.report,/Captured source image/);assert.match(result.report,/Image review not performed/);
});

test('gap reasons distinguish access denial, stale pages, buyer attribution and unknown legacy failures',()=>{
 assert.match(coverageGap({...blocked,retrieval_failure:{cause:'forbidden',retryable:false}}),/403/);
 assert.doesNotMatch(coverageGap(blocked),/403|429|security challenge/);
 assert.match(coverageGap({...blocked,page_access:'page_read',retrieval_status:'no_promotional_content'}),/no longer represent a live/);
 assert.match(coverageGap({...blocked,page_access:'page_read',attribution:{role:'buyer_agent'}}),/buyer representative/);
 assert.match(coverageGap({...blocked,kind:'profile'}),/Only profile/);
});
