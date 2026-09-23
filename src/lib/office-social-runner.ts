import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectMetaAds } from './meta-browser';
import type { MetaAdCard } from './meta-ad-cards';
import { readPublicImage } from './public-image';
import { reviewAdImage } from './image-review';
import { reviewAdText } from './ad-review';
import { OFFICE_SOCIAL_ID, type OfficeSocialAd, type OfficeSocialEvidence } from './office-social-contract';

type Setup={name:string;discovery_location?:string|null;location?:string;agents?:{id:string;name:string}[];discovery_agent_ids?:string[]|null};
const normalized=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function socialRelevance(card:MetaAdCard,setup:Setup){
  const text=normalized(card.visible_text),firm=normalized(setup.name);
  if(!firm||!text.includes(firm))return null;
  const agents=(setup.agents||[]).filter(agent=>setup.discovery_agent_ids==null||setup.discovery_agent_ids.includes(agent.id));
  const named=(setup.agents||[]).filter(agent=>normalized(agent.name).split(' ').length>=2&&text.includes(normalized(agent.name)));
  const matched=named.filter(agent=>agents.some(scoped=>scoped.id===agent.id)).map(agent=>agent.id);
  if((named.length&&!matched.length)||(/knoxville/i.test(card.visible_text)&&!matched.length&&!/jonesborough/i.test(card.visible_text)))return null;
  const office=/jonesborough/i.test(setup.discovery_location||setup.location||'')&&/jonesborough/i.test(card.visible_text);
  const relevance=matched.length?'roster_name_match':office?'office_reference':'brokerage_reference_unverified';
  return {relevance:relevance as OfficeSocialAd['relevance'],matched_agent_ids:matched,relevance_note:matched.length?'The ad card includes a scoped roster name and brokerage wording. This is a name match, not confirmation of current affiliation or who placed the ad.':office?'The ad card names the brokerage and Jonesborough. Its publisher may be a third party; no individual agent ownership is established.':'The ad card references the brokerage, but this office and current agent affiliation are unverified. Review before assigning responsibility.'};
}
export function socialAdText(card:MetaAdCard){
  const body=card.visible_text.split(/\nSponsored\n/)[1]||'';
  return body.split(/\n(?:Learn more|Send message|Contact us|Sign up|Shop now|Thinking About A Move\?)\n?/i)[0].trim().split(/\s+/).slice(0,150).join(' ');
}
export function socialReviewContext(card:MetaAdCard,relevanceNote:string){
  return `Visible text sampled from a public Meta Ad Library card. Publisher: ${card.advertiser?.name||'unverified'}. Captured at: ${card.captured_at}. Ad activity at capture: ${card.active}. Ad started running: ${card.started_running||'not shown'}. These are ad-library dates and activity, not proof of property availability, price accuracy or complete campaign history. ${card.attribution_note} ${relevanceNote} Image observations are separate; do not assert that missing text is missing from the full creative, video, or linked disclosures.`;
}
async function assessCard(card:MetaAdCard,setup:Setup):Promise<OfficeSocialAd>{
  const relevance=socialRelevance(card,setup)!;
  const ad_text=socialAdText(card);
  // State comes from explicit source wording or the source's Jonesborough reference.
  const state=/\b(TN|Tennessee|Jonesborough)\b/i.test(card.visible_text)?'TN':/\b(VA|Virginia)\b/i.test(card.visible_text)?'VA':/\b(NC|North Carolina)\b/i.test(card.visible_text)?'NC':null;
  const [text,image]=await Promise.all([
    state&&ad_text?reviewAdText(ad_text,state,socialReviewContext(card,relevance.relevance_note),{firmName:setup.name,identityExcerpts:[card.visible_text],partialSource:true}).then(text_review=>({text_review,text_review_status:'reviewed' as const})).catch(()=>({text_review:null,text_review_status:'unavailable' as const})) : Promise.resolve({text_review:null,text_review_status:'not_reviewed' as const}),
    (async()=>{
      const media=card.media[0];
      if(!media)return {image_review:{status:'unavailable' as const,observations:null,notes:'No ad creative or video poster was captured. No missing disclosure was established.'}};
      try{
        const {data_url,...capture}=await readPublicImage({url:media.url,source_url:card.source_url,alt:media.alt,role:'page_image'});
        const reviewed=await reviewAdImage(data_url,`Actual media bound to Meta Ad Library ID ${card.library_id}, publisher ${card.advertiser?.name||'unverified'}. Media scope: ${card.media_scope}. ${media.kind==='video_poster'?'This is only a video poster. No video frames have been inspected.':''} ${card.attribution_note}`);
        const partial=!!reviewed.observations;
        const retained=data_url.length<=700000;
        return {image_review:{...reviewed,...(partial?{status:'partial' as const,notes:`${reviewed.notes} Only one ${media.kind==='video_poster'?'video poster':'media asset'} was checked. The surrounding Meta post, publisher profile, linked disclosures, complete video and other creative assets are not part of this image review.`}:{}),capture},...(retained?{image_data_url:data_url}:{})};
      }catch{return {image_review:{status:'unavailable' as const,observations:null,notes:'The ad media could not be retrieved safely. No missing disclosure was established.'}};}
    })(),
  ]);
  return {...card,...relevance,ad_text,...text,...image};
}
export async function runOfficeSocial(db:SupabaseClient,ownerId:string,setup:Setup,notBefore?:string){
  if(notBefore){const prior=await db.from('eyeonads_discovery_reviews').select('status,searched_at').eq('owner_id',ownerId).eq('agent_id',OFFICE_SOCIAL_ID).maybeSingle();if(prior.error)throw Error('Social check history unavailable');if(prior.data?.searched_at&&new Date(prior.data.searched_at)>=new Date(notBefore)&&!(prior.data.status==='running'&&Date.now()-new Date(prior.data.searched_at).getTime()>180000))return null;}
  const runId=randomUUID();
  const claim=await db.rpc('eyeonads_claim_discovery_owned',{p_owner_id:ownerId,p_agent_id:OFFICE_SOCIAL_ID,p_agent_name:'Office public social advertising',p_run_id:runId});
  if(claim.error)throw Error('Social check could not start.');
  if(!claim.data)return null;
  try{
    const query=/jonesborough/i.test(setup.discovery_location||setup.location||'')&&!/jonesborough/i.test(setup.name)?`${setup.name} Jonesborough`:setup.name;
    const found=await collectMetaAds(query);
    const score=(card:MetaAdCard)=>{const relevance=socialRelevance(card,setup)?.relevance;return (relevance==='roster_name_match'?4:relevance==='office_reference'?3:0)+(card.active==='active'?1:0);};
    const matched=found.cards.filter(card=>socialRelevance(card,setup)).sort((a,b)=>score(b)-score(a));
    const ads=await Promise.all(matched.slice(0,3).map(card=>assessCard(card,setup)));
    const evidence:OfficeSocialEvidence={version:1,kind:'office_public_social',query,source_url:found.observed_page_url,retrieved_at:found.captured_at,acquisition_status:found.status,acquisition_note:found.status==='unavailable'?(found.reason==='no_ads'?'No public ad cards were found in this search sample.':'The public Meta library could not be read for this check. Retry or open the original source manually.'):'Only individually matched public ad cards from this search sample are included; other ads and assets may remain unchecked.',rendered_cards:found.cards.length,excluded_cards:found.cards.length-matched.length,ads,coverage_gaps:[
      'This is a bounded public Meta Ad Library search, not a complete inventory of social posts or paid campaigns. Private, unindexed and unrendered ads may be missed.',
      'At most three matching ad cards and one media asset per card are assessed. A video poster is not a review of the video. Current affiliation and responsibility require broker verification.',
      ...(matched.length>3?[`${matched.length-3} additional matching rendered cards were not assessed in this check.`]:[]),
      ...(found.status==='unavailable'?['Public social ads could not be acquired in this check. Open Meta Ad Library or retry; this is not a clean compliance result.']:[]),
      ...ads.filter(ad=>!ad.image_data_url).map(ad=>`Ad ${ad.library_id}: no retained image preview is available; its source may have changed.`),
    ]};
    const saved=await db.from('eyeonads_discovery_reviews').update({status:'complete',report:'Public social advertising evidence; see broker report.',sources:ads.map(ad=>({url:ad.source_url,title:`Meta ad ${ad.library_id}`})),evidence,searched_at:new Date().toISOString(),error:null}).eq('owner_id',ownerId).eq('agent_id',OFFICE_SOCIAL_ID).eq('run_id',runId).select('status,searched_at,error,evidence').single();
    if(saved.error||!saved.data)throw Error('Social evidence could not be saved.');
    return saved.data;
  }catch{
    const error='Public social check did not finish or save. No new social review is confirmed; retry.';
    await db.from('eyeonads_discovery_reviews').update({status:'failed',error}).eq('owner_id',ownerId).eq('agent_id',OFFICE_SOCIAL_ID).eq('run_id',runId);
    throw Error(error);
  }
}
