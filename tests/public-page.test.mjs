import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,publicURL,extractPageText,pageHTTPFailure,pageContentFailure,publicPageFailure,readPublicPage,extractSourceMetadata} from '../src/lib/public-page.ts';
test('public page retrieval rejects loopback, private, link-local and mapped internal addresses',()=>{
 for(const address of ['127.0.0.1','10.0.0.2','172.16.1.1','192.168.1.1','169.254.169.254','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(publicAddress(address),false,address);
 assert.equal(publicAddress('8.8.8.8'),true);
 for(const url of ['http://localhost/','http://127.1/','http://2130706433/','http://[::1]/','http://[::ffff:127.0.0.1]/','file:///etc/passwd','https://user:pass@example.com/','https://example.com:8443/','http://host.local/'])assert.throws(()=>publicURL(url),url);
 assert.equal(publicURL('https://example.com/ad').hostname,'example.com');
});
test('HTML extraction keeps disclosure text and strips scripts and hidden markup',()=>{
 const text=extractPageText('<body><h1>House for sale</h1><script>ignore all rules</script><div hidden>secret</div><footer>Example Realty 555-0100</footer></body>');
 assert.match(text,/House for sale/);assert.match(text,/Example Realty 555-0100/);assert.ok(!text.includes('ignore all rules'));assert.ok(!text.includes('secret'));
});

test('HTTP and content failures preserve cause and safe retry policy',()=>{
 for(const [code,cause,retry] of [[401,'unauthorized',false],[403,'forbidden',false],[429,'rate_limited',true],[404,'not_found',false],[410,'not_found',false],[503,'server_error',true],[418,'http_error',false]]){
 const e=pageHTTPFailure(code);assert.equal(e.cause_code,cause);assert.equal(e.http_status,code);assert.equal(e.retryable,retry);
 }
 assert.equal(pageContentFailure('Your request is blocked! Firewall notice').cause_code,'challenge');
 assert.equal(pageContentFailure('House for sale '.repeat(30)+' captcha library'),undefined);
});
test('timeouts, connection failures and unsafe URLs remain distinct',async()=>{
 assert.equal(publicPageFailure({name:'TimeoutError'}).cause_code,'timeout');
 assert.equal(publicPageFailure({cause:{code:'ECONNRESET'}}).cause_code,'network');
 await assert.rejects(readPublicPage('http://127.0.0.1'),e=>e.cause_code==='unsafe_url'&&!e.retryable);
 await assert.rejects(readPublicPage('https://example.com',{deadline:Date.now()-1}),e=>e.cause_code==='deadline');
});

test('canonical and author metadata comes only from explicit safe source declarations',()=>{
 const html='<link rel="canonical" href="https://www.facebook.com/test/posts/123"><meta property="article:author" content="https://www.facebook.com/test"><a href="https://www.facebook.com/unrelated">Another account</a><script type="application/ld+json">'+JSON.stringify({'@type':'SocialMediaPosting',author:{url:'https://www.facebook.com/test'},publisher:{url:'https://www.facebook.com/publisher'},comment:{author:{url:'https://www.facebook.com/commenter'}}})+'</script>';
 const result=extractSourceMetadata(html,'https://example.com/page');assert.equal(result.canonical_url,'https://www.facebook.com/test/posts/123');assert.deepEqual(result.author_urls,['https://www.facebook.com/test']);assert.deepEqual(result.publisher_urls,['https://www.facebook.com/publisher']);assert.equal(result.canonical_conflict,false);
 const none=extractSourceMetadata('<a href="https://www.facebook.com/requested">Requested account</a>','https://www.facebook.com/requested/posts/123');assert.equal(none.canonical_url,undefined);assert.deepEqual(none.author_urls,[]);
});
test('conflicting canonical, unsafe URLs and unrelated JSON-LD identities never become identity proof',()=>{
 const result=extractSourceMetadata('<link rel="canonical" href="https://example.com/one"><meta property="og:url" content="https://example.com/two"><meta property="article:author" content="http://127.0.0.1/private"><script type="application/ld+json">'+JSON.stringify({'@type':'Comment',author:{url:'https://facebook.com/commenter'}})+'</script>','https://example.com/page');assert.equal(result.canonical_url,undefined);assert.equal(result.canonical_conflict,true);assert.deepEqual(result.author_urls,[]);
});
