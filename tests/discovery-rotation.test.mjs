import test from 'node:test';
import assert from 'node:assert/strict';
import {rotateDiscoverySources,markDiscoverySourcesAssessed,markDiscoverySourcesAttempted} from '../src/lib/discovery-rotation.ts';
const t0='2026-09-01T00:00:00Z',t1='2026-09-02T00:00:00Z',t2='2026-09-03T00:00:00Z';
const source=(id,hash)=>({id,url:`https://example.test/${id}`,title:`Source ${id}`,...(hash?{content_hash:hash}:{})});
function rotate(observed,previous=[],extra={}){return rotateDiscoverySources({observed,previous,now:t1,batchLimit:3,inventoryLimit:20,...extra});}
test('rotation reaches the fourth source instead of permanently assessing the same first three',()=>{
 const observed=['a','b','c','d'].map(id=>source(id));const first=rotate(observed);
 assert.deepEqual(first.selected.map(x=>x.id),['a','b','c']);assert.equal(first.counts.previously_assessed,0);
 const saved=markDiscoverySourcesAssessed(first.inventory,first.selected.map(x=>x.id),t1);
 const next=rotate(observed,saved,{now:t2});assert.equal(next.selected[0].id,'d');assert.equal(next.selected[0].priority,'never_assessed');
 assert.equal(next.counts.previously_assessed,3);assert.equal(next.counts.never_assessed,1);
});
test('new six plus historical nine retain all fifteen while selecting only six',()=>{
 const old=rotate(Array.from({length:9},(_,i)=>source(`old-${i}`)),[],{now:t0,batchLimit:6});
 const saved=markDiscoverySourcesAssessed(old.inventory,old.inventory.map(x=>x.id),t0);
 const next=rotate(Array.from({length:6},(_,i)=>source(`new-${i}`)),saved,{batchLimit:6});
 assert.equal(next.inventory.length,15);assert.equal(next.selected.length,6);assert.equal(next.deferred.length,9);
 assert.ok(next.selected.every(x=>x.id.startsWith('new-')));assert.equal(next.inventory.find(x=>x.id==='old-0').last_seen_at,t0);
 assert.equal(next.counts.previously_assessed,9);assert.equal(next.counts.observed,6);
});
test('changed content outranks old unchanged assessment and survives deferral',()=>{
 const initial=rotate([source('a','hash-a'),source('b','hash-b')],[],{now:t0});
 const saved=markDiscoverySourcesAssessed(initial.inventory,['a','b'],t0);
 const changed=rotate([source('b','new-b')],saved,{batchLimit:0});
 assert.equal(changed.deferred[0].id,'b');assert.equal(changed.deferred[0].priority,'changed_content');
 const later=rotate([],changed.inventory,{now:t2,batchLimit:1});assert.equal(later.selected[0].id,'b');assert.equal(later.selected[0].observed_this_run,false);
 assert.equal(later.selected[0].last_assessed_at,t0);assert.equal(later.selected[0].last_seen_at,t1);
 const done=markDiscoverySourcesAssessed(later.inventory,['b'],t2);assert.equal(done.find(x=>x.id==='b').assessed_content_hash,'new-b');assert.equal(done.find(x=>x.id==='b').content_changed_since_assessment,false);
});
test('same assessed hash clears a reverted change, unknown hash does not erase a known change',()=>{
 const old=markDiscoverySourcesAssessed(rotate([source('a','original')],[],{now:t0}).inventory,['a'],t0);
 const changed=rotate([source('a','changed')],old).inventory;
 assert.equal(rotate([source('a')],changed,{now:t2}).inventory[0].content_changed_since_assessment,true);
 assert.equal(rotate([source('a','original')],changed,{now:t2}).inventory[0].content_changed_since_assessment,false);
});
test('successful subset alone advances assessment and selection never invents counts',()=>{
 const report=rotate([source('a'),source('b'),source('c')]);
 const saved=markDiscoverySourcesAssessed(report.inventory,['b'],t1);
 assert.equal(saved.filter(x=>x.last_assessed_at).length,1);assert.equal(saved.find(x=>x.id==='a').last_assessed_at,null);
 assert.deepEqual(report.inventory.map(x=>x.last_assessed_at),[null,null,null]);
 assert.throws(()=>markDiscoverySourcesAssessed(saved,['missing'],t2),/unknown source/);
 assert.throws(()=>markDiscoverySourcesAssessed(saved,['b'],t0),/cannot precede/);
});
test('current-card eligibility retains old inventory without selecting absent cards',()=>{
 const prior=rotate(['a','b','c','d','historical'].map(id=>source(id)),[],{now:t0}).inventory;
 const result=rotate(['a','b','c','d'].map(id=>source(id)),prior,{batchLimit:4,eligibleIds:['a','b','c','d']});
 assert.equal(result.inventory.length,5);assert.equal(result.selected.length,4);assert.equal(result.counts.ineligible,1);assert.ok(!result.selected.some(x=>x.id==='historical'));
});
test('bounded inventory reports evictions explicitly without silently dropping all unselected sources',()=>{
 const all=['a','b','c','d','e'].map(id=>source(id));
 const result=rotate(all,[],{batchLimit:2,inventoryLimit:4});
 assert.equal(result.inventory.length,4);assert.equal(result.deferred.length,2);assert.equal(result.evicted.length,1);assert.equal(result.counts.observed,5);assert.equal(result.counts.previously_assessed,0);
 assert.deepEqual(result.evicted.map(x=>x.id),['e']);
});
test('stable IDs dedupe repeated sightings, no tracking or URL-based semantic merging',()=>{
 const a=source('a');const tracked={...a,url:a.url+'?utm_source=x'};const distinct={...a,id:'other-id'};
 const first=rotate([tracked,a,distinct]);const reverse=rotate([distinct,a,tracked]);
 assert.deepEqual(first,reverse);assert.equal(first.inventory.length,2);assert.equal(first.counts.observed,2);assert.equal(first.inventory.find(x=>x.id==='a').url,a.url);
});
test('metadata projection strips images and arbitrary payloads from observations and history',()=>{
 const observed={...source('a'),image_data_url:'data:image/png;base64,SECRET',media:{bytes:'SECRET'}};
 const report=rotate([observed]);report.inventory[0].image_data_url='SECRET';
 const second=rotate([],report.inventory,{now:t2});assert.ok(!JSON.stringify(second).includes('SECRET'));assert.ok(!JSON.stringify(report.selected).includes('SECRET'));
});
test('oldest successful assessment determines rotation with stable ID tie order',()=>{
 let inventory=rotate(['c','b','a'].map(id=>source(id)),[],{now:t0}).inventory;
 inventory=markDiscoverySourcesAssessed(inventory,['a'],t0);inventory=markDiscoverySourcesAssessed(inventory,['b','c'],t1);
 const result=rotate([],inventory,{now:t2});assert.deepEqual(result.selected.map(x=>x.id),['a','b','c']);
});
test('duplicate historical snapshots merge latest observation and latest assessment independently',()=>{
 const original=rotate([source('a','one')],[],{now:t0}).inventory[0];
 const assessment={...original,last_assessed_at:t1,assessed_content_hash:'one'};
 const observation={...original,last_seen_at:t1,content_hash:'two',content_changed_since_assessment:true};
 const one=rotate([],[assessment,observation],{now:t2}),two=rotate([],[observation,assessment],{now:t2});
 assert.deepEqual(one,two);assert.equal(one.inventory[0].last_assessed_at,t1);assert.equal(one.inventory[0].content_hash,'two');assert.equal(one.inventory[0].content_changed_since_assessment,true);
});
test('invalid limits, IDs and impossible timestamp regressions are rejected',()=>{
 assert.throws(()=>rotate([],[],{batchLimit:4,inventoryLimit:3}));assert.throws(()=>rotate([],[],{inventoryLimit:0}));
 assert.throws(()=>rotate([{id:'',url:'https://example.test',title:''}]));assert.throws(()=>rotate([],[],{now:'invalid'}));
 const future=rotate([source('a')],[],{now:t2}).inventory;assert.throws(()=>rotate([],future,{now:t1}),/newer/);
});

test('blocked attempts rotate without ever being counted as assessed',()=>{
 const observed=['a','b','c','d'].map(id=>source(id));const first=rotate(observed);
 const attempted=markDiscoverySourcesAttempted(first.inventory,first.selected.map(x=>x.id),t1);
 const next=rotate(observed,attempted,{now:t2});assert.equal(next.selected[0].id,'d');assert.equal(next.counts.previously_assessed,0);assert.equal(next.counts.never_assessed,4);
});
