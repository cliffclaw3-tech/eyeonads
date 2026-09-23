import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';
const require=createRequire(import.meta.url);
function compile(file,resolve,extra={}) {
 const output={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(js,{module:output,exports:output.exports,URL,Date,AbortSignal,setInterval,clearInterval,require:resolve,...extra});return output.exports;
}
const {OfficeSocialReport}=compile('src/components/OfficeSocialReport.tsx',name=>name==='./OfficeSocialControls'?{OfficeSocialControls:({running})=>React.createElement('button',{disabled:running},'Check public social ads')}:require(name));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const ad={library_id:'123456789',source_url:'https://www.facebook.com/ads/library/?id=123456789',observed_page_url:'https://www.facebook.com/ads/library/',captured_at:'2026-09-23T19:20:00Z',advertiser:{name:'TEST Legacy Realty',url:'https://www.facebook.com/test'},current_page_advertiser:'TEST Current Realty',attribution_note:'Historical creative does not prove current affiliation.',active:'active',started_running:'Sep 12, 2026',visible_text:'TEST ad',truncated:false,media:[],media_scope:'video_poster_only',relevance:'brokerage_reference_unverified',relevance_note:'Brokerage reference only; roster membership unverified.',matched_agent_ids:[],ad_text:'TEST property advertisement',text_review_status:'reviewed',text_review:{result:'yellow',summary:'Human context review needed.',flags:[]},image_data_url:image,image_review:{status:'reviewed',observations:{creative_kind:'complete_ad',eho:'not_visible',brokerage:'present',contact:'present',license:'not_visible',sold_claim:'not_visible',notes:'Visible phone present.'},notes:'Poster observed; video not inspected.'}};
const record={status:'complete',searched_at:'2026-09-23T19:20:00Z',error:null,evidence:{version:1,kind:'office_public_social',query:'TEST Office',source_url:'https://www.facebook.com/ads/library/?q=test',retrieved_at:'2026-09-23T19:20:00Z',acquisition_status:'partial',acquisition_note:'Three public cards sampled.',rendered_cards:5,excluded_cards:2,ads:[ad],coverage_gaps:['Private posts remain unchecked.']}};
const render=value=>renderToStaticMarkup(React.createElement(OfficeSocialReport,{record:value}));
test('rendered office ads preserve identity, saved media and honest partial coverage',()=>{
 const html=render(record);
 for(const text of ['TEST Legacy Realty','123456789','Sep 12, 2026','affiliation unverified','TEST Current Realty','Video poster only','Video frames, audio, and motion were not reviewed','not additional agents','same schedule','does not automatically establish a violation','Partial ad coverage — saved image reviewed'])assert.ok(html.includes(text),text);
 assert.ok(html.includes(image));assert.ok(html.includes('https://www.facebook.com/ads/library/?id=123456789'));
 const unavailable=structuredClone(record);unavailable.evidence.ads[0].image_review={status:'unavailable',observations:null,notes:'Image analysis unavailable.'};
 assert.ok(!html.includes('Image type: complete ad'));assert.ok(html.includes('ad creative image; surrounding post not included'));
 const missing=render(unavailable);assert.ok(missing.includes(image));assert.ok(missing.includes('Image not reviewed'));assert.ok(!missing.includes('Partial ad coverage — saved image reviewed'));assert.ok(!missing.includes('EHO logo or words:'));
 unavailable.evidence.ads[0].image_data_url='javascript:alert(1)';unavailable.evidence.ads[0].source_url='javascript:alert(1)';assert.ok(!render(unavailable).includes('javascript:'));
});
test('empty, failed and running records explain saved evidence and recovery',()=>{
 assert.match(render(null),/No public social check saved yet/);
 assert.match(render({...record,status:'running'}),/earlier saved check/);
 const stale=render({...record,status:'running',searched_at:new Date(Date.now()-181000).toISOString()});assert.match(stale,/may have been interrupted/);assert.ok(!stale.includes('disabled=""'));
 const active=render({...record,status:'running',searched_at:new Date().toISOString()});assert.match(active,/Public social check running/);assert.ok(active.includes('disabled=""'));
 assert.match(render({...record,status:'failed',error:'internal database detail'}),/Try the check again/);
 assert.ok(!render({...record,status:'failed',error:'internal database detail'}).includes('internal database detail'));
 const empty=structuredClone(record);empty.evidence.ads=[];assert.match(render(empty),/does not mean no public ads exist/);
});
function controls(fetcher){
 let cursor=0;const values=[];let refreshes=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],value=>values[i]=value];},useRef(initial){const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},useEffect(){}};
 const {OfficeSocialControls}=compile('src/components/OfficeSocialControls.tsx',name=>name==='react'?hooks:name==='next/navigation'?{useRouter:()=>({refresh(){refreshes++;}})}:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:require(name),{fetch:fetcher});
 function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return [];return [node,...nodes(node.props?.children)];}
 return {render(running=false){cursor=0;return nodes(OfficeSocialControls({running}));},get refreshes(){return refreshes;}};
}
test('controls prevent duplicate posts, recover errors, and refresh saved success',async()=>{
 let resolve;let calls=0;const app=controls((url,options)=>{calls++;assert.equal(url,'/api/social-discovery');assert.equal(options.method,'POST');assert.equal(options.body,'{}');return new Promise(r=>resolve=r);});
 let nodes=app.render();const run=nodes.find(n=>n.type==='button').props.onClick;const first=run();await run();assert.equal(calls,1);assert.equal(app.render().find(n=>n.type==='button').props.disabled,true);
 resolve({ok:false,status:500,json:async()=>({error:'Unavailable'})});await first;nodes=app.render();assert.equal(nodes.find(n=>n.type==='button').props.disabled,false);assert.ok(nodes.some(n=>n.props.role==='alert'));assert.equal(app.refreshes,1);
 const retry=nodes.find(n=>n.type==='button').props.onClick();resolve({ok:true,status:200,json:async()=>({review:{status:'complete'}})});await retry;nodes=app.render();assert.ok(!nodes.some(n=>n.props.role==='alert'));assert.equal(app.refreshes,2);
 assert.equal(app.render(true).find(n=>n.type==='button').props.disabled,true);
});
test('rendered phone cards stay within 360px and preserve accessible source links',{skip:!fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')},async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:360,height:800}});await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}button{max-width:100%}</style>'+render(record));
 assert.equal(await page.getByRole('heading',{name:'Office public social ads'}).count(),1);assert.equal(await page.getByRole('link',{name:'Open original Meta ad ↗'}).count(),1);
 assert.equal(await page.locator('img').getAttribute('src'),image);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close();}
});

test('session and setup errors supply actionable recovery links; null review never claims saved',async()=>{
 for(const [status,href] of [[401,'/login'],[400,'/broker']]){const app=controls(async()=>({ok:false,status,json:async()=>({})}));await app.render().find(n=>n.type==='button').props.onClick();assert.ok(app.render().some(n=>n.type==='a'&&n.props.href===href));}
 const app=controls(async()=>({ok:true,status:200,json:async()=>({review:null})}));await app.render().find(n=>n.type==='button').props.onClick();const statuses=app.render().filter(n=>n.props.role==='status').map(n=>n.props.children).join(' ');assert.match(statuses,/already running/);assert.ok(!statuses.includes('Check saved'));
});

test('fourth social ad is visible and inventory separates observed, assessed, deferred and unverified',()=>{
 const current=structuredClone(record);
 current.evidence.ads=Array.from({length:4},(_,i)=>({...ad,library_id:String(400000+i)}));
 current.evidence.rotation={observed:6,eligible:5,assessed_this_run:4,deferred:1,selected_unassessed:0,office_unverified:1,excluded_scope:0,retained:6};
 current.evidence.inventory=Array.from({length:6},(_,i)=>({id:String(400000+i),url:`https://www.facebook.com/ads/library/?id=${400000+i}`,title:'Publisher',last_seen_at:ad.captured_at,last_assessed_at:i<4?ad.captured_at:null}));
 current.evidence.observed_cards=current.evidence.inventory.map((item,i)=>({id:item.id,eligibility:i===5?'office_unverified':'eligible',reason:i===5?'Office not verified':'Office reference'}));
 current.evidence.deferred_ids=['400004'];
 const html=render(current);
 assert(html.includes('Meta Library ID: 400003'));
 assert(html.includes('6 ad cards observed · 5 eligible for this office · 4 text assessments completed · 1 eligible cards deferred'));
 assert(html.includes('Deferred by this check’s assessment budget'));
 assert(html.includes('Office affiliation unverified — not assessed'));
 assert(html.includes('not a complete inventory of campaigns'));
 assert(html.includes('Partial ad coverage — saved image reviewed'));
});
