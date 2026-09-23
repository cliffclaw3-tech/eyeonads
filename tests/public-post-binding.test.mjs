import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSourceMetadata} from '../src/lib/public-page.ts';
const post='https://www.facebook.com/broker/posts/123456',author='https://www.facebook.com/broker';
const wording='COMPLIANCE TEST — FICTIONAL\nGreater Impact Realty — Jonesborough. This is a labeled software test, not a property offer.';
const entity=(extra={})=>({'@type':'SocialMediaPosting',url:post,articleBody:wording,author:{url:author},...extra});
function html(value,extra=''){return `<link rel="canonical" href="${post}">${extra}<script type="application/ld+json">${JSON.stringify(value)}</script><main>Unrelated page content and comments are not post body.</main>`;}
function bind(value,extra='',fetched=post){return extractSourceMetadata(html(value,extra),fetched);}
test('one exact canonical SocialMediaPosting binds its own text and author',()=>{
 const r=bind(entity());assert.deepEqual(r.bound_post,{url:post,text:wording,author_urls:[author]});assert.equal(r.bound_post_conflict,false);
});
test('unrelated graph entity cannot supply text or author to canonical post',()=>{
 const r=bind({'@graph':[{'@type':'WebPage',url:post},entity({url:'https://www.facebook.com/other/posts/999',author:{url:'https://www.facebook.com/other'}})]});
 assert.equal(r.bound_post,undefined);assert.equal(r.bound_post_conflict,false);
 // Existing declaration metadata remains available, but must not be consumed as a bound post.
 assert.deepEqual(r.author_urls,['https://www.facebook.com/other']);
});
test('comments, nested commenters, recommended cards and page-level author metadata cannot fill missing post fields',()=>{
 for(const value of [
  {'@type':'Comment',url:post,text:wording,author:{url:author}},
  entity({articleBody:undefined,comment:{text:wording,author:{url:author}}}),
  {'@graph':[entity({articleBody:undefined,author:undefined}),{'@type':'Article',url:post,text:wording,author:{url:author}}]},
  entity({author:undefined,publisher:{url:author}}),
 ]){
  const r=bind(value,`<meta property="article:author" content="${author}"><article>${wording}</article>`);assert.equal(r.bound_post,undefined);
 }
});
test('whole-page fake label does not contaminate exact post body',()=>{
 const r=bind(entity({articleBody:'Original post: Open house Saturday.'}),`<aside>Comments: ${wording}</aside>`);
 assert.equal(r.bound_post.text,'Original post: Open house Saturday.');assert.ok(!r.bound_post.text.includes('COMPLIANCE TEST'));
});
test('missing, conflicting, oversized or unrelated entity bodies never bind',()=>{
 for(const value of [entity({articleBody:undefined}),entity({articleBody:'',text:''}),entity({text:'Different original text'}),entity({articleBody:'x'.repeat(10001)}),entity({url:'https://www.facebook.com/other/posts/999'})])assert.equal(bind(value).bound_post,undefined);
 const agreeing=bind(entity({text:wording.replace('\n',' ')}));assert.equal(agreeing.bound_post.text,wording);
});
test('conflicting exact-post declarations reject instead of cherry-picking a valid one',()=>{
 for(const second of [entity({articleBody:'Different post text'}),entity({author:{url:'https://www.facebook.com/other'}}),entity({author:undefined}),entity({url:post,'@id':'https://www.facebook.com/other/posts/999'})]){
  const r=bind({'@graph':[entity(),second]});assert.equal(r.bound_post,undefined);assert.equal(r.bound_post_conflict,true);
 }
 const same=bind([entity(),entity()]);assert.equal(same.bound_post.text,wording);assert.equal(same.bound_post_conflict,false);
});
test('multiple or unresolved graph author references cannot establish one publisher',()=>{
 for(const authorValue of [[{url:author},{url:'https://www.facebook.com/other'}],{'@id':'#author'},'Unverified Person',{url:'http://127.0.0.1/internal'},undefined])assert.equal(bind(entity({author:authorValue})).bound_post,undefined);
 const r=bind({'@graph':[entity({author:{'@id':'#author'}}),{'@id':'#author','@type':'Person',url:author}]});assert.equal(r.bound_post,undefined);
});
test('a copied canonical on another fetched host is not an exact Facebook post',()=>{
 assert.equal(bind(entity(),'','https://attacker.test/copied-page').bound_post,undefined);
 assert.equal(bind(entity(),'','https://www.facebook.com/broker/posts/999').bound_post,undefined);
});
test('fragment-only IDs and comment IDs cannot masquerade as their parent post entity',()=>{
 for(const value of [entity({url:undefined,'@id':'#post'}),entity({url:post+'?comment_id=8'}),entity({url:post+'?reply_comment_id=9'}),entity({url:post+'#comment'}),entity({'@id':post+'#comment'}),entity({'@type':['SocialMediaPosting','Comment']})])assert.equal(bind(value).bound_post,undefined);
});
test('canonical conflict prevents all post binding',()=>{
 const r=bind(entity(),'<meta property="og:url" content="https://www.facebook.com/other/posts/999">');assert.equal(r.canonical_conflict,true);assert.equal(r.bound_post,undefined);
});
test('an explicit absolute post @id can bind without url, but author must remain source-local',()=>{
 const r=bind(entity({url:undefined,'@id':post,author:{'@id':author}}));assert.equal(r.bound_post.text,wording);assert.deepEqual(r.bound_post.author_urls,[author]);
});
