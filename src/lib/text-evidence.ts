import type { ComplianceFlag } from './supabase/types';

export type TextEvidenceInput={firmName:string;identityExcerpts:string|readonly string[];partialSource:boolean};
export type TextEvidenceFacts={firm_name_visible:boolean;firm_phone_visible:boolean;firm_name_evidence:string[];firm_phone_evidence:{excerpt:string;phone:string}[]};
type Review={result:'green'|'yellow'|'red';flags:ComplianceFlag[];summary:string;coverage_notes?:string[]};
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Only caller-supplied captured excerpts count. Do not infer contact information
// from context strings, the agent record, web search snippets or neighboring text.
export function extractTextEvidence(input:TextEvidenceInput):TextEvidenceFacts {
  const facts:TextEvidenceFacts={firm_name_visible:false,firm_phone_visible:false,firm_name_evidence:[],firm_phone_evidence:[]};
  if(!input||typeof input.firmName!=='string'||!input.firmName.trim()||input.firmName.length>200)return facts;
  const excerpts=typeof input.identityExcerpts==='string'?[input.identityExcerpts]:Array.isArray(input.identityExcerpts)?input.identityExcerpts:[];
  const words=input.firmName.trim().split(/\s+/).map(escapeRegex);
  const firm=new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`,'giu');
  for(const excerpt of excerpts.slice(0,12)){
    if(typeof excerpt!=='string'||!excerpt.trim()||excerpt.length>5000)continue;
    for(const match of excerpt.matchAll(firm)){
      facts.firm_name_visible=true;
      if(!facts.firm_name_evidence.includes(excerpt))facts.firm_name_evidence.push(excerpt);
      const after=excerpt.slice(match.index!+match[0].length,match.index!+match[0].length+110);
      const phone=after.match(/(?<!\d)(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}(?!\d)/);
      if(!phone||phone.index===undefined||phone.index>65)continue;
      const bridge=after.slice(0,phone.index);
      // New lines/semicolons and another contact's labels break the association.
      // A following locality or explicit office/tel label is permitted.
      if(/[\n\r;]|\d/.test(bridge)||/\b(agent|mobile|cell|direct|fax|realtor|listed|listing|license|brokerage|realty|real estate|broker)\b/i.test(bridge))continue;
      const bridgeWords=bridge.toLowerCase().replace(/[^a-z]+/g,' ').trim().split(/\s+/).filter(word=>word&&!['office','main','firm','phone','telephone','tel','contact','number','call'].includes(word));
      // Do not jump across another person's/firm's multiword name. Permit a
      // single locality (Jonesborough) or a locality ending in a state/City.
      if(bridgeWords.length>1&&!/^(?:tn|va|nc|city|county|township|beach|springs)$/.test(bridgeWords[bridgeWords.length-1]))continue;
      if(/\b(compass|exp|remax|keller|coldwell|berkshire|century)\b/i.test(bridge))continue;
      facts.firm_phone_visible=true;
      if(!facts.firm_phone_evidence.some(item=>item.excerpt===excerpt&&item.phone===phone[0]))facts.firm_phone_evidence.push({excerpt,phone:phone[0]});
    }
  }
  return facts;
}

// Findings involving substantive content or correctness survive even if their
// wording also mentions a coverage gap or a visible phone number.
const substantive=/\b(incorrect|inaccurate|wrong|outdated|expired|misleading|deceptive|false|fraud|income|profit|return|rental|rentals|renting|airbnb|unrestricted|guarantee|guaranteed|promise|promises|discriminat\w*|steer\w*|protected|racial|race|religio\w*|gender|disabil\w*|children|families|familial|senior|occupancy|unlicensed|zoning|permit|flood|school|financ\w*|mortgage|unsubstantiated|unsupported|ownership|consent|inconsisten\w*|discrepan\w*|conflict\w*|mismatch|differs|claims?|prohibited|illegal)\b/i;
const absent=/\b(missing|absent|lacks?|lack of|not (?:visible|shown|included|provided|displayed|present|found|identified)|does not (?:show|include|provide|display)|no (?:firm|brokerage|office|company)(?:['’]s)?\s+(?:name|phone|telephone|contact|identification))\b/i;
const firmPhone=/\b(?:firm|brokerage|office|company)(?:['’]s)?(?:\s+\w+){0,2}\s+(?:phone|telephone|contact)(?:\s+number)?\b/i;
const firmName=/\b(?:firm|brokerage|company)(?:['’]s)?\s+(?:name|identification|identity)\b/i;
const scope=/incomplete (?:context|source|capture)|partial (?:context|source|capture|excerpt)|third.party|syndicat|coverage (?:gap|limit)|limited (?:context|source)|full (?:ad|advertisement|page).*not (?:available|reviewed|captured)/i;

export function normalizeTextReview(review:Review,evidence?:TextEvidenceInput):Review {
  if(!evidence?.partialSource)return review;
  const facts=extractTextEvidence(evidence);
  const notes=(Array.isArray(review.coverage_notes)?review.coverage_notes:[]).filter((note):note is string=>typeof note==='string'&&note.length<=1000).slice(0,8);
  let correctedPresence=false,removedScope=false;
  const flags=review.flags.filter(flag=>{
    const text=`${flag.rule}. ${flag.explanation}`;
    if(substantive.test(text)||/whether (?:this|it) is|phone.*(?:accuracy|currency|validity)|number.*(?:accuracy|currency|validity)/i.test(text))return true;
    const missing=absent.test(text),phoneClaim=firmPhone.test(text),nameClaim=firmName.test(text);
    // Never discard a bundled finding about other missing disclosures.
    const otherMissing=missing&&/\b(EHO|equal housing|license|licensing|address|agent name)\b/i.test(text);
    if(missing&&!otherMissing&&(phoneClaim||nameClaim)&&(!phoneClaim||facts.firm_phone_visible)&&(!nameClaim||facts.firm_name_visible)){
      correctedPresence=true;return false;
    }
    if(scope.test(flag.rule)&&scope.test(text)&&!missing&&!/\b(required disclosure|violation|illegal|prohibited|must include|must display)\b/i.test(text)){
      removedScope=true;return false;
    }
    return true;
  });
  if(!correctedPresence&&!removedScope)return {...review,...(notes.length?{coverage_notes:notes}:{})};
  if(correctedPresence)notes.push(facts.firm_phone_visible?'The firm name and a following telephone number are visible in the captured evidence. Phone correctness, currency and legal compliance are unverified.':'The firm name is visible in the captured evidence. Current affiliation and legal compliance are unverified.');
  if(removedScope)notes.push('Partial capture and third-party publication limit coverage; they are not standalone advertising-content findings.');
  notes.push('The complete advertisement, page layout and permitted linked disclosures were not fully reviewed.');
  const result=flags.some(flag=>flag.severity==='red')?'red':flags.some(flag=>flag.severity==='yellow')?'yellow':'green';
  const summary=flags.length?`The reviewed text contains ${flags.length} potential issue${flags.length===1?'':'s'} requiring review. Source coverage remains partial; visible contact information does not establish correctness or compliance.`:'No issues were detected in the reviewed text. Source coverage remains partial; this is not approval or a determination of current legal compliance.';
  return {...review,result,flags,summary,coverage_notes:[...new Set(notes)].slice(0,12)};
}
