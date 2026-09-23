import { verifiedIdentitySpan } from './completion-envelope';

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
export function selectSourceBlocks(blocks: SourceBlock[], raw: unknown, agent: string, brokerage: string) {
  if (!raw || typeof raw !== 'object') throw Error('invalid_selection');
  const value = raw as Record<string, unknown>;
  const choose = (ids: unknown, min: number, max: number) => {
    if (!Array.isArray(ids) || ids.length < min || ids.length > max || ids.some(id => !Number.isInteger(id) || id < 0 || id >= blocks.length) || new Set(ids).size !== ids.length) throw Error('invalid_block_ids');
    return ids.map(id => blocks[id as number]);
  };
  const promotion = choose(value.promotion_ids, 1, 2);
  const disclosures = choose(value.disclosure_ids, 0, 2);
  if (value.contains_promotion !== true || promotion.every(block => /^(listed by|brokered by|contact (listing|the|agent)|listing agent)\b/i.test(block.text))) throw Error('no_promotional_content');
  const agentBlock = choose([value.agent_block_id], 1, 1)[0];
  const brokerageBlock = choose([value.brokerage_block_id], 1, 1)[0];
  const matched = value.identity_confirmed === true && verifiedIdentitySpan(agentBlock.text, agentBlock.text, agent) && verifiedIdentitySpan(brokerageBlock.text, brokerageBlock.text, brokerage);
  if (!['TN', 'VA', 'NC', 'unknown'].includes(String(value.state)) || typeof value.context !== 'string' || value.context.length > 2500) throw Error('invalid_context');
  const selected = [...new Map([...promotion, ...disclosures].map(block => [block.id, block])).values()];
  const text = selected.map(block => block.text).join('\n');
  if (text.split(/\s+/).length > 150) throw Error('excerpt_limit');
  return { text, matched, state: value.state as 'TN' | 'VA' | 'NC' | 'unknown', context: value.context, selected, promotion_ids: promotion.map(block => block.id), identity_evidence: { agent: agentBlock.text, brokerage: brokerageBlock.text } };
}
