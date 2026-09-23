import type { Page } from 'playwright-core';

export type MetaAdMedia={kind:'image'|'video_poster';url:string;video_url?:string;alt:string;width:number;height:number};
export type MetaAdCard={library_id:string;source_url:string;observed_page_url:string;captured_at:string;advertiser:{name:string;url:string}|null;current_page_advertiser:string|null;attribution_note:string;active:'active'|'inactive'|'unknown';started_running:string|null;visible_text:string;truncated:boolean;media:MetaAdMedia[];media_scope:'still_creative'|'video_poster_only'|'multiple_assets_partial'|'unavailable'};
export type MetaAdExtraction={status:'available'|'partial'|'unavailable';reason:string;observed_page_url:string;captured_at:string;cards:MetaAdCard[]};
export type MetaAdOptions={library_id?:string;max_cards?:number};

// Entire function runs in the rendered page. Do not move helpers outside it:
// Playwright serializes this function without its module closure.
export function readMetaAdCardsDOM(options:MetaAdOptions={}):MetaAdExtraction {
  const captured_at=new Date().toISOString(),observed_page_url=location.href;
  const unavailable=(reason:string):MetaAdExtraction=>({status:'unavailable',reason,observed_page_url,captured_at,cards:[]});
  const visible=(element:Element)=>{
    const style=getComputedStyle(element);
    return !element.closest('[hidden],[aria-hidden="true"]')&&style.display!=='none'&&style.visibility!=='hidden'&&element.getClientRects().length>0;
  };
  if(!document.body)return unavailable('document_not_ready');
  const body=document.body.innerText;
  // A normal Ad Library navigation link labeled Log in is not a login wall.
  if(/\/checkpoint\/|\/challenge\//.test(location.pathname)||/confirm you are human|enter the characters you see|security check|complete the captcha/i.test(body))return unavailable('challenge');
  if(location.pathname.startsWith('/login')||document.querySelector('input[type="password"]'))return unavailable('login_required');
  if(!/(^|\.)facebook\.com$/.test(location.hostname)||!location.pathname.startsWith('/ads/library'))return unavailable('unsupported_source');
  const clean=(text:string)=>text.replace(/\u200b/g,'').trim();
  const validHTTP=(value:string)=>{try{const url=new URL(value,location.href);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
  const ids=(text:string)=>[...new Set([...text.matchAll(/Library ID:\s*(\d{5,30})/g)].map(match=>match[1]))];
  const allLabels=Array.from(document.querySelectorAll<HTMLElement>('span,div')).filter(el=>/^Library ID:\s*\d{5,30}$/.test(clean(el.textContent||''))&&visible(el)&&!Array.from(el.children).some(child=>/^Library ID:/.test(clean(child.textContent||'')))).slice(0,200);
  const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(el=>visible(el)&&/Ad Details|Link to ad/i.test(el.innerText)&&ids(el.innerText).length===1);
  const labels=dialogs.length?allLabels.filter(el=>dialogs.some(dialog=>dialog.contains(el))):allLabels;
  const prefix=body.split('Library ID:')[0];
  const currentPageMatch=prefix.match(/([^\n]+)\nAds\nAbout(?:\n|$)/);
  const current_page_advertiser=currentPageMatch?clean(currentPageMatch[1]):null;
  const cards:MetaAdCard[]=[];
  for(const label of labels){
    const library_id=ids(label.textContent||'')[0];
    if(!library_id||(options.library_id&&library_id!==options.library_id)||cards.some(card=>card.library_id===library_id))continue;
    let root:HTMLElement|null=null;
    for(let parent:HTMLElement|null=label,depth=0;parent&&parent!==document.body&&depth<18;parent=parent.parentElement,depth++){
      const ownIDs=ids(parent.textContent||'');
      if(ownIDs.length>1)break; // Never ascend into an adjacent ad's media.
      const text=parent.innerText;
      if(ownIDs.length===1&&/(^|\n)Sponsored(\n|$)/.test(text)&&/Started running on|(^|\n)(Active|Inactive)(\n|$)/.test(text)){root=parent;break;}
    }
    if(!root)continue;
    const text=clean(root.innerText),beforeSponsored=text.split(/\nSponsored(?:\n|$)/)[0];
    const links=Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(visible);
    const advertiserLink=links.find(link=>{
      const name=clean(link.innerText),url=validHTTP(link.href);
      if(!name||!url||!beforeSponsored.endsWith(name))return false;
      const host=new URL(url).hostname;
      return /(^|\.)(facebook\.com|instagram\.com)$/.test(host)&&!host.startsWith('l.')&&!new URL(url).pathname.startsWith('/ads/');
    });
    const advertiser=advertiserLink?{name:clean(advertiserLink.innerText),url:advertiserLink.href}:null;
    const media:MetaAdMedia[]=[];
    for(const video of Array.from(root.querySelectorAll<HTMLVideoElement>('video')).filter(visible)){
      const url=validHTTP(video.poster);if(!video.poster||!url)continue;
      const rect=video.getBoundingClientRect();
      media.push({kind:'video_poster',url,...(validHTTP(video.currentSrc||video.src)?{video_url:validHTTP(video.currentSrc||video.src)!}:{}),alt:'Video poster only; video frames not reviewed',width:Math.round(rect.width),height:Math.round(rect.height)});
    }
    for(const image of Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(visible)){
      const rect=image.getBoundingClientRect(),url=validHTTP(image.currentSrc||image.src);
      // Small advertiser/profile icons are not ad creative. No other-card assets
      // are considered, even if this card has no usable media.
      if(!url||rect.width<100||rect.height<100||image.closest('a')===advertiserLink||media.some(item=>item.url===url))continue;
      media.push({kind:'image',url,alt:image.alt.slice(0,400),width:Math.round(rect.width),height:Math.round(rect.height)});
    }
    const date=text.match(/Started running on\s+([^\n]+)/)?.[1]||null;
    const statusText=text.split(/\nSponsored(?:\n|$)/)[0];
    const mismatch=!!(advertiser&&current_page_advertiser&&advertiser.name!==current_page_advertiser);
    cards.push({library_id,source_url:`https://www.facebook.com/ads/library/?id=${library_id}`,observed_page_url,captured_at,advertiser,current_page_advertiser,
      attribution_note:mismatch?'Current advertiser-page heading differs from the ad-card identity. Creative may retain legacy branding; current brokerage affiliation is unverified.':'Ad-card advertiser is the publisher identity shown for this ad, not proof of brokerage ownership or current agent affiliation. Creative branding may be historical.',
      active:/(^|\n)Inactive(\n|$)/.test(statusText)?'inactive':/(^|\n)Active(\n|$)/.test(statusText)?'active':'unknown',started_running:date,
      visible_text:text.slice(0,8000),truncated:text.length>8000,media:media.slice(0,5),media_scope:media.length===0?'unavailable':media.length>1?'multiple_assets_partial':media[0].kind==='video_poster'?'video_poster_only':'still_creative'});
    if(cards.length>=Math.min(20,Math.max(1,options.max_cards||10)))break;
  }
  if(!cards.length)return unavailable(/no ads (match|found)|no results found|there are no ads/i.test(body)?'no_ads':options.library_id?'requested_ad_not_rendered':'no_bound_ad_cards');
  return {status:cards.some(card=>!card.advertiser||!card.media.length||card.truncated)?'partial':'available',reason:'Only rendered, individually bound ad cards are included. Video posters and carousels are partial creative coverage.',observed_page_url,captured_at,cards};
}

export async function extractMetaAdCards(page:Page,options:MetaAdOptions={}):Promise<MetaAdExtraction>{
  try{return await page.evaluate(readMetaAdCardsDOM,options);}
  catch{return {status:'unavailable',reason:'rendered_page_unavailable',observed_page_url:page.url(),captured_at:new Date().toISOString(),cards:[]};}
}
