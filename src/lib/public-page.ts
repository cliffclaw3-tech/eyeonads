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
const publicLookup: LookupFunction = (host, options, callback) => {
  void lookup(host, { all: true, verbatim: true }).then(addresses => {
    if (!addresses.length || addresses.some(address => !publicAddress(address.address))) throw Error('Non-public address');
    // Validation happens inside the actual connection lookup, preventing DNS
    // rebinding between a preliminary check and the request.
    const address=addresses[0];
    if (options.all) (callback as unknown as (err:Error|null,addresses:{address:string;family:number}[])=>void)(null,addresses);
    else callback(null,address.address,address.family);
  }).catch(()=>callback(new Error('Public page lookup failed'),'',4));
};
export function extractPageText(html:string):string {
  const $=load(html);
  $('script,style,noscript,template,svg,[hidden],[aria-hidden="true"]').remove();
  $('br').replaceWith(' ');
  $('p,div,section,article,li,h1,h2,h3,header,footer').append(' ');
  return $('body').text().replace(/\s+/g,' ').trim();
}
export async function readPublicPage(value:string) {
  let url=publicURL(value);
  const dispatcher=new Agent({connect:{lookup:publicLookup}});
  const signal=AbortSignal.timeout(12000);
  try {
    for(let redirects=0;redirects<=3;redirects++) {
      const response=await fetch(url,{dispatcher,redirect:'manual',signal,headers:{'User-Agent':'EyeOnAds/1.0 public marketing review','Accept':'text/html,application/xhtml+xml'}});
      if([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location=response.headers.get('location');
        if(!location||redirects===3)throw Error('Redirect limit');
        url=publicURL(new URL(location,url).href);continue;
      }
      if(!response.ok||!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')||'')) {await response.body?.cancel();throw Error('Page unavailable');}
      const reader=response.body?.getReader();if(!reader)throw Error('No page content');
      const chunks:Uint8Array[]=[];let bytes=0;
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1_500_000){await reader.cancel();throw Error('Page too large');}chunks.push(part.value);}
      const html=Buffer.concat(chunks).toString('utf8');
      const text=extractPageText(html);
      if(text.length<150||/^(just a moment|access denied|verify you are human)/i.test(text))throw Error('Page content unavailable');
      return {url:url.href,text:text.slice(0,45000),truncated:text.length>45000,sha256:createHash('sha256').update(html).digest('hex'),retrieved_at:new Date().toISOString()};
    }
    throw Error('Page unavailable');
  } finally { await dispatcher.destroy(); }
}
