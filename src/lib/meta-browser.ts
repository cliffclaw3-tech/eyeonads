import { chromium as playwright, type Browser } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { extractMetaAdCards, type MetaAdExtraction } from './meta-ad-cards';

export type MetaBrowserResult=MetaAdExtraction&{query:string;search_url:string;execution:'anonymous_cloud_browser'};
export function metaSearchURL(brokerage:string):string {
  if(typeof brokerage!=='string'||!brokerage.trim()||brokerage.length>150||/[\x00-\x1f\x7f]/.test(brokerage))throw Error('invalid_query');
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&media_type=all&q=${encodeURIComponent(brokerage.trim())}&search_type=keyword_unordered`;
}
export function allowedMetaBrowserURL(value:string):boolean {
  try {
    const url=new URL(value),host=url.hostname;
    return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&
      ['facebook.com','fbcdn.net','fbsbx.com'].some(domain=>host===domain||host.endsWith(`.${domain}`));
  }catch{return false;}
}

// Fixed public keyword search only. No user profile, cookies, account connection,
// arbitrary navigation URL, downloads, clicks or challenge-solving are supplied.
export async function collectMetaAds(brokerage:string):Promise<MetaBrowserResult> {
  let search_url:string;
  try{search_url=metaSearchURL(brokerage);}catch{return {status:'unavailable',reason:'invalid_query',query:'',search_url:'',execution:'anonymous_cloud_browser',observed_page_url:'',captured_at:new Date().toISOString(),cards:[]};}
  const query=brokerage.trim();
  let browser:Browser|undefined,observed_page_url=search_url,expired=false;
  let deadline:ReturnType<typeof setTimeout>|undefined;
  const unavailable=(reason:string):MetaBrowserResult=>({status:'unavailable',reason,query,search_url,execution:'anonymous_cloud_browser',observed_page_url,captured_at:new Date().toISOString(),cards:[]});
  try {
    const operation=(async():Promise<MetaBrowserResult>=>{
      const executablePath=await chromium.executablePath();
      if(expired)throw Error('browser_timeout');
      browser=await playwright.launch({args:chromium.args,executablePath,headless:true,timeout:10000});
      if(expired){void browser.close().catch(()=>{});throw Error('browser_timeout');}
      const context=await browser.newContext({viewport:{width:1440,height:900},locale:'en-US',serviceWorkers:'block',acceptDownloads:false});
      await context.route('**/*',route=>allowedMetaBrowserURL(route.request().url())?route.continue():route.abort());
      const page=await context.newPage();
      await page.goto(search_url,{waitUntil:'domcontentloaded',timeout:20000});
      observed_page_url=page.url();
      // Wait for an ad OR an explicit unavailable state. A navigation Log in
      // link alone is normal on the anonymous Ad Library and is not a wall.
      await page.waitForFunction(()=>!!document.body&&(/Library ID:\s*\d+|no ads (match|found)|no results found|there are no ads|confirm you are human|security check|complete the captcha/i.test(document.body.innerText)||!!document.querySelector('input[type="password"]')||/\/checkpoint\/|\/challenge\/|^\/login/.test(location.pathname)),undefined,{timeout:15000}).catch(()=>{});
      await page.waitForTimeout(1000); // Single bounded media/layout settling interval.
      const extraction=await extractMetaAdCards(page,{max_cards:20});
      return {...extraction,query,search_url,execution:'anonymous_cloud_browser'};
    })();
    const timeout=new Promise<MetaBrowserResult>((_,reject)=>{deadline=setTimeout(()=>{expired=true;reject(Error('browser_timeout'));},40000);});
    return await Promise.race([operation,timeout]);
  }catch{return unavailable(expired?'browser_timeout':'browser_unavailable');}
  finally {
    if(deadline)clearTimeout(deadline);
    if(browser){
      let closeTimer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([browser.close().catch(()=>{}),new Promise<void>(resolve=>{closeTimer=setTimeout(resolve,5000);})]);}
      finally{if(closeTimer)clearTimeout(closeTimer);}
    }
  }
}
