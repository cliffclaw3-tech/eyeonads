import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const attachment={filename:'listing-a.png',data_url:'data:image/png;base64,YQ==',sha256:'a'.repeat(64),captured_at:'2026-09-23T19:00:00Z',review_status:'partial',observations:{creative_kind:'property_photo',eho:'not_visible',brokerage:'present',contact:'uncertain',license:'not_visible',sold_claim:'not_visible',notes:'Photo'}};
const scans=[{id:'image-scan',ad_copy:'Listing A',state:'TN',result:'yellow',flags:[],ai_explanation:'Partial review',analysis_source:'openai',image_attachment:attachment,scanned_at:'2026-09-23T19:00:00Z'},{id:'text-scan',ad_copy:'Listing B',state:'VA',result:'yellow',flags:[],ai_explanation:'Text review',image_attachment:null,scanned_at:'2026-09-23T18:00:00Z'}];
function descendants(node){if(Array.isArray(node))return node.flatMap(descendants);if(!node||typeof node!=='object')return [];return [node,...descendants(node.props?.children)];}
async function scanner(){
 const values=[],effects=[],queries=[];let cursor=0,initialized=false;
 const hooks={useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},useRef(initial){const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},useEffect(fn){if(!initialized)effects.push(fn);}};
 const db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){let selected,id;const result=()=>({data:table==='user_profiles'?{state:'TN'}:selected==='image_attachment'?{image_attachment:scans.find(scan=>scan.id===id).image_attachment}:scans.map(({image_attachment,...scan})=>({...scan,user_id:'owner',image_filename:image_attachment?.filename}))});const chain={select:columns=>{selected=columns;queries.push(columns);return chain;},eq:(column,value)=>{if(column==='id')id=value;return chain;},order:()=>chain,limit:()=>chain,single:()=>Promise.resolve(result()),then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)};return chain;}};
 const output={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/dashboard/compliance/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:output,exports:output.exports,window:{setTimeout:()=>{}},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='@/lib/supabase/client')return {createClient:()=>db};if(name==='@/components/VoiceInput')return {VoiceInput:()=>null};if(name==='next/link')return ()=>null;throw Error(name);}});
 function render(){cursor=0;const tree=output.exports.default();initialized=true;return descendants(tree);}
 render();effects.forEach(fn=>fn());for(let i=0;i<10;i++)await Promise.resolve();
 return {render,queries};
}
test('saved View result restores exact image after reload and text-only scan clears prior image',async()=>{
 // Each mount fetches persisted rows; no browser/session cache supplies attachments.
 for(let mount=0;mount<2;mount++){
  const app=await scanner();let nodes=app.render();
  const viewButtons=nodes.filter(node=>node.type==='button'&&node.props.children==='View result');
  assert.equal(app.queries.some(query=>query==='*'),false);
  assert.equal(app.queries.filter(query=>query==='image_attachment').length,0);
  assert.equal(viewButtons.length,4);await viewButtons[0].props.onClick();nodes=app.render();
  assert.equal(nodes.find(node=>node.type==='textarea').props.value,'Listing A');
  assert.ok(nodes.some(node=>node.type==='img'&&node.props.src===attachment.data_url&&node.props.alt.includes('listing-a.png')));
  assert.ok(nodes.some(node=>node.props?.id==='image-copy-instruction'));
  assert.ok(nodes.some(node=>node.type==='dt'&&node.props.children==='EHO logo or words'));
  assert.ok(nodes.some(node=>node.type==='dd'&&node.props.children==='not visible'));
  assert.equal(app.queries.filter(query=>query==='image_attachment').length,1);
  await nodes.filter(node=>node.type==='button'&&node.props.children==='View result')[1].props.onClick();nodes=app.render();
  assert.equal(nodes.find(node=>node.type==='textarea').props.value,'Listing B');
  assert.equal(nodes.filter(node=>node.type==='img').length,0);
  assert.equal(nodes.some(node=>node.props?.id==='image-copy-instruction'),false);
 }
});
