import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync('src/lib/meta-browser.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function fixture({navigationFails=false,navigationHangs=false,extractionStatus='available'}={}){
 const calls=[];let routeHandler;const exports={};
 const page={goto:async(url,options)=>{calls.push(['goto',url,options]);if(navigationFails)throw Error('private failure');if(navigationHangs)await new Promise(()=>{});},url:()=> 'https://www.facebook.com/ads/library/?q=fixture',waitForFunction:async(fn,arg,options)=>calls.push(['wait',options]),waitForTimeout:async(ms)=>calls.push(['settle',ms])};
 const browser={newContext:async options=>{calls.push(['context',options]);return {route:async(glob,handler)=>{routeHandler=handler;},newPage:async()=>page};},close:async()=>calls.push(['closed'])};
 vm.runInNewContext(js,{exports,URL,Date,Promise,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,navigationHangs&&ms===40000?5:ms),require(name){if(name==='playwright-core')return {chromium:{launch:async options=>{calls.push(['launch',options]);return browser;}}};if(name==='@sparticuz/chromium')return {default:{args:['fixed-server-args'],executablePath:async()=>'/tmp/chromium'}};if(name==='./meta-ad-cards')return {extractMetaAdCards:async(p,options)=>{calls.push(['extract',options]);return {status:extractionStatus,reason:extractionStatus==='unavailable'?'login_required':'bound_cards',observed_page_url:page.url(),captured_at:'2026-09-23T19:00:00Z',cards:[]};}};throw Error(name);}});
 return {...exports,calls,route:async (url,resourceType='image')=>{let action;await routeHandler({request:()=>({url:()=>url,resourceType:()=>resourceType}),continue:()=>{action='continue';},abort:()=>{action='abort';}});return action;}};
}
test('public browser allowlist cannot be escaped by schemes, credentials, ports or lookalike suffixes',()=>{
 const f=fixture();for(const url of ['https://www.facebook.com/ads/library/','https://scontent.xx.fbcdn.net/a.jpg','https://fbsbx.com/file'])assert.equal(f.allowedMetaBrowserURL(url),true,url);
 for(const url of ['http://facebook.com/','https://facebook.com.evil.example/','https://evilfacebook.com/','https://user:pass@facebook.com/','https://facebook.com:444/','https://127.0.0.1/','file:///etc/passwd','data:text/html,foo','https://instagram.com/'])assert.equal(f.allowedMetaBrowserURL(url),false,url);
});
test('fixed encoded keyword URL and clean browser preserve bounded extraction schema',async()=>{
 const f=fixture();const result=await f.collectMetaAds('Greater Impact & id=123');const navigation=f.calls.find(c=>c[0]==='goto');
 assert.equal(new URL(navigation[1]).hostname,'www.facebook.com');assert.equal(new URL(navigation[1]).searchParams.get('q'),'Greater Impact & id=123');assert.equal(new URL(navigation[1]).searchParams.has('id'),false);
 assert.equal(result.query,'Greater Impact & id=123');assert.equal(result.execution,'anonymous_cloud_browser');assert.equal(result.search_url,navigation[1]);
 const context=f.calls.find(c=>c[0]==='context')[1];assert.equal(context.serviceWorkers,'block');assert.equal(context.acceptDownloads,false);assert.equal(context.storageState,undefined);
 assert.equal(f.calls.find(c=>c[0]==='wait')[1].timeout,15000);assert.equal(f.calls.find(c=>c[0]==='settle')[1],1000);assert.equal(f.calls.find(c=>c[0]==='extract')[1].max_cards,20);assert.equal(f.calls.filter(c=>c[0]==='closed').length,1);
 assert.equal(await f.route('https://www.facebook.com/resource'),'continue');assert.equal(await f.route('https://example.com/resource'),'abort');assert.equal(await f.route('https://video.xx.fbcdn.net/movie.mp4','media'),'continue');
});
test('invalid query never launches a browser',async()=>{
 for(const value of ['', 'x'.repeat(151),'bad\nquery',42]){const f=fixture();assert.equal((await f.collectMetaAds(value)).reason,'invalid_query');assert.equal(f.calls.length,0);}
});
test('login state and navigation failure return unavailable; browser always closes',async()=>{
 for(const options of [{extractionStatus:'unavailable'},{navigationFails:true},{navigationHangs:true}]){
  const f=fixture(options),result=await f.collectMetaAds('Greater Impact');assert.equal(result.status,'unavailable');assert.ok(!JSON.stringify(result).includes('private failure'));assert.equal(f.calls.filter(c=>c[0]==='closed').length,1);
  if(options.navigationHangs)assert.equal(result.reason,'browser_timeout');
 }
});
