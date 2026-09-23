import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function mockPage(responses){let calls=0,destroyed=0,connect;const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/public-page.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,URL,AbortSignal,Date,Buffer,require:name=>name==='undici'?{Agent:class{constructor(options){connect=options.connect}async destroy(){destroyed++}},fetch:async()=>{const response=responses[calls++];if(response instanceof Error)throw response;return response;}}:require(name)});
 return{read:exports.readPublicPage,stats:()=>({calls,destroyed,connect})};
}
const html=text=>new Response('<html><body>'+text+'</body></html>',{headers:{'content-type':'text/html'}});
test('unsafe redirects never receive a second fetch and connection validation remains configured',async()=>{const h=mockPage([new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data/'}})]);await assert.rejects(h.read('https://example.com'),e=>e.cause_code==='unsafe_url');assert.equal(h.stats().calls,1);assert.equal(typeof h.stats().connect.lookup,'function');assert.equal(h.stats().destroyed,1);});
test('actual fetch paths diagnose size, MIME, challenge and HTTP status',async()=>{
 for(const [response,cause,status] of [[new Response('x'.repeat(1500001),{headers:{'content-type':'text/html'}}),'oversize',200],[new Response('%PDF',{headers:{'content-type':'application/pdf'}}),'unsupported_type',200],[html('Verify you are human'),'challenge',200],[new Response('',{status:410}),'not_found',410],[new Response('',{status:429,headers:{'Retry-After':'120'}}),'rate_limited',429]]){const h=mockPage([response]);await assert.rejects(h.read('https://example.com'),e=>e.cause_code===cause&&e.http_status===status&&(status!==429||e.retry_after_ms===120000));assert.equal(h.stats().destroyed,1);}
});
