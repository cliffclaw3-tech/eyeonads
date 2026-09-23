import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewableAd,validSourceURL} from '../src/lib/discovered-ad-contract.ts';
const ad={url:'https://example.com/ad',identity:'matched',kind:'advertisement',page_access:'page_read',ad_text:'An actual property advertisement.',state:'TN'};
test('only matched accessible advertising with known jurisdiction enters the engine',()=>{
 assert.equal(reviewableAd(ad),true);
 for(const change of [{kind:'profile'},{identity:'uncertain'},{page_access:'snippet_only'},{page_access:'blocked'},{state:'unknown'},{ad_text:''},{url:'javascript:alert(1)'}])assert.equal(reviewableAd({...ad,...change}),false);
});
test('source links reject active schemes and embedded credentials',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,x','https://name:secret@example.com/','broken'])assert.equal(validSourceURL(url),false);
 assert.equal(validSourceURL('https://example.com/listing'),true);
});

 test('unconfirmed page-reading cannot become an ad assessment', async()=>{
 const {groundCandidate}=await import('../src/lib/discovered-ad-contract.ts');
 const ad={url:'https://example.com/ad',title:'Ad',kind:'advertisement',identity:'matched',state:'TN',ad_text:'Property for sale',context:'',page_access:'page_read'};
 assert.equal(reviewableAd(groundCandidate(ad,new Set())),false);
 assert.equal(groundCandidate(ad,new Set()).ad_text,'');
 assert.equal(reviewableAd(groundCandidate(ad,new Set(['https://example.com/ad#detail']))),true);
 });
