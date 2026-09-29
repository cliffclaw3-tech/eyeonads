import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, stubs={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(n in stubs)return stubs[n];throw Error('Unexpected dependency '+n)},URL,Error,console});
 return exports;
}
const model=load('lib/mls-access-request.ts');
const input={mls:'Example MLS',offices:'Office1',contact:'Example Broker',reference:'REQ-1',status:'requested'};
function route(user={id:'synthetic',user_metadata:{other:'retained'}},fail=false) {
 let written;
 const db = { auth: {
  getUser: async () => ({data:{user}}),
  updateUser: async payload => {
   written=payload;
   if (fail) return {error:{},data:{user:null}};
   return {data:{user:{...user,user_metadata:{...user.user_metadata,...payload.data}}}};
  }
 }};
 const api=load('app/api/brokerage/mls-access-request/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/mls-access-request':model});
 return {...api,written:()=>written};
}
const request=(body=input,origin='https://eyeonads.com')=>({headers:{get:n=>({origin,host:'eyeonads.com'})[n]||null},text:async()=>JSON.stringify(body)});
test('MLS tracking rejects credential fields, forged verified status, multiline and oversized input',()=>{
 for(const value of [{...input,api_key:'secret'},{...input,status:'connected'},{...input,mls:'MLS\nInjected'},{...input,reference:'x'.repeat(121)},null]) assert.throws(()=>model.parseMlsAccessRequest(value));
 assert.equal(model.parseMlsAccessRequest({...input,mls:'  MLS  '}).mls,'MLS');
});
test('MLS request API denies anonymous and cross-origin writes without mutation',async()=>{
 const anon=route(null);assert.equal((await anon.GET()).status,401);assert.equal((await anon.POST(request())).status,401);assert.equal(anon.written(),undefined);
 for(const origin of ['https://evil.example','null',null]){const api=route();assert.equal((await api.POST(request(input,origin))).status,403);assert.equal(api.written(),undefined);}
});
test('MLS tracking writes only own metadata key; approval stays reported, not connected',async()=>{
 const api=route();const result=await api.POST(request({...input,status:'approved_reported'}));assert.equal(result.status,200);assert.equal(result.body.request.status,'approved_reported');assert.deepEqual(Object.keys(api.written().data),['eyeonads_mls_request']);assert.equal(Object.keys(api.written()).join(','),'data');
 const read=route({id:'other',user_metadata:{}});assert.equal((await read.GET()).body.request,null);
});
test('MLS tracking save failure is not reported as success and drafts require permission clarification',async()=>{
 const api=route(undefined,true);assert.equal((await api.POST(request())).status,503);
 const letter=model.mlsRequestLetter('Example Firm',input);assert.match(letter,/complete roster.*independently of listing activity/);assert.match(letter,/does not enroll us in a paid plan/);assert.match(letter,/not a public IDX/);
});
test('malformed MLS JSON never reflects the submitted body',async()=>{
 const api=route();const req=request();req.text=async()=>'{"mls":"PRIVATE_FRAGMENT"';const response=await api.POST(req);assert.equal(response.status,400);assert.equal(response.body.error,'Check the request format.');assert.equal(api.written(),undefined);
});
