import test from 'node:test';
import assert from 'node:assert/strict';
import {submittedSocialIdentity as identity, mergeSubmittedProfiles, preserveAgentProfiles} from '../src/lib/social-identity.ts';
const time='2026-09-29T11:49:27Z';
test('platform identity canonicalizes supported profile aliases without inventing verification',()=>{
 const cases=[['https://m.facebook.com/Example.Agent?tracking=1','facebook','https://www.facebook.com/example.agent'],['https://www.facebook.com/profile.php?id=123&ref=search','facebook','https://www.facebook.com/profile.php?id=123'],['https://www.facebook.com/people/Example-Agent/123/','facebook','https://www.facebook.com/people/Example-Agent/123'],['https://instagram.com/Example.Agent/?igsh=x','instagram','https://www.instagram.com/example.agent'],['https://twitter.com/Example_Agent','x','https://x.com/example_agent'],['https://linkedin.com/in/example-agent/','linkedin','https://www.linkedin.com/in/example-agent'],['https://linkedin.com/company/example-firm','linkedin','https://www.linkedin.com/company/example-firm']];
 for(const [input,platform,url] of cases){const r=identity(input,time);assert.equal(r.platform,platform);assert.equal(r.url,url);assert.equal(r.ownership,'unverified');assert.equal(r.retrieval,'not_checked');assert.equal(r.source,'broker_supplied');}
});
test('post/ad links cannot masquerade as roster profile identities',()=>{
 for(const value of ['https://facebook.com/ads/library/?id=123','https://facebook.com/example/posts/123','https://facebook.com/story.php?id=123','https://instagram.com/p/abc','https://instagram.com/reels','https://x.com/example/status/123','https://x.com/i','https://linkedin.com/posts/example','https://linkedin.com/feed/update/123'])assert.throws(()=>identity(value,time),value);
});
test('host impersonation, credentials, ambiguous IDs and encoded paths are rejected',()=>{
 for(const value of ['http://facebook.com/example','https://facebook.com.evil.test/example','https://evil.test/facebook.com/example','https://user:pass@instagram.com/example','https://x.com:8443/example','https://facebook.com/profile.php?id=123&id=456','https://facebook.com/%61ds','https://instagram.com//example','https://x.com/ex ample','https://linkedin.com/in/ex%2fample'])assert.throws(()=>identity(value,time),value);
 assert.throws(()=>identity('https://x.com/example','invalid'));
});

test('URL normalization cannot hide an ambiguous path or uppercase PHP route',()=>{
 for(const url of ['https://facebook.com/ads/../example','https://x.com/./example','https://x.com/%2e/example','https://facebook.com/UNLISTED.PHP']) assert.throws(()=>identity(url,time),url);
});
test('platform edits reject invented proof and cross-platform URLs; clearing is explicit',()=>{
 const saved={facebook:identity('https://facebook.com/example',time),x:identity('https://x.com/example',time)};
 for(const patch of [null,[],{x:{url:'https://x.com/example',ownership:'verified'}},{youtube:'https://youtube.com/example'},{facebook:'https://x.com/example'},{x:''}]) assert.throws(()=>mergeSubmittedProfiles(saved,patch,time));
 const later='2026-09-30T00:00:00Z';
 const retained=mergeSubmittedProfiles(saved,{x:'https://twitter.com/example?ref=1'},later);
 assert.equal(retained.x.recorded_at,saved.x.recorded_at);
 const changed=mergeSubmittedProfiles(saved,{x:'https://x.com/another',facebook:null},later);
 assert.equal(changed.facebook,undefined);assert.equal(changed.x.ownership,'unverified');assert.equal(changed.x.retrieval,'not_checked');assert.equal(changed.x.recorded_at,'2026-09-30T00:00:00.000Z');
 assert.ok(saved.facebook);assert.equal(saved.x.url,'https://x.com/example');
});
test('legacy roster saves retain profiles by stable ID through reorder and rename, not same-name replacement',()=>{
 const previous=[{id:'spark:1',name:'Old Name',social_profiles:{instagram:identity('https://instagram.com/example',time)}},{id:'spark:2',name:'Agent Two',social_profiles:{x:identity('https://x.com/second',time)}}];
 const next=[{id:'spark:2',name:'Agent Two'},{id:'spark:1',name:'New Name'},{id:'spark:3',name:'Old Name'}];
 const result=preserveAgentProfiles(next,previous,[undefined,undefined,undefined],time);
 assert.equal(result[0].social_profiles.x.url,'https://x.com/second');assert.equal(result[1].social_profiles.instagram.url,'https://www.instagram.com/example');assert.equal(result[2].social_profiles,undefined);
 assert.throws(()=>preserveAgentProfiles([{id:'1'},{id:'1'}],[],[undefined,undefined],time));
 assert.throws(()=>preserveAgentProfiles(next,previous,[],time));
});

test('saved agent matching prioritizes email over duplicate display names and rejects ambiguity',async()=>{
 const {matchSavedAgent}=await import('../src/lib/roster-identity.ts');
 const agents=[{id:'one',name:'Alex Example',email:'one@example.test'},{id:'two',name:'Alex Example',email:'two@example.test'}];
 assert.equal(matchSavedAgent({name:'Alex Example',email:'TWO@example.test'},agents).id,'two');
 assert.equal(matchSavedAgent({name:'Renamed Example',email:'one@example.test'},agents).id,'one');
 assert.throws(()=>matchSavedAgent({name:'Alex Example',email:''},agents),/multiple saved agents/);
 assert.equal(matchSavedAgent({name:'Different Person',email:''},agents),undefined);
 assert.throws(()=>matchSavedAgent({name:'Alex Example',email:'replacement@example.test'},[agents[0]]),/different saved email/);
 assert.throws(()=>matchSavedAgent({name:'Alex Example',email:''},[agents[0]]),/different saved email/);
});
