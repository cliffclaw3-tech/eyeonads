export function validateBrokerage(body: unknown): string | null {
 if(!body||typeof body!=='object')return 'Enter brokerage details.';
 const b=body as Record<string,unknown>;
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>150)return 'Enter a brokerage name up to 150 characters.';
 if(!Number.isInteger(b.expected_agents)||Number(b.expected_agents)<1||Number(b.expected_agents)>10000)return 'Enter your total agent count (1–10,000).';
 if(!['both','brokerage','agents'].includes(String(b.scope)))return 'Choose which accounts to include.';
 if(!Array.isArray(b.agents)||b.agents.length>1000)return 'Add up to 1,000 agents per beta roster.';
 if((b.website!==undefined&&typeof b.website!=='string')||(b.location!==undefined&&typeof b.location!=='string')||String(b.website||'').length>2000||String(b.location||'').length>200)return 'Use a shorter website and location.';
 const emails=new Set<string>();
 const ids=new Set<string>();
 for(const a of b.agents){
  if(a?.id!==undefined&&(typeof a.id!=='string'||!a.id.trim()||a.id.length>300))return 'An agent identifier is invalid.';
  if(a?.id){if(ids.has(a.id))return 'Duplicate agent identifiers are not allowed.';ids.add(a.id);}
  if(!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>150||typeof a.email!=='string'||a.email.length>254||(a.email.trim()&&!/^\S+@\S+\.\S+$/.test(a.email.trim())))return 'Each agent needs a name and, if supplied, a valid email.';
  const email=a.email.trim().toLowerCase() || a.id?.trim() || a.name.trim().toLowerCase();if(emails.has(email))return 'An email appears more than once. List each agent once.';emails.add(email);
  if(a.social_url!==undefined&&typeof a.social_url!=='string')return 'Social links must be text URLs.';
  if(a.social_url){try{const u=new URL(a.social_url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||a.social_url.length>2000)throw Error();}catch{return 'Social links must be full https:// or http:// URLs without credentials.';}}
 }
 if(b.agents.length>Number(b.expected_agents))return 'Your roster has more agents than your total. Update the total or remove duplicates.';
 return null;
}
