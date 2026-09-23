import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as publicPage from '../src/lib/public-page.ts';
import * as crypto from 'node:crypto';
const js=ts.transpileModule(fs.readFileSync(new URL('../src/lib/public-image.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function moduleWith(fetch){const exports={};let destroyed=false;class Agent{constructor(options){assert.equal(options.connect.lookup,publicPage.publicLookup);}async destroy(){destroyed=true;}}vm.runInNewContext(js,{exports,require:name=>name==='undici'?{fetch,Agent}:name==='node:crypto'?crypto:publicPage,AbortSignal,Buffer,URL});return {...exports,destroyed:()=>destroyed};}
const candidate={url:'https://cdn.example.com/a.png',source_url:'https://example.com/ad',alt:'House',role:'social_preview'};
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
function response(body=png,headers={'content-type':'image/png'},status=200){return new Response(body,{headers,status});}
test('extract only bounded direct public media references and retain attribution',()=>{
 const html='<meta property="og:image" content="https://cdn.example.com/a.jpg"><img src="http://127.1/private"><img src="/photo.jpg" alt="House"><img src="/logo.png" alt="broker logo"><img hidden src="/hidden.jpg"><img width="1" src="/pixel.jpg">';
 const images=publicPage.extractImageCandidates(html,'https://example.com/ad');
 assert.equal(images.length,2);assert.equal(images[0].source_url,'https://example.com/ad');assert.equal(images[0].role,'social_preview');assert.equal(images[1].url,'https://example.com/photo.jpg');
 assert.equal(publicPage.extractImageCandidates(Array.from({length:10},(_,i)=>`<img src="/${i}.jpg">`).join(''),'https://example.com/ad').length,4);
});
test('safe image fetch retains evidence metadata and uses connection DNS pinning',async()=>{
 const mod=moduleWith(async(url,options)=>{assert.equal(url.href,candidate.url);assert.equal(options.redirect,'manual');assert.equal(options.headers['Accept-Encoding'],'identity');assert.ok(options.signal);return response();});
 const image=await mod.readPublicImage(candidate);
 assert.equal(image.source_url,candidate.source_url);assert.equal(image.image_url,candidate.url);assert.equal(image.sha256,crypto.createHash('sha256').update(png).digest('hex'));assert.equal(image.bytes,png.length);assert.match(image.retrieved_at,/^\d{4}-/);assert.equal(mod.destroyed(),true);
});
test('redirect to private image URL is blocked before second request',async()=>{
 let requests=0;const mod=moduleWith(async()=>{requests++;return response(null,{location:'http://169.254.169.254/secret'},302);});
 await assert.rejects(mod.readPublicImage(candidate));assert.equal(requests,1);assert.equal(mod.destroyed(),true);
});
test('image retrieval rejects oversized, mismatched MIME, unsupported media and redirect loops',async()=>{
 for(const create of [()=>response(png,{'content-type':'image/png','content-length':'2000001'}),()=>response(new Uint8Array(2_000_001)),()=>response(Buffer.from('<html>bad</html>')),()=>response(png,{'content-type':'image/svg+xml'}),()=>response(null,{location:'/loop'},302)]){
  let calls=0;const mod=moduleWith(async()=>{calls++;return create();});await assert.rejects(mod.readPublicImage(candidate));assert.ok(calls<=4);assert.equal(mod.destroyed(),true);
 }
});
