import assert from 'node:assert/strict';
const base=process.env.RECOVERY_TEST_URL||'http://127.0.0.1:3187';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local candidate only');
let checks=0;
for(const path of ['/api/meta/oauth','/api/meta/callback?code=synthetic','/api/google/oauth','/api/google/callback?code=synthetic']) {
 const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.match((await r.json()).error,/unavailable during beta/i);checks++;
}
for(const [path,body,status] of [['/api/signup',{},503],['/api/scan',{ad_copy:'synthetic',state:'TN'},401],['/api/scan',{ad_copy:[],state:'TN'},400],['/api/fix-ad',{},401]]) {
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,status);checks++;
}
for(const [path,pattern] of [['/scan',/Sign in and scan/],['/examples',/10 fictional examples/],['/support',/not yet available/],['/dashboard/connect',/unavailable during beta/]]) {
 const r=await fetch(base+path);assert.equal(r.status,200);assert.match(await r.text(),pattern);checks++;
}
console.log(`PASS: ${checks} local beta HTTP checks; no account creation, database write, email, or provider calls.`);
