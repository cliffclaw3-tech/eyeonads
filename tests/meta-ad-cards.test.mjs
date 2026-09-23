import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {extractMetaAdCards} from '../src/lib/meta-ad-cards.ts';
const executable=process.env.META_TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const image=(name)=>`<img width="320" height="180" src="https://media.example.com/${name}.jpg">`;
const card=(id,name,media,extra='')=>`<section><div>Active</div><span>Library ID: ${id}</span><div>Started running on Sep 12, 2026</div><a href="https://www.facebook.com/${name}/">${name}</a><div>Sponsored</div><p>Property creative ${id}</p>${media}${extra}</section>`;
test('rendered Meta cards bind media to exact Library ID without borrowing adjacent assets',{skip:!existsSync(executable)},async(t)=>{
 const browser=await chromium.launch({executablePath:executable,headless:true});
 const context=await browser.newContext();const page=await context.newPage();let html='';
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.abort());
 async function load(value,url='https://www.facebook.com/ads/library/?q=fixture'){html=value;await page.goto(url);return extractMetaAdCards(page);}
 try{
 await t.test('adjacent cards have unique assets, dates, source links and publisher identity',async()=>{
  const result=await load('<a href="/login">Log in</a>'+card('111111','AdvertiserA',image('a'))+card('222222','AdvertiserB','<video width="320" height="180" poster="https://media.example.com/b.jpg" src="https://media.example.com/b.mp4"></video>'));
  assert.equal(result.status,'available');assert.equal(result.cards.length,2);
  const [a,b]=result.cards;assert.equal(a.media[0].url,'https://media.example.com/a.jpg');assert.equal(b.media[0].url,'https://media.example.com/b.jpg');assert.equal(b.media_scope,'video_poster_only');assert.equal(a.source_url,'https://www.facebook.com/ads/library/?id=111111');assert.equal(a.advertiser.name,'AdvertiserA');assert.equal(a.started_running,'Sep 12, 2026');assert.equal(a.active,'active');assert.ok(!a.visible_text.includes('222222'));
 });
 await t.test('missing creative never inherits neighbor media and avatar is excluded',async()=>{
  const result=await load(card('111111','AdvertiserA','<img width="30" height="30" src="https://media.example.com/avatar.jpg">')+card('222222','AdvertiserB',image('b')));
  assert.equal(result.status,'partial');assert.equal(result.cards[0].media.length,0);assert.equal(result.cards[1].media[0].url,'https://media.example.com/b.jpg');
 });
 await t.test('an ambiguous multi-ID common container cannot bind media to either ID',async()=>{
  const result=await load('<section><span>Library ID: 111111</span><span>Library ID: 222222</span><div>Active</div><div>Sponsored</div>'+image('ambiguous')+'</section>');assert.equal(result.status,'unavailable');assert.equal(result.cards.length,0);
 });
 await t.test('ad detail dialog takes precedence over underlying grid and preserves legacy caution',async()=>{
  const result=await load('<div>Current Summit Brokerage</div><div>Ads</div><div>About</div>'+card('222222','Other',image('other'))+'<div role="dialog"><h2>Ad Details</h2>'+card('111111','LegacyImpact',image('legacy'))+'</div>');
  assert.equal(result.cards.length,1);assert.equal(result.cards[0].library_id,'111111');assert.equal(result.cards[0].current_page_advertiser,'Current Summit Brokerage');assert.match(result.cards[0].attribution_note,/differs/);assert.equal(result.cards[0].media[0].url,'https://media.example.com/legacy.jpg');
 });
 await t.test('direct-link modal overrides duplicate background ID media',async()=>{
  const result=await load(card('111111','AdvertiserA',image('background'))+'<div role="dialog"><h2>Link to ad</h2>'+card('111111','AdvertiserA',image('modal'))+'</div>');
  assert.equal(result.cards.length,1);assert.equal(result.cards[0].media[0].url,'https://media.example.com/modal.jpg');
 });
 await t.test('requested ID cannot silently become a different ad and carousel is bounded partial coverage',async()=>{
  await load(card('111111','AdvertiserA',Array.from({length:8},(_,i)=>image('a'+i)).join('')));
  assert.equal((await extractMetaAdCards(page,{library_id:'222222'})).reason,'requested_ad_not_rendered');
  const found=await extractMetaAdCards(page,{library_id:'111111'});assert.equal(found.cards[0].media.length,5);assert.equal(found.cards[0].media_scope,'multiple_assets_partial');
 });
 await t.test('no ads, login and challenge remain unavailable without bypass actions',async()=>{
  assert.equal((await load('<p>No ads found</p>')).reason,'no_ads');
  assert.equal((await load('<p>Log into Facebook</p><input type="password">')).reason,'login_required');
  assert.equal((await load('<p>Confirm you are human</p>')).reason,'challenge');
 });
 }finally{await browser.close();}
});
