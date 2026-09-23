import { lookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { load } from 'cheerio';

export function publicAddress(value: string): boolean {
  try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; }
}
export function publicURL(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port)) || !host.includes('.') && !host.includes(':') || host.toLowerCase().endsWith('.localhost') || host.toLowerCase().endsWith('.local') || (ipaddr.isValid(host) && !publicAddress(host))) throw Error('Not a public page');
  return url;
}
export const publicLookup: LookupFunction = (host, options, callback) => {
  void lookup(host, { all: true, verbatim: true }).then(addresses => {
    if (!addresses.length || addresses.some(address => !publicAddress(address.address))) throw Error('Non-public address');
    // Validation happens inside the actual connection lookup, preventing DNS
    // rebinding between a preliminary check and the request.
    const address=addresses[0];
    if (options.all) (callback as unknown as (err:Error|null,addresses:{address:string;family:number}[])=>void)(null,addresses);
    else callback(null,address.address,address.family);
  }).catch((error:unknown)=>callback(new Error(error instanceof Error&&error.message==='Non-public address'?'Non-public address':'Public page DNS lookup failed'),'',4));
};
export function extractPageText(html:string):string {
  const $=load(html);
  $('script,style,noscript,template,svg,[hidden],[aria-hidden="true"]').remove();
  $('br').replaceWith(' ');
  $('p,div,section,article,li,h1,h2,h3,header,footer').append(' ');
  return $('body').text().replace(/\s+/g,' ').trim();
}
export type PublicImageCandidate = { url:string; source_url:string; alt:string; role:'social_preview'|'page_image' };
// Candidates are references in the retrieved HTML, not verified complete ads.
export function extractImageCandidates(html:string, sourceURL:string):PublicImageCandidate[] {
  const source=publicURL(sourceURL).href;
  const $=load(html);
  const candidates:PublicImageCandidate[]=[];
  function add(raw:string|undefined,alt:string,role:PublicImageCandidate['role']) {
    if(!raw||candidates.length>=4)return;
    try {
      const url=publicURL(new URL(raw,source).href).href;
      if(candidates.some(item=>item.url===url))return;
      candidates.push({url,source_url:source,alt:alt.slice(0,300),role});
    }catch{ /* Unsupported and private references are never fetched. */ }
  }
  $('meta[property="og:image"],meta[name="twitter:image"]').each((_,node)=>add($(node).attr('content'),'', 'social_preview'));
  $('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove();
  $('main img,article img,body img').each((_,node)=>{
    const element=$(node),alt=element.attr('alt')||'';
    if(/logo|icon|avatar|headshot|profile|tracking|pixel/i.test(alt+' '+(element.attr('class')||'')))return;
    const width=Number(element.attr('width')),height=Number(element.attr('height'));
    if((width>0&&width<200)||(height>0&&height<120))return;
    add(element.attr('src'),alt,'page_image');
  });
  return candidates;
}
export type BoundPublicPost={url:string;text:string;author_urls:string[]};
export type SourceMetadata={bound_post?:BoundPublicPost;bound_post_conflict:boolean;canonical_url?:string;author_urls:string[];publisher_urls:string[];evidence:string[];canonical_conflict:boolean};
/** These are declarations in this response, NOT platform-verified ownership. */
export function extractSourceMetadata(html:string,sourceURL:string):SourceMetadata {
  const $=load(html),source=publicURL(sourceURL).href;
  const result:SourceMetadata={author_urls:[],publisher_urls:[],evidence:[],canonical_conflict:false,bound_post_conflict:false};
  const postEntities:Record<string,unknown>[]=[];
  const canonicals:string[]=[];
  function add(raw:unknown,to:string[],label:string){
    if(typeof raw!=='string'||!raw.trim()||raw.length>3000||to.length>=8)return;
    try{const url=publicURL(new URL(raw,source).href).href;if(!to.includes(url))to.push(url);if(result.evidence.length<16)result.evidence.push(label+'='+raw.slice(0,700));}catch{/* Not a safe public declaration. */}
  }
  $('link[rel="canonical"]').slice(0,4).each((_,node)=>add($(node).attr('href'),canonicals,'link[rel=canonical].href'));
  $('meta[property="og:url"]').slice(0,4).each((_,node)=>add($(node).attr('content'),canonicals,'meta[property=og:url].content'));
  $('meta[property="article:author"]').slice(0,8).each((_,node)=>add($(node).attr('content'),result.author_urls,'meta[property=article:author].content'));
  $('script[type="application/ld+json"]').slice(0,8).each((_,node)=>{
    const raw=$(node).text();if(raw.length>100000)return;
    try{
      const parsed=JSON.parse(raw),initial=Array.isArray(parsed)?parsed:[parsed];
      const entities=initial.flatMap(value=>value&&typeof value==='object'&&Array.isArray(value['@graph'])?value['@graph']:value).slice(0,20);
      for(const entity of entities){
        if(!entity||typeof entity!=='object')continue;
        const kinds=Array.isArray(entity['@type'])?entity['@type']:[entity['@type']];
        if(kinds.includes('SocialMediaPosting'))postEntities.push(entity);
        if(!kinds.some((kind:unknown)=>typeof kind==='string'&&/^(?:Article|NewsArticle|BlogPosting|SocialMediaPosting|WebPage)$/.test(kind)))continue;
        for(const field of ['author','publisher'] as const){
          const values=Array.isArray(entity[field])?entity[field]:[entity[field]];
          for(const value of values.slice(0,8))if(value&&typeof value==='object')add(value.url,field==='author'?result.author_urls:result.publisher_urls,'JSON-LD '+field+'.url');
        }
      }
    }catch{/* Malformed structured data is not identity proof. */}
  });
  if(canonicals.length===1)result.canonical_url=canonicals[0];
  result.canonical_conflict=canonicals.length>1;
  if(result.canonical_url&&!result.canonical_conflict){
    const binding=bindExactFacebookPost(postEntities,result.canonical_url,source);
    result.bound_post=binding.post;result.bound_post_conflict=binding.conflict;
  }
  return result;
}
/** Strict identity for exact post binding; the social adapter independently rechecks it. */
function facebookPostKey(raw:string):string|null {
  try{
    const u=new URL(raw),host=u.hostname.toLowerCase().replace(/^(www|m|mbasic)\./,'');
    if(u.protocol!=='https:'||host!=='facebook.com'||u.username||u.password||u.port)return null;
    if(u.searchParams.has('comment_id')||u.searchParams.has('reply_comment_id'))return null;
    const story=u.searchParams.get('story_fbid');if(story)return 'post:'+story;
    const path=u.pathname.replace(/\/+$/,'');
    const post=path.match(/\/(?:posts|videos)\/([^/]+)$/)?.[1];if(post)return 'post:'+post;
    if((path==='/photo.php'||path==='/photo')&&u.searchParams.get('fbid'))return 'photo:'+u.searchParams.get('fbid');
    return null;
  }catch{return null;}
}
function bindExactFacebookPost(entities:Record<string,unknown>[],canonical:string,fetched:string):{post?:BoundPublicPost;conflict:boolean} {
  const key=facebookPostKey(canonical);
  if(!key||facebookPostKey(fetched)!==key)return {conflict:false};
  const matches:BoundPublicPost[]=[];
  let conflict=false;
  for(const entity of entities){
    // An entity's own explicit absolute URL is required. A mainEntityOfPage,
    // graph parent, page-level author or fragment-only @id is not post identity.
    const declared=[entity.url,entity['@id']].filter((value):value is string=>typeof value==='string'&&value.length>0);
    if(!declared.some(value=>facebookPostKey(value)===key))continue;
    if(declared.some(value=>{try{const u=new URL(value);return !!u.hash||facebookPostKey(value)!==key;}catch{return true;}})){conflict=true;continue;}
    const kinds=Array.isArray(entity['@type'])?entity['@type']:[entity['@type']];
    if(kinds.includes('Comment')){conflict=true;continue;}
    const texts=[entity.articleBody,entity.text].filter((value):value is string=>typeof value==='string'&&value.trim().length>0);
    if(!texts.length||texts.some(value=>value.length>10000)||new Set(texts.map(value=>value.replace(/\s+/g,' ').trim())).size!==1){conflict=true;continue;}
    const authors=Array.isArray(entity.author)?entity.author:[entity.author];
    const urls:string[]=[];let invalid=authors.length<1||authors.length>8;
    for(const author of authors.slice(0,8)){
      const raw=typeof author==='string'?author:author&&typeof author==='object'?(author as Record<string,unknown>).url??(author as Record<string,unknown>)['@id']:undefined;
      try{
        if(typeof raw!=='string'||raw.length>3000)throw Error('Missing direct author URL');
        const u=publicURL(raw),host=u.hostname.toLowerCase().replace(/^(www|m|mbasic)\./,'');
        if(u.protocol!=='https:'||host!=='facebook.com'||u.hash)throw Error('Unverified author');
        if(!urls.includes(u.href))urls.push(u.href);
      }catch{invalid=true;}
    }
    if(invalid||urls.length!==1){conflict=true;continue;}
    matches.push({url:canonical,text:texts[0].trim(),author_urls:urls});
  }
  // Duplicate declarations may agree; conflicting exact-post bodies/authors
  // are ambiguous and cannot be cherry-picked into a passing verification.
  if(matches.length>1){
    const first=matches[0];
    if(matches.some(post=>post.text.replace(/\s+/g,' ')!==first.text.replace(/\s+/g,' ')||post.author_urls[0]!==first.author_urls[0]))conflict=true;
  }
  return conflict?{conflict:true}:{post:matches[0],conflict:false};
}
export type RetrievalFailureCause = 'unauthorized'|'forbidden'|'rate_limited'|'not_found'|'server_error'|'http_error'|'timeout'|'network'|'challenge'|'oversize'|'unsupported_type'|'empty_content'|'unsafe_url'|'redirect_limit'|'deadline';
export class PublicPageError extends Error {
  cause_code:RetrievalFailureCause;
  retryable:boolean;
  http_status?:number;
  retry_after_ms?:number;
  constructor(cause:RetrievalFailureCause,retryable=false,httpStatus?:number) {
    super(cause);this.name='PublicPageError';this.cause_code=cause;this.retryable=retryable;this.http_status=httpStatus;
  }
}
export function pageHTTPFailure(status:number):PublicPageError {
  return new PublicPageError(status===401?'unauthorized':status===403?'forbidden':status===429?'rate_limited':[404,410].includes(status)?'not_found':status>=500?'server_error':'http_error',status===429||status>=500,status);
}
export function pageContentFailure(text:string,title=''):PublicPageError|undefined {
  // A captcha script on a normal listing is not a challenge. Require the page's
  // leading visible text/title to indicate that ordinary content is unavailable.
  if (/^(just a moment|access denied|verify (that )?you are human|your request is blocked|please enable js and disable|attention required|pardon our interruption|notice: ?lofty does not support embedding)/i.test(text.trim()) || /^(just a moment|access denied|opsany.?web firewall)/i.test(title.trim())) return new PublicPageError('challenge');
  if(text.length<150)return new PublicPageError('empty_content');
}
export function publicPageFailure(error:unknown):PublicPageError {
  if(error instanceof PublicPageError)return error;
  const value=error as {name?:string;message?:string;cause?:{message?:string;code?:string}};
  if(/timeout|abort/i.test(value?.name||'')||/TIMEOUT/.test(value?.cause?.code||''))return new PublicPageError('timeout',true);
  if(/Not a public page|Non-public address/.test((value?.message||'')+' '+(value?.cause?.message||'')))return new PublicPageError('unsafe_url');
  return new PublicPageError('network',true);
}
export async function readPublicPage(value:string,options:{deadline?:number;timeoutMs?:number}={}) {
  let url:URL;try {url=publicURL(value);}catch{throw new PublicPageError('unsafe_url');}
  const remaining=(options.deadline??Infinity)-Date.now();
  if(remaining<=0)throw new PublicPageError('deadline');
  const dispatcher=new Agent({connect:{lookup:publicLookup}});
  const signal=AbortSignal.timeout(Math.max(1,Math.floor(Math.min(options.timeoutMs??12000,remaining))));
  try {
    for(let redirects=0;redirects<=3;redirects++) {
      const response=await fetch(url,{dispatcher,redirect:'manual',signal,headers:{'User-Agent':'EyeOnAds/1.0 public marketing review','Accept':'text/html,application/xhtml+xml'}});
      if([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location=response.headers.get('location');
        if(!location||redirects===3)throw new PublicPageError('redirect_limit');
        try {url=publicURL(new URL(location,url).href);}catch{throw new PublicPageError('unsafe_url');}continue;
      }
      if(!response.ok) {await response.body?.cancel();const error=pageHTTPFailure(response.status);const retry=response.headers.get('retry-after');if(retry){const seconds=Number(retry);const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-Date.now();if(Number.isFinite(delay))error.retry_after_ms=Math.max(0,delay);}throw error;}
      if(!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')||'')) {await response.body?.cancel();throw new PublicPageError('unsupported_type',false,response.status);}
      const reader=response.body?.getReader();if(!reader)throw new PublicPageError('empty_content',false,response.status);
      const chunks:Uint8Array[]=[];let bytes=0;
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1_500_000){await reader.cancel();throw new PublicPageError('oversize',false,response.status);}chunks.push(part.value);}
      const html=Buffer.concat(chunks).toString('utf8');
      const text=extractPageText(html);
      const failure=pageContentFailure(text,load(html)('title').text());if(failure){failure.http_status=response.status;throw failure;}
      return {source_metadata:extractSourceMetadata(html,url.href),image_candidates:extractImageCandidates(html,url.href),url:url.href,text:text.slice(0,45000),truncated:text.length>45000,sha256:createHash('sha256').update(html).digest('hex'),retrieved_at:new Date().toISOString()};
    }
    throw new PublicPageError('redirect_limit');
  } catch(error) {throw publicPageFailure(error);} finally { await dispatcher.destroy(); }
}
