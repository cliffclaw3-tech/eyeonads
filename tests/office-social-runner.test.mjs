import test from 'node:test';
import * as crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync(new URL('../src/lib/office-social-runner.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const rotation={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/discovery-rotation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:rotation,Date,Error,Set,Map});
const setup={name:'Greater Impact Realty',discovery_location:'Jonesborough, Tennessee',agents:[{id:'j',name:'Jane Jones'},{id:'k',name:'Kevin Knoxville'}],discovery_agent_ids:['j']};
const card={library_id:'123456',source_url:'https://www.facebook.com/ads/library/?id=123456',observed_page_url:'https://www.facebook.com/ads/library/',captured_at:'2026-09-23T19:00:00Z',advertiser:{name:'Third Party',url:'https://www.facebook.com/thirdparty'},current_page_advertiser:null,attribution_note:'Publisher is not proof of brokerage ownership.',active:'active',started_running:'Sep 20, 2026',visible_text:'Active\nLibrary ID: 123456\nStarted running on Sep 20, 2026\nThird Party\nSponsored\nNew home in Jonesborough TN | Greater Impact Realty Jonesborough\nLearn more',truncated:false,media:[{kind:'video_poster',url:'https://cdn.example.com/poster.jpg',alt:'Poster'}],media_scope:'video_poster_only'};
function load(overrides={}){let collected=0;const exports={};vm.runInNewContext(source,{exports,Date,Error,Promise,URL,require:name=>{
 if(name==='node:crypto')return {...crypto,randomUUID:()=> 'run-id'};
 if(name==='./discovery-rotation')return rotation;
 if(name==='./office-social-contract')return {OFFICE_SOCIAL_ID:'__office_public_social__'};
 if(name==='./meta-browser')return {collectMetaAds:async query=>{collected++;assert.equal(query,'Greater Impact Realty Jonesborough');return {status:'available',reason:'Sample',observed_page_url:'https://www.facebook.com/ads/library/',captured_at:card.captured_at,cards:[card],...overrides.found};}};
 if(name==='./public-image')return {readPublicImage:async()=>{if(overrides.imageFailure)throw Error('Unavailable');return {data_url:'data:image/jpeg;base64,YQ==',source_url:card.source_url,image_url:card.media[0].url,sha256:'a'.repeat(64),retrieved_at:card.captured_at};}};
 if(name==='./image-review')return {reviewAdImage:async()=>({status:'reviewed',observations:{creative_kind:'complete_ad',eho:'not_visible'},notes:'Image only'})};
 if(name==='./ad-review')return {reviewAdText:async()=>{if(overrides.textFailure)throw Error('Assessment unavailable');return {result:'yellow',summary:'Partial source; verify.',flags:[]};}};throw Error(name);
 }});return {...exports,collected:()=>collected};}
function database(prior=null){let saved;const query={eq(){return this},select(){return this},async single(){return {data:saved,error:null}}};return {rpc:async()=>({data:true}),from:()=>({select:()=>({eq(){return this},async maybeSingle(){return {data:prior,error:null}}}),update:value=>{saved=value;return query;}})};}
test('scope excludes other office names and unrelated brokerage matches',()=>{const m=load();assert.equal(m.socialRelevance({...card,visible_text:'Kevin Knoxville | Greater Impact Realty Knoxville'},setup),null);assert.equal(m.socialRelevance({...card,visible_text:'Other Firm Jonesborough'},setup),null);assert.equal(m.socialRelevance(card,setup).relevance,'office_reference');assert.equal(m.socialRelevance({...card,visible_text:'Jane Jones Greater Impact Realty listing in Knoxville'},setup).relevance,'roster_name_match');});
test('video poster evidence stays partial, saved bytes remain bound to ad and roster counts are untouched',async()=>{const m=load();const result=await m.runOfficeSocial(database(),'owner',setup);const ad=result.evidence.ads[0];assert.equal(ad.library_id,card.library_id);assert.equal(ad.image_review.capture.source_url,card.source_url);assert.equal(ad.image_data_url,'data:image/jpeg;base64,YQ==');assert.equal(ad.image_review.status,'partial');assert.match(ad.image_review.notes,/video poster/);assert.equal(ad.matched_agent_ids.length,0);assert.equal(ad.text_review_status,'reviewed');assert.ok(!ad.ad_text.includes('Sponsored'));});
test('unavailable acquisition is saved as a coverage gap without false ad assessments',async()=>{const m=load({found:{status:'unavailable',reason:'login_required',cards:[]}});const result=await m.runOfficeSocial(database(),'owner',setup);assert.equal(result.evidence.ads.length,0);assert.equal(result.evidence.acquisition_status,'unavailable');assert.match(result.evidence.coverage_gaps.join(' '),/not a clean compliance result/);});
test('one social capture per batch, with stale-running recovery',async()=>{const m=load();await m.runOfficeSocial(database({status:'complete',searched_at:'2026-09-23T19:10:00Z'}),'owner',setup,'2026-09-23T19:00:00Z');assert.equal(m.collected(),0);await m.runOfficeSocial(database({status:'running',searched_at:'2020-01-01T00:00:00Z'}),'owner',setup,'2019-01-01T00:00:00Z');assert.equal(m.collected(),1);});
test('a complete-looking still asset cannot become a claim that the whole Meta post was reviewed',async()=>{const still={...card,media_scope:'still_creative',media:[{...card.media[0],kind:'image'}]};const m=load({found:{cards:[still]}});const result=await m.runOfficeSocial(database(),'owner',setup);assert.equal(result.evidence.ads[0].image_review.status,'partial');assert.match(result.evidence.ads[0].image_review.notes,/surrounding Meta post/);});

test('social assessment context includes captured run dates without confusing ad and property status',()=>{const m=load();const context=m.socialReviewContext(card,'Office reference only');assert.match(context,/Sep 20, 2026/);assert.match(context,/2026-09-23T19:00:00Z/);assert.match(context,/activity at capture: active/);assert.match(context,/not proof of property availability/);});

const manyCards=count=>Array.from({length:count},(_,i)=>({...card,library_id:String(100001+i),source_url:`https://www.facebook.com/ads/library/?id=${100001+i}`,visible_text:card.visible_text.replace('123456',String(100001+i))}));
test('social rotation assesses four current eligible cards and never starves a fifth',async()=>{
 const cards=manyCards(5),m=load({found:{cards}});const first=await m.runOfficeSocial(database(),'owner',setup);
 assert.equal(first.evidence.ads.length,4);assert.equal(first.evidence.inventory.length,5);assert.equal(first.evidence.rotation.assessed_this_run,4);assert.equal(first.evidence.rotation.deferred,1);
 const deferred=first.evidence.deferred_ids[0];assert.equal(first.evidence.inventory.find(item=>item.id===deferred).last_assessed_at,null);

 // Earlier successful timestamps remain valid; the deterministic helper is tested directly for the next observation.
 const next=rotation.rotateDiscoverySources({observed:cards.map(c=>({id:c.library_id,url:c.source_url,title:'Third Party',content_hash:m.socialContentHash(c)})),previous:first.evidence.inventory,now:new Date(Date.now()+1000).toISOString(),batchLimit:4,inventoryLimit:20,eligibleIds:cards.map(c=>c.library_id)});
 assert.equal(next.selected[0].id,deferred);
});
test('brokerage-only cards remain metadata and are excluded from office assessments',async()=>{
 const unknown={...card,library_id:'777777',visible_text:'Active\nSponsored\nGreater Impact Realty business promotion\nLearn more'};
 const m=load({found:{cards:[unknown,card]}});const result=await m.runOfficeSocial(database(),'owner',setup);
 assert.equal(result.evidence.ads.length,1);assert.equal(result.evidence.ads[0].library_id,card.library_id);assert.equal(result.evidence.rotation.office_unverified,1);assert.equal(result.evidence.inventory.length,2);
 assert.equal(result.evidence.inventory.find(item=>item.id==='777777').last_assessed_at,null);
});
test('failed text assessment and image-only success never advance rotation assessment date',async()=>{
 const m=load({textFailure:true});const r=await m.runOfficeSocial(database(),'owner',setup);
 assert.equal(r.evidence.ads[0].image_review.status,'partial');assert.equal(r.evidence.rotation.assessed_this_run,0);assert.equal(r.evidence.rotation.selected_unassessed,1);assert.equal(r.evidence.inventory[0].last_assessed_at,null);
});
test('social rotation retains old metadata without assessing a card absent from the current observation',async()=>{
 const m=load();const first=await m.runOfficeSocial(database(),'owner',setup);
 const prior={status:'complete',searched_at:new Date().toISOString(),evidence:first.evidence};
 const absent=load({found:{cards:[],captured_at:new Date(Date.now()+1000).toISOString()}});
 const r=await absent.runOfficeSocial(database(prior),'owner',setup);
 assert.equal(r.evidence.ads.length,0);assert.equal(r.evidence.inventory.length,1);assert.equal(r.evidence.inventory[0].last_seen_at,card.captured_at);assert.equal(r.evidence.rotation.eligible,0);
});
test('social content fingerprint ignores signed URL token churn but detects visible text changes',()=>{
 const m=load(),a={...card,media:[{...card.media[0],url:'https://cdn.example.com/poster.jpg?token=one'}]},b={...a,media:[{...a.media[0],url:'https://cdn.example.com/poster.jpg?token=two'}]};
 assert.equal(m.socialContentHash(a),m.socialContentHash(b));assert.notEqual(m.socialContentHash(a),m.socialContentHash({...a,visible_text:a.visible_text+' New price'}));
});

test('repeated text failures rotate behind deferred unattempted cards while remaining unassessed',async()=>{
 const cards=manyCards(5),m=load({textFailure:true,found:{cards}});const first=await m.runOfficeSocial(database(),'owner',setup);
 assert.equal(first.evidence.rotation.assessed_this_run,0);
 const deferred=first.evidence.deferred_ids[0],now=new Date(Date.now()+1000).toISOString();
 assert.equal(first.evidence.inventory.filter(item=>item.last_attempted_at).length,4);
 assert(first.evidence.inventory.every(item=>item.last_assessed_at===null));
 const next=rotation.rotateDiscoverySources({observed:cards.map(c=>({id:c.library_id,url:c.source_url,title:'Third Party',content_hash:m.socialContentHash(c)})),previous:first.evidence.inventory,now,batchLimit:4,inventoryLimit:20,eligibleIds:cards.map(c=>c.library_id)});
 assert.equal(next.selected[0].id,deferred);
});
test('legacy three-card evidence migrates and the previously omitted fourth card gets priority',()=>{
 const m=load(),cards=manyCards(4),now=new Date().toISOString();
 const prior={retrieved_at:card.captured_at,ads:cards.slice(0,3).map(c=>({...c,text_review_status:'reviewed',text_review:{result:'green',flags:[],summary:'No issues'}}))};
 const inventory=m.previousSocialInventory(prior,now);assert.equal(inventory.length,3);assert(inventory.every(item=>item.last_assessed_at===card.captured_at));
 const next=rotation.rotateDiscoverySources({observed:cards.map(c=>({id:c.library_id,url:c.source_url,title:'Third Party',content_hash:m.socialContentHash(c)})),previous:inventory,now,batchLimit:4,inventoryLimit:20,eligibleIds:cards.map(c=>c.library_id)});
 assert.equal(next.selected[0].id,cards[3].library_id);assert.equal(next.selected.length,4);
});
test('social capture retains no more than twenty metadata cards and assesses at most four',async()=>{
 const m=load({found:{cards:manyCards(25)}});const result=await m.runOfficeSocial(database(),'owner',setup);
 assert.equal(result.evidence.inventory.length,20);assert.equal(result.evidence.observed_cards.length,20);assert.equal(result.evidence.ads.length,4);assert.equal(result.evidence.rotation.deferred,16);
 assert(result.evidence.inventory.every(item=>!('image_data_url' in item)&&!('visible_text' in item)));
});
