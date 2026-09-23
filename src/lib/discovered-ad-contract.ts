export type DiscoveredAd = { url: string; title: string; kind: 'advertisement' | 'listing' | 'profile'; identity: 'matched' | 'uncertain'; state: 'TN' | 'VA' | 'NC' | 'unknown'; ad_text: string; context: string; page_access: 'page_read' | 'snippet_only' | 'blocked' };
export function validSourceURL(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 3000) return false;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function reviewableAd(ad: DiscoveredAd) {
  return validSourceURL(ad.url) && ad.identity === 'matched' && ad.kind !== 'profile' && ad.page_access === 'page_read' && ad.ad_text.trim().length > 0 && ad.ad_text.length <= 10000 && ['TN', 'VA', 'NC'].includes(ad.state);
}
export const discoveredSchema = {
  type: 'object', additionalProperties: false, required: ['identity_note', 'coverage_gaps', 'candidates'],
  properties: {
    identity_note: { type: 'string' }, coverage_gaps: { type: 'array', items: { type: 'string' } },
    candidates: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false,
      required: ['url','title','kind','identity','state','ad_text','context','page_access'], properties: {
        url: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string', enum: ['advertisement','listing','profile'] },
        identity: { type: 'string', enum: ['matched','uncertain'] }, state: { type: 'string', enum: ['TN','VA','NC','unknown'] },
        ad_text: { type: 'string' }, context: { type: 'string' }, page_access: { type: 'string', enum: ['page_read','snippet_only','blocked'] },
      } } },
  },
};

// A model's claim to have read a page is insufficient without a matching tool event.
export function groundCandidate(ad: DiscoveredAd, openedURLs: Set<string>): DiscoveredAd {
  const canonical = (value: string) => { try { const u = new URL(value); u.hash = ''; return u.href.replace(/\/$/, ''); } catch { return ''; } };
  const opened = [...openedURLs].some(url => canonical(url) === canonical(ad.url));
  if (ad.page_access === 'page_read' && !opened) return { ...ad, page_access: 'snippet_only', ad_text: '', context: `${ad.context} Full-page access was not confirmed by the search tool; no ad-text assessment was performed.` };
  return ad;
}
