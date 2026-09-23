export type SourceBlock = { id: number; text: string };
/** Return exact slices, with overlap so names and short disclosures survive boundaries. */
export function sourceBlocks(page: string): SourceBlock[] {
  const words = [...page.matchAll(/\S+/g)];
  const blocks: SourceBlock[] = [];
  for (let start = 0; start < words.length; start += 30) {
    const last = words[Math.min(start + 34, words.length - 1)];
    blocks.push({ id: blocks.length, text: page.slice(words[start].index!, last.index! + last[0].length) });
    if (start + 35 >= words.length) break;
  }
  return blocks;
}
export type SourceAttribution = {role:'listing_agent'|'advertiser'|'buyer_agent'|'unknown';evidence:string;block_ids:number[];verified:boolean;reason?:string};
const normalize=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Reconstruct only overlapping blocks; disconnected pieces remain separate groups. */
function sourceGroups(blocks:SourceBlock[]) {
  const groups:{text:string;ranges:{id:number;start:number;end:number}[]}[]=[];
  for(const block of blocks){
    const group=groups.at(-1);
    let overlap=group?Math.min(group.text.length,block.text.length):0;
    while(overlap>0&&group!.text.slice(-overlap)!==block.text.slice(0,overlap))overlap--;
    // sourceBlocks guarantees five shared words; a coincidental character/word
    // match must not join otherwise disconnected pieces into new evidence.
    if(overlap&&block.text.slice(0,overlap).trim().split(/\s+/).length<5)overlap=0;
    if(!group||!overlap){groups.push({text:block.text,ranges:[{id:block.id,start:0,end:block.text.length}]});continue;}
    const start=group.text.length-overlap;group.text+=block.text.slice(overlap);group.ranges.push({id:block.id,start,end:group.text.length});
  }
  return groups;
}
const rolePattern=/\b(listed\s*by|listing\s+courtesy\s+of|courtesy\s+of|listing\s+(?:information\s+)?provided\s+by|advertised\s+by|advertiser|list\s*by|listing\s+agents?|sold\s*by|bought\s+with|buyer['’]?s?\s+agent)\s*:?\s*/gi;
const endContext=/\b(?:last\s+updated|MLS\s*[#:]|source\s*:|related\s+(?:agents|properties)|similar\s+(?:homes|properties)|property\s+details|listing\s+details|see\s+it\s+first|copyright|all\s+information|contact\s+(?:the|agent|listing))\b/i;
function localIdentity(body:string,agent:string,brokerage:string):boolean {
  const value=normalize(body),name=normalize(agent),firm=normalize(brokerage);
  const ni=value.indexOf(name),fi=value.indexOf(firm);
  if(ni<0||fi<0||!(` ${value} `).includes(` ${name} `)||!(` ${value} `).includes(` ${firm} `)||Math.abs(ni-fi)>180)return false;
  const first=ni<fi?name:firm,start=Math.min(ni,fi),end=Math.max(ni,fi);
  const between=value.slice(start+first.length,end).replace(/\b(brokered by|brokerage|broker|listing office|llc|inc|jonesborough|realtor|phone|tel|cell)\b/g,'').replace(/[0-9 ]/g,'');
  if(start<=5&&!between)return true;
  // Shared-firm co-listing is allowed only as an explicit comma/and/& separated
  // list of human names before the firm. Arbitrary intervening prose or firms fail.
  if(ni<fi){
    const firmAt=body.toLowerCase().indexOf(brokerage.toLowerCase());
    if(firmAt<0)return false;
    const names=body.slice(0,firmAt).trim().replace(/[•|:]+$/g,'').trim();
    if(!/,|&|\band\b/i.test(names)||names.length>180)return false;
    const people=names.split(/,|&|\band\b/i).map(part=>part.replace(/\(?\d[\d().+ -]{5,}\d\)?/g,'').replace(/[•|:.]+$/g,'').trim()).filter(Boolean);
    return people.length>=2&&people.length<=4&&people.some(person=>normalize(person)===name)&&people.every(person=>/^[A-ZÀ-ÖØ-Þ][\p{L}.'’−-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}.'’−-]+){1,4}$/u.test(person));
  }
  return false;
}
/** Derive explicit local roles from captured source text, never model role claims. */
export function sourceAttribution(blocks:SourceBlock[],_raw:Record<string,unknown>,agent:string,brokerage:string):SourceAttribution {
  const empty:SourceAttribution={role:'unknown',evidence:'',block_ids:[],verified:false,reason:'No exact source role links this agent and firm to the advertisement.'};
  const segments:{role:SourceAttribution['role'];label:string;evidence:string;body:string;ids:number[];group:number;start:number;end:number}[]=[];
  for(const [groupIndex,group] of sourceGroups(blocks).entries()){
    const roles=[...group.text.matchAll(new RegExp(rolePattern.source,rolePattern.flags))];
    for(let i=0;i<roles.length;i++){
      const match=roles[i],start=match.index!,bodyStart=start+match[0].length;
      let end=Math.min(roles[i+1]?.index??group.text.length,start+500);
      const boundary=group.text.slice(bodyStart,end).search(endContext);if(boundary>=0)end=bodyStart+boundary;
      const evidence=group.text.slice(start,end).trimEnd();
      const label=normalize(match[1]),buyer=/^(sold by|bought with|buyer)/.test(label);
      segments.push({group:groupIndex,start,end,role:buyer?'buyer_agent':/advertis/.test(label)?'advertiser':'listing_agent',label,evidence,body:group.text.slice(bodyStart,start+evidence.length),ids:group.ranges.filter(range=>range.start<start+evidence.length&&range.end>start).map(range=>range.id)});
    }
  }
  const buyer=segments.find(segment=>segment.role==='buyer_agent'&&localIdentity(segment.body,agent,brokerage));
  // The first primary credit remains authoritative. A related card farther down
  // the page cannot overwrite a conflicting primary agent or brokerage.
  const listings=segments.filter(segment=>segment.role!=='buyer_agent');
  const primary=listings.find(segment=>segment.label!=='listing agent'&&segment.label!=='listing agents')||listings[0];
  if(primary&&localIdentity(primary.body,agent,brokerage))return {role:primary.role,evidence:primary.evidence,block_ids:primary.ids,verified:true,reason:'An exact contiguous primary source role links the agent and brokerage to this advertisement.'};
  // Consecutive explicit same-firm listing credits form a co-list cluster only
  // when there is no intervening source boundary or related-card context.
  if(primary){
    const firm=normalize(brokerage);
    const sameFirmHumanCredit=(body:string)=>{
      const at=body.toLowerCase().indexOf(brokerage.toLowerCase());if(at<0||!(` ${normalize(body)} `).includes(` ${firm} `))return false;
      const name=body.slice(0,at).replace(/\(?\d[\d().+ -]{5,}\d\)?/g,'').replace(/[•|:.,\s]+$/g,'').trim();
      return /^[A-ZÀ-ÖØ-Þ][\p{L}.'’−-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}.'’−-]+){1,4}$/u.test(name);
    };
    let prior=primary;
    if(sameFirmHumanCredit(prior.body))for(const next of segments.slice(segments.indexOf(primary)+1)){
      if(next.role!=='listing_agent'||next.group!==prior.group||next.start!==prior.end||!sameFirmHumanCredit(next.body))break;
      if(localIdentity(next.body,agent,brokerage))return {role:'listing_agent',evidence:next.evidence,block_ids:next.ids,verified:true,reason:'An exact adjacent same-firm primary co-listing credit links this agent to the advertisement.'};
      prior=next;
    }
  }

  if(buyer)return {role:'buyer_agent',evidence:buyer.evidence,block_ids:buyer.ids,verified:false,reason:'The source credits this identity in a buyer or sold-by role, not as the listing advertiser.'};
  if(primary)return {role:primary.role,evidence:primary.evidence,block_ids:primary.ids,verified:false,reason:'The primary listing credit does not link the expected agent and brokerage; a later identity cannot override it.'};
  return empty;
}
export function selectSourceBlocks(blocks: SourceBlock[], raw: unknown, agent: string, brokerage: string) {
  if (!raw || typeof raw !== 'object') throw Error('invalid_selection');
  const value = raw as Record<string, unknown>;
  // Negative decisions are valid outcomes, not malformed positive selections.
  if(value.contains_promotion!==true)throw Error('no_promotional_content');

  const choose = (ids: unknown, min: number, max: number) => {
    if (!Array.isArray(ids) || ids.length < min || ids.length > max || ids.some(id => !Number.isInteger(id) || id < 0 || id >= blocks.length) || new Set(ids).size !== ids.length) throw Error('invalid_block_ids');
    return ids.map(id => blocks[id as number]);
  };
  const promotion = choose(value.promotion_ids, 1, 2);
  const disclosures = choose(value.disclosure_ids, 0, 2);
  if (promotion.every(block => /^(listed by|brokered by|contact (listing|the|agent)|listing agent)\b/i.test(block.text))) throw Error('no_promotional_content');
  const attribution=sourceAttribution(blocks,value,agent,brokerage);
  const agentBlock=Number.isInteger(value.agent_block_id)?blocks[value.agent_block_id as number]:undefined;
  const brokerageBlock=Number.isInteger(value.brokerage_block_id)?blocks[value.brokerage_block_id as number]:undefined;
  const matched=attribution.verified;
  if(!matched&&(value.identity_confirmed!==true||!agentBlock||!brokerageBlock))throw Error('identity_unverified');
  if (!['TN', 'VA', 'NC', 'unknown'].includes(String(value.state)) || typeof value.context !== 'string' || value.context.length > 2500) throw Error('invalid_context');
  const selected = [...new Map([...promotion, ...disclosures].map(block => [block.id, block])).values()];
  const text = selected.map(block => block.text).join('\n');
  if (text.split(/\s+/).length > 150) throw Error('excerpt_limit');
  return { text, matched, attribution, state: value.state as 'TN' | 'VA' | 'NC' | 'unknown', context: value.context, selected, promotion_ids: promotion.map(block => block.id), identity_evidence: { agent: matched?attribution.evidence:agentBlock?.text||'', brokerage: matched?attribution.evidence:brokerageBlock?.text||'' } };
}
