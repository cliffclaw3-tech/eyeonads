import { verifiedIdentitySpan } from './completion-envelope';
export function validateAdExtraction(page:string,raw:unknown,agent:string,brokerage:string){
  if(!raw||typeof raw!=='object')throw Error('Invalid extraction');
  const value=raw as Record<string,unknown>;
  const promotion=value.promotional_excerpt;
  if(typeof promotion!=='string'||!page.includes(promotion)||promotion.trim().split(/\s+/).length<5||/^(listed by|brokered by|contact (listing|the|agent)|listing agent)\b/i.test(promotion.trim()))throw Error('No verified promotional content');
  if(!Array.isArray(value.excerpts)||value.excerpts.length>10||!value.excerpts.every(part=>typeof part==='string'&&part.trim()&&page.includes(part)))throw Error('Non-verbatim evidence');
  const excerpts=[promotion,...value.excerpts as string[]].filter((part,index,all)=>all.indexOf(part)===index);
  const text=excerpts.join('\n');
  if(text.split(/\s+/).length>150||!['TN','VA','NC','unknown'].includes(String(value.state))||typeof value.context!=='string')throw Error('Invalid extraction');
  const matched=value.identity_confirmed===true&&verifiedIdentitySpan(page,value.agent_evidence,agent)&&verifiedIdentitySpan(page,value.brokerage_evidence,brokerage);
  return {text,matched,state:value.state as 'TN'|'VA'|'NC'|'unknown',context:value.context};
}
