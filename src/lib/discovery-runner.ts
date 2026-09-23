import { rotateDiscoverySources, markDiscoverySourcesAssessed, markDiscoverySourcesAttempted, type DiscoveryInventoryItem } from './discovery-rotation';
import { discoverMarketing } from './web-discovery';
import { reviewSourceImage, type SourceImageReview } from './source-image-review';
import { discoveryReport } from './discovery-report';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewAdText, type AdReview } from './ad-review';
import { retrieveAd, type RetrievedAd } from './retrieve-ad';
import { groundCandidate, reviewableAd, validSourceURL, type DiscoveredAd } from './discovered-ad-contract';
type Agent = {id:string;name:string;social_url?:string};
type Setup = {name:string;website?:string;location?:string;discovery_location?:string|null};
type Candidate = RetrievedAd & { image_review?:SourceImageReview; review: AdReview | null; review_status: 'reviewed' | 'not_reviewed' | 'failed' };
export async function runDiscovery(db: SupabaseClient, ownerId: string, setup: Setup, agent: Agent) {
 const runId=randomUUID();
 const claim=await db.rpc('eyeonads_claim_discovery_owned',{p_owner_id:ownerId,p_agent_id:agent.id,p_agent_name:agent.name,p_run_id:runId});
 if(claim.error)throw new Error('Search could not start. Please retry.');
 if(!claim.data)throw new Error('This agent is already being searched. Retry after three minutes.');
 try {
  const previous=await db.from('eyeonads_discovery_reviews').select('evidence,searched_at').eq('owner_id',ownerId).eq('agent_id',agent.id).maybeSingle();
  if(previous.error)throw Error('Previous source evidence could not be loaded');
  const previousEvidence=previous.data?.evidence;
  const priorCandidates:Candidate[]=Array.isArray(previousEvidence?.candidates)?previousEvidence.candidates:[];
  const priorWatch:DiscoveredAd[]=Array.isArray(previousEvidence?.watch_sources)?previousEvidence.watch_sources:[];
  const sourceKinds=new Map<string,DiscoveredAd['kind']>([...priorWatch,...priorCandidates].filter(ad=>validSourceURL(ad.url)).map(ad=>[ad.url,ad.kind]));
  const legacyTime=previous.data?.searched_at;
  const legacySources=[...priorCandidates,...priorWatch].filter((ad,index,list)=>validSourceURL(ad.url)&&list.findIndex(other=>other.url===ad.url)===index);
  // Legacy timestamps describe the previous report's observation; they do not claim current accessibility.
  const legacyInventory:DiscoveryInventoryItem[]=Number.isFinite(Date.parse(legacyTime||''))?legacySources.map(ad=>{
    const candidate=priorCandidates.find(item=>item.url===ad.url);
    const assessed=candidate?.review_status==='reviewed';
    return {id:ad.url,url:ad.url,title:ad.title,last_seen_at:candidate?.capture?.retrieved_at||legacyTime,last_assessed_at:assessed?legacyTime:null,last_attempted_at:candidate?legacyTime:null,content_hash:candidate?.capture?.sha256,assessed_content_hash:assessed?candidate?.capture?.sha256||null:null,content_changed_since_assessment:false};
  }):[];
  const previousInventory:DiscoveryInventoryItem[]=(Array.isArray(previousEvidence?.source_inventory)?previousEvidence.source_inventory:legacyInventory).filter((item:DiscoveryInventoryItem)=>validSourceURL(item.url)&&item.id===item.url&&Number.isFinite(Date.parse(item.last_seen_at))).slice(0,9);
  const discover=(alternatives?:{excluded_hosts:string[];excluded_urls:string[]})=>discoverMarketing({agent_name:agent.name,brokerage:setup.name,brokerage_website:setup.website,location:setup.discovery_location||setup.location,known_profile:agent.social_url,alternatives});
  const startedAt=Date.now();
  const {found,openedURLs,searchQueries,incompletePasses}=await discover();
  async function assess(foundAds:DiscoveredAd[],opened:Set<string>):Promise<Candidate[]> {return Promise.all(foundAds.filter((ad:DiscoveredAd)=>validSourceURL(ad.url)).map((ad:DiscoveredAd)=>groundCandidate(ad,opened)).map(async(candidate:DiscoveredAd)=>{
    const ad=await retrieveAd(candidate,agent.name,setup.name,{deadline:startedAt+90000});
    if(!reviewableAd(ad))return {...ad,review:null,review_status:'not_reviewed' as const};
    const identityExcerpts=ad.identity_evidence?[...new Set(Object.values(ad.identity_evidence))].join('\n'):'';
    // Image and text work share the remaining worker budget; image failure never invents a disclosure finding.
    const [text,image_review]=await Promise.all([
      reviewAdText(ad.ad_text,ad.state,`Public-web extraction, not a verified full-page capture. Agent: ${agent.name}; brokerage: ${setup.name}; source: ${ad.url}; ${ad.context}. Exact identity/contact excerpts from the same source: ${identityExcerpts}. Image observations are reported separately; page layout and one-click social disclosures have not been reviewed.`,{firmName:setup.name,identityExcerpts:ad.identity_evidence?Object.values(ad.identity_evidence):[],partialSource:true}).then(review=>({review,review_status:'reviewed' as const})).catch(()=>({review:null,review_status:'failed' as const})),
      reviewSourceImage(ad.image_candidates?.[0],startedAt+110000),
    ]);
    return {...ad,...text,image_review};
  }));}
  const fresh:DiscoveredAd[]=found.candidates.filter((ad:DiscoveredAd)=>validSourceURL(ad.url)).slice(0,6);
  for(const ad of fresh)sourceKinds.set(ad.url,ad.kind);
  const observedIds=new Set(fresh.map(ad=>ad.url));
  const freshByURL=new Map<string,DiscoveredAd>(fresh.map(ad=>[ad.url,ad]));
  let rotation=rotateDiscoverySources({observed:fresh.map(ad=>({id:ad.url,url:ad.url,title:ad.title})),previous:previousInventory,now:new Date().toISOString(),batchLimit:6,inventoryLimit:9});
  const evicted=new Map(rotation.evicted.map(item=>[item.id,item]));
  let inventory=rotation.inventory;
  const selected:DiscoveredAd[]=rotation.selected.map(item=>freshByURL.get(item.url)||({url:item.url,title:item.title,kind:sourceKinds.get(item.url)||'advertisement',state:'unknown',identity:'uncertain',ad_text:'',page_access:'snippet_only',context:'Previously observed source URL; current text, advertising attribution and identity must be retrieved and verified again.'}));
  let candidates=await assess(selected,openedURLs);
  const recordOutcomes=(outcomes:Candidate[])=>{
    const captured=outcomes.filter(ad=>ad.capture?.sha256).map(ad=>({id:ad.url,url:ad.url,title:ad.title,content_hash:ad.capture!.sha256}));
    const completedAt=new Date().toISOString();
    rotation=rotateDiscoverySources({observed:captured,previous:inventory,now:completedAt,batchLimit:0,inventoryLimit:9});
    for(const item of rotation.evicted)evicted.set(item.id,item);
    inventory=markDiscoverySourcesAttempted(rotation.inventory,outcomes.filter(ad=>rotation.inventory.some(item=>item.id===ad.url)).map(ad=>ad.url),completedAt);
    inventory=markDiscoverySourcesAssessed(inventory,outcomes.filter(ad=>ad.review_status==='reviewed'&&inventory.some(item=>item.id===ad.url)).map(ad=>ad.url),completedAt);
  };
  recordOutcomes(candidates);
  let attemptedSources=candidates.length;
  // A short second search can escape a group of inaccessible portals without exceeding the worker deadline.
  if(!candidates.some(ad=>ad.review_status==='reviewed')&&Date.now()-startedAt<40000){
    try{
      const excludedHosts=candidates.filter(ad=>ad.page_access==='blocked').map(ad=>new URL(ad.url).hostname);
      const alternative=await discover({excluded_hosts:excludedHosts,excluded_urls:candidates.map(ad=>ad.url)});
      const previousURLs=new Set(candidates.map(ad=>ad.url));
      const alternatives:DiscoveredAd[]=alternative.found.candidates.filter((ad:DiscoveredAd)=>validSourceURL(ad.url)&&!previousURLs.has(ad.url)&&!excludedHosts.includes(new URL(ad.url).hostname)).slice(0,3);
      for(const ad of alternatives){sourceKinds.set(ad.url,ad.kind);observedIds.add(ad.url);}
      rotation=rotateDiscoverySources({observed:alternatives.map(ad=>({id:ad.url,url:ad.url,title:ad.title})),previous:inventory,now:new Date().toISOString(),batchLimit:Math.min(3,9-attemptedSources),inventoryLimit:9,eligibleIds:alternatives.map(ad=>ad.url)});
      for(const item of rotation.evicted)evicted.set(item.id,item);
      inventory=rotation.inventory;
      const alternativeByURL=new Map(alternatives.map(ad=>[ad.url,ad]));
      const extra=await assess(rotation.selected.map(item=>alternativeByURL.get(item.url)!),alternative.openedURLs);
      recordOutcomes(extra);
      attemptedSources+=extra.length;
      for(const url of alternative.openedURLs)openedURLs.add(url);
      searchQueries.push(...alternative.searchQueries);
      candidates=[...candidates,...extra];
    }catch{ /* Preserve the first search's truthful coverage gaps if the alternative search cannot finish. */ }
  }
  const presentation=discoveryReport(candidates);
  if(incompletePasses){const warning='One public discovery pass did not finish; these results have reduced discovery coverage. Retry the agent search.';presentation.coverage_gaps.push(warning);presentation.report+='\n\n'+warning;}
  const watchSources=inventory.map(item=>({url:item.url,title:item.title,kind:sourceKinds.get(item.url)||'advertisement'}));
  const attemptedIds=new Set(candidates.map(ad=>ad.url));
  const finalRotation=rotateDiscoverySources({observed:[],previous:inventory,now:new Date().toISOString(),batchLimit:0,inventoryLimit:9});
  const deferred=inventory.filter(item=>!attemptedIds.has(item.id));
  const finalEvicted=[...evicted.values()].filter(item=>!inventory.some(retained=>retained.id===item.id));
  const sourceRotation={counts:{...finalRotation.counts,observed:observedIds.size,selected:attemptedIds.size,deferred:deferred.length,evicted:finalEvicted.length},selected_ids:[...attemptedIds],deferred_ids:deferred.map(item=>item.id),evicted:finalEvicted,successfully_assessed_this_run:candidates.filter(ad=>ad.review_status==='reviewed').length,note:'Inventory is bounded source history, not all advertising. Last seen, last attempted and last assessed are separate. Historical assessments are not current clearance; only this run’s reviewed candidates were assessed now.'};
  const evidence={version:5,incomplete_discovery_passes:incompletePasses||0,attempted_sources:attemptedSources,opened_urls:[...openedURLs],search_queries:searchQueries,watch_sources:watchSources,source_inventory:inventory,source_rotation:sourceRotation,identity_note:presentation.identity_note,coverage_gaps:presentation.coverage_gaps,candidates};
  const saved=await db.from('eyeonads_discovery_reviews').update({status:'complete',report:presentation.report,sources:presentation.sources,evidence,searched_at:new Date().toISOString(),error:null}).eq('owner_id',ownerId).eq('agent_id',agent.id).eq('run_id',runId).select('agent_id,agent_name,status,report,sources,searched_at,error,evidence').single();
  if(saved.error||!saved.data)throw Error('Save failed');
  return saved.data;
 }catch{
  const message='Public search did not finish or could not be saved. No new review is confirmed. Retry this agent.';
  await db.from('eyeonads_discovery_reviews').update({status:'failed',error:message}).eq('owner_id',ownerId).eq('agent_id',agent.id).eq('run_id',runId);
  throw new Error(message);
 }
}
