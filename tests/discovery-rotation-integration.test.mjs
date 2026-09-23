import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as rotation from '../src/lib/discovery-rotation.ts';
import {discoveryReport} from '../src/lib/discovery-report.ts';
const candidate=id=>({url:`https://fixture.test/${id}`,title:id,kind:'listing',identity:'matched',state:'TN',ad_text:'',page_access:'snippet_only',context:'Indexed fixture.'});
function fixture({initial=[],fresh=[],alternatives=[],reviewed=false}={}){
 let saved,previous=initial.length?{searched_at:'2026-09-01T00:00:00Z',evidence:{source_inventory:initial}}:null;
 const retrievals=[],searches=[];
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/discovery-runner.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,Set,Map,require:name=>{
  if(name==='./discovery-rotation')return rotation;
  if(name==='node:crypto')return {randomUUID:()=> 'fixture-run'};
  if(name==='./discovery-report')return {discoveryReport};
  if(name==='./web-discovery')return {discoverMarketing:async input=>{searches.push(input);return {found:{candidates:input.alternatives?alternatives:fresh},openedURLs:new Set(),searchQueries:['fixture']};}};
  if(name==='./retrieve-ad')return {retrieveAd:async(ad,agent,firm,options)=>{retrievals.push({url:ad.url,options});return reviewed?{...ad,identity:'matched',state:'TN',page_access:'page_read',ad_text:'Actual supplied property advertising.',capture:{sha256:`hash:${ad.url}`,retrieved_at:new Date().toISOString()},image_data_url:'SECRET_BYTES'}:{...ad,page_access:'blocked'};}};
  if(name==='./ad-review')return {reviewAdText:async()=>({result:'green',summary:'Sampled text reviewed.',flags:[]})};
  if(name==='./source-image-review')return {reviewSourceImage:async()=>({status:'not_requested',notes:'No image.'})};
  if(name==='./discovered-ad-contract')return {validSourceURL:url=>typeof url==='string'&&url.startsWith('https://'),groundCandidate:ad=>ad,reviewableAd:ad=>ad.page_access==='page_read'&&ad.ad_text.length>0};
  throw Error(name);
 }});
 const q={eq(){return this},select(){return this},async single(){return {data:saved,error:null}}};
 const db={rpc:async()=>({data:true,error:null}),from:()=>({select:()=>({eq(){return this},async maybeSingle(){return {data:previous,error:null}}}),update:value=>{saved=value;return q;}})};
 return {retrievals,searches,async run(){const result=await exports.runDiscovery(db,'fixture-owner',{name:'Fixture firm'},{id:'fixture-agent',name:'Fixture agent'});previous={searched_at:result.searched_at,evidence:result.evidence};return result;}};
}
const inventory=(id,assessed=false)=>({id:`https://fixture.test/${id}`,url:`https://fixture.test/${id}`,title:id,last_seen_at:'2026-09-01T00:00:00Z',last_assessed_at:assessed?'2026-09-01T00:00:00Z':null,assessed_content_hash:null,content_changed_since_assessment:false});
test('runner limits primary6 and alternative3 even if a discovery provider exceeds both bounds',async()=>{
 const f=fixture({fresh:Array.from({length:10},(_,i)=>candidate(`primary-${i}`)),alternatives:Array.from({length:10},(_,i)=>({...candidate(`extra-${i}`),url:`https://alternative.test/extra-${i}`}))});
 const report=await f.run();assert.equal(f.retrievals.length,9);assert.equal(report.evidence.attempted_sources,9);assert.equal(report.evidence.source_inventory.length,9);
 assert.equal(report.evidence.source_rotation.counts.observed,9);assert.equal(report.evidence.source_rotation.successfully_assessed_this_run,0);
 assert.equal(report.evidence.source_rotation.counts.previously_assessed,0);assert.ok(f.retrievals.every(x=>typeof x.options.deadline==='number'));
});
test('unassessable first six do not starve three deferred historical sources on next run',async()=>{
 const f=fixture({initial:'abcdefghi'.split('').map(id=>inventory(id)),fresh:'abcdef'.split('').map(candidate)});
 const first=await f.run();assert.deepEqual(f.retrievals.map(x=>x.url),'abcdef'.split('').map(id=>candidate(id).url));
 assert.equal(first.evidence.source_rotation.counts.deferred,3);assert.equal(first.evidence.source_rotation.counts.previously_assessed,0);
 f.retrievals.length=0;const second=await f.run();assert.deepEqual(f.retrievals.slice(0,3).map(x=>x.url),'ghi'.split('').map(id=>candidate(id).url));
 assert.equal(second.evidence.source_rotation.counts.previously_assessed,0);assert.ok(second.evidence.source_inventory.every(x=>x.last_assessed_at===null));
 assert.equal(second.evidence.source_inventory.find(x=>x.title==='g').last_seen_at,'2026-09-01T00:00:00Z');
});
test('new sources are assessed with hashes while old retained history and explicit evictions stay separate',async()=>{
 const f=fixture({initial:Array.from({length:9},(_,i)=>inventory(`old-${i}`,true)),fresh:Array.from({length:6},(_,i)=>candidate(`new-${i}`)),reviewed:true});
 const report=await f.run();assert.equal(f.searches.length,1);assert.equal(f.retrievals.length,6);assert.equal(report.evidence.source_inventory.length,9);
 assert.equal(report.evidence.source_rotation.evicted.length,6);assert.equal(report.evidence.source_rotation.successfully_assessed_this_run,6);
 const current=report.evidence.source_inventory.filter(x=>x.title.startsWith('new-'));assert.equal(current.length,6);assert.ok(current.every(x=>x.last_assessed_at&&x.assessed_content_hash===`hash:${x.url}`));
 assert.ok(!JSON.stringify(report.evidence.source_inventory).includes('SECRET_BYTES'));
 assert.equal(report.evidence.source_inventory.filter(x=>x.title.startsWith('old-')).length,3);
 assert.ok(report.evidence.watch_sources.every(x=>x.url&&x.title&&x.kind));
});
