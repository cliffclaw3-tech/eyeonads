import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {verifiedIdentitySpan} from '../src/lib/completion-envelope.ts';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-blocks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({verifiedIdentitySpan})});
const {sourceBlocks,selectSourceBlocks,sourceAttribution}=exports;
const page='For sale: a spacious home with a covered porch and mountain views. '+('Sunny rooms and a large garden. '.repeat(12))+' Listed by Kathy Oakes. Greater Impact Realty Jonesborough. Firm phone 423-555-0100.';
const blocks=sourceBlocks(page),agentId=blocks.find(b=>b.text.includes('Kathy Oakes')).id,firmId=blocks.find(b=>b.text.includes('Greater Impact Realty')).id;
const selection={contains_promotion:true,promotion_ids:[0],disclosure_ids:[firmId],identity_confirmed:true,agent_block_id:agentId,brokerage_block_id:firmId,attribution_role:'listing_agent',attribution_ids:[agentId],attribution_evidence:'Listed by Kathy Oakes. Greater Impact Realty Jonesborough.',state:'TN',context:'Partial text sample; images not assessed.'};
test('numbered selections copy original page text, preserving provenance and bounded size',()=>{
 for(const block of blocks){assert.ok(page.includes(block.text));assert.ok(block.text.split(/\s+/).length<=35);}
 const result=selectSourceBlocks(blocks,selection,'Kathy Oakes','Greater Impact Realty');assert.equal(result.matched,true);assert.match(result.text,/covered porch/);assert.ok(result.text.split(/\s+/).length<=150);for(const block of result.selected)assert.ok(page.includes(block.text));
});
test('invented IDs, duplicate selections, absent promotions and wrong identities are not verified',()=>{
 for(const promotion_ids of [[],[-1],[blocks.length],[0,0],['0']])assert.throws(()=>selectSourceBlocks(blocks,{...selection,promotion_ids},'Kathy Oakes','Greater Impact Realty'));
 assert.throws(()=>selectSourceBlocks(blocks,{...selection,contains_promotion:false},'Kathy Oakes','Greater Impact Realty'));
 assert.equal(selectSourceBlocks(blocks,selection,'Unrelated Agent','Greater Impact Realty').matched,false);
});

test('negative promotion and identity decisions preserve their real stages',()=>{
 assert.throws(()=>selectSourceBlocks(blocks,{contains_promotion:false,promotion_ids:[],identity_confirmed:false},'Kathy Oakes','Greater Impact Realty'),/no_promotional_content/);
 assert.equal(selectSourceBlocks(blocks,{...selection,identity_confirmed:false,agent_block_id:null},'Kathy Oakes','Greater Impact Realty').matched,true);
 assert.throws(()=>selectSourceBlocks(blocks,{...selection,agent_block_id:null},'Unrelated Agent','Greater Impact Realty'),/identity_unverified/);
});
const roleSelection=(text,evidence,role='listing_agent')=>{const b=[{id:0,text:'An inviting home offers sunny living areas and a spacious garden.'},{id:1,text}];return [b,{...selection,promotion_ids:[0],disclosure_ids:[1],agent_block_id:1,brokerage_block_id:1,attribution_ids:[1],attribution_role:role,attribution_evidence:evidence}];};
test('source role rejects buyer-only, other listing firm and distant unrelated identity',()=>{
 for(const [text,evidence,role] of [
  ['Listing Courtesy of Property Executives, Sara Banks. Sold By Greater Impact Realty Jonesborough, Ashlyn Street.','Sold By Greater Impact Realty Jonesborough, Ashlyn Street.','buyer_agent'],
  ['Listing Courtesy of Property Executives, Sara Banks. Sold By Greater Impact Realty Jonesborough, Ashlyn Street.','Listing Courtesy of Property Executives, Sara Banks. Sold By Greater Impact Realty Jonesborough, Ashlyn Street.','listing_agent'],
  ['Listed by Ashlyn Street, Other Realty. Related agents: Greater Impact Realty.','Listed by Ashlyn Street, Other Realty. Related agents: Greater Impact Realty.','listing_agent'],
  ['Ashlyn Street. Greater Impact Realty.','Ashlyn Street. Greater Impact Realty.','listing_agent'],
 ]){const [b,r]=roleSelection(text,evidence,role);assert.equal(selectSourceBlocks(b,r,'Ashlyn Street','Greater Impact Realty').matched,false);}
});
test('local listing-role evidence links actual agent and firm and cannot be fabricated',()=>{
 for(const text of ['Listed by: Wes Shields • Greater Impact Realty Jonesborough','Listing Courtesy of Greater Impact Realty Jonesborough, Wes Shields (423.946.1875)']){
 const [b,r]=roleSelection(text,text);const v=selectSourceBlocks(b,r,'Wes Shields','Greater Impact Realty');assert.equal(v.matched,true);assert.equal(v.attribution.evidence,text);
 const independent=selectSourceBlocks(b,{...r,attribution_evidence:text+' invented',attribution_ids:[999]},'Wes Shields','Greater Impact Realty');assert.equal(independent.matched,true);assert.equal(independent.attribution.evidence,text);
 const absent=[b[0],{id:1,text:'Unrelated source without listing attribution.'}];assert.equal(selectSourceBlocks(absent,r,'Wes Shields','Greater Impact Realty').matched,false);
 }
});

test('a later related listing credit cannot override a different primary listing advertiser',()=>{
 const b=[{id:0,text:'A bright home with ample garden space. Listed by Sara Banks • Property Executives Johnson City. Last updated today.'},{id:1,text:'Related properties. Listed by Wes Shields • Greater Impact Realty Jonesborough'}];
 const raw={...selection,promotion_ids:[0],disclosure_ids:[1],agent_block_id:1,brokerage_block_id:1,attribution_ids:[1],attribution_evidence:'Listed by Wes Shields • Greater Impact Realty Jonesborough'};
 const result=selectSourceBlocks(b,raw,'Wes Shields','Greater Impact Realty');assert.equal(result.matched,false);assert.match(result.attribution.reason,/primary listing/);
});

// Exact short excerpts from the frozen source corpus and repaired benchmark output.
for(const [agent,excerpt] of [
 ['Wes Shields','Listed by: Wes Shields • Greater Impact Realty Jonesborough Last updated: 09/18/2026 03:42 PM • Source: Tennessee Virginia Regional MLS, MLS#: 10000564'],
 ['David Hoffman','Listed by: David Hoffman • Greater Impact Realty Jonesborough Last updated: 09/11/2026 10:39 AM • Source: Tennessee Virginia Regional MLS, MLS#: 10000766'],
 ['Shad Freck','Pending Listed by Shad Freck Greater Impact Realty Jonesborough 423-973-8634 Last updated: August 6, 2026, 08:20 AM MLS# 9978323 Source: TNVA MLS'],
 ['Corey Blaske','See 47 photos 2236 Sheffield Street, Kingsport, TN 37660 $725,000 — Bed — Bath - Sq Ft Multi-Family Active Listed by Emily Colvin , Corey Blaske Greater Impact Realty Jonesborough 423-973-8634 Last updated: September 22,'],
 ['Mandy Kay Bateman','Listed by Mandy Kay Bateman, (423) 328-0198 Greater Impact Realty Jonesborough Bought with: Mike Garber, (423) 426-4942, Century 21 Legacy Source: TVRMLS, MLS#9977339 Home'],
])test(`deterministic captured attribution restores positive ${agent} independently of model spans`,()=>{
 const prefix='A bright home offers spacious rooms and a covered porch. '.repeat(3);
 const b=sourceBlocks(prefix+excerpt),raw={...selection,promotion_ids:[0],disclosure_ids:[],identity_confirmed:false,agent_block_id:null,brokerage_block_id:null,attribution_role:'unknown',attribution_ids:[],attribution_evidence:''};
 const result=selectSourceBlocks(b,raw,agent,'Greater Impact Realty');assert.equal(result.matched,true);assert.equal(result.attribution.verified,true);assert.ok((prefix+excerpt).includes(result.attribution.evidence));assert.ok(!result.attribution.evidence.includes('Bought with'));assert.match(result.identity_evidence.agent,new RegExp(agent));
});
for(const [agent,excerpt] of [
 ['Walker Soullier','Off Market. Property details are unavailable.'],
 ['Alex Hurley','Listed by: Emma Allgood • Summit Properties Listed by: Kelly West • Summit Properties Last updated: 09/21/2026'],
 ['Ashlyn Street','Listed by: Sara Banks • Property Executives Johnson City. Listing closed: 09/26/2025. Sold By Greater Impact Realty Jonesborough, Ashlyn Street (423.767.2740)'],
 ['Maria Kalis','Listed by: Matthew Bright • D.R. Horton Listed by: Clay Cantrell • D.R. Horton Listing closed: 05/31/2023 Sold By Greater Impact Realty Jonesborough, Maria Kalis (423.773.2846)'],
 ['Shelly Good','Listed by: Dylan Holly • The Elite Team Agency Listed by: Jason Day • The Elite Team Agency Listing closed: 11/25/2025 Sold By Greater Impact Realty Jonesborough, Shelly Good (423.943.5858)'],
])test(`frozen negative attribution stays rejected: ${agent}`,()=>{
 const result=sourceAttribution(sourceBlocks(excerpt),{attribution_role:'listing_agent',attribution_evidence:'invented'},agent,'Greater Impact Realty');assert.equal(result.verified,false);
 if(['Ashlyn Street','Maria Kalis','Shelly Good'].includes(agent))assert.equal(result.role,'buyer_agent');
});
test('disconnected blocks cannot be joined into an invented role relationship',()=>{
 const result=sourceAttribution([{id:0,text:'Listed by: Wes Shields'},{id:1,text:'Greater Impact Realty Jonesborough'}],{},'Wes Shields','Greater Impact Realty');assert.equal(result.verified,false);
});

test('adjacent same-firm primary credits form a co-list; related cards never do',()=>{
 const first='Listed by: Emily Colvin • Greater Impact Realty Jonesborough';
 const second='Listed by: Corey Blaske • Greater Impact Realty Jonesborough';
 const actual=sourceAttribution(sourceBlocks(first+'\n'+second+'\nLast updated: today'),{},'Corey Blaske','Greater Impact Realty');assert.equal(actual.verified,true);
 const related=sourceAttribution(sourceBlocks(first+' Last updated: today. Related properties. '+second),{},'Corey Blaske','Greater Impact Realty');assert.equal(related.verified,false);
 const different=sourceAttribution(sourceBlocks('Listed by: Emily Colvin • Other Realty '+second),{},'Corey Blaske','Greater Impact Realty');assert.equal(different.verified,false);
});
test('explicit property-source Courtesy of credit links identity without generic disclaimer inference',()=>{
 const role=sourceAttribution(sourceBlocks('Courtesy of: Leslie Georgiou, Greater Impact Realty Jonesborough, leslie@greaterimpactrealty.com'),{},'Leslie Georgiou','Greater Impact Realty');assert.equal(role.verified,true);
 const disclaimer=sourceAttribution(sourceBlocks('All information provided by the listing agent/broker is deemed reliable. Leslie Georgiou. Greater Impact Realty.'),{},'Leslie Georgiou','Greater Impact Realty');assert.equal(disclaimer.verified,false);
});

test('coincidental one-word overlap cannot join disconnected attribution fragments',()=>{
 const result=sourceAttribution([{id:0,text:'Listed by: Wes Shields • shared'},{id:1,text:'shared Greater Impact Realty Jonesborough'}],{},'Wes Shields','Greater Impact Realty');assert.equal(result.verified,false);
});
