/** Syntax and provenance only: a recognized URL never proves ownership or API access. */
export type SocialPlatform = 'facebook' | 'instagram' | 'x' | 'linkedin';
export type SubmittedSocialIdentity = {
  platform: SocialPlatform;
  url: string;
  account_kind: 'profile' | 'company' | 'unspecified';
  source: 'broker_supplied';
  recorded_at: string;
  ownership: 'unverified';
  retrieval: 'not_checked';
};
const reserved: Record<SocialPlatform, Set<string>> = {
  facebook: new Set(['ads','adlibrary','watch','reel','reels','posts','stories','story.php','permalink.php','photo','photo.php','photos','groups','events','login','help','share','sharer','sharer.php','marketplace','search','gaming','settings','privacy','business','pages','people']),
  instagram: new Set(['p','reel','reels','stories','explore','accounts','direct','about','developer','legal']),
  x: new Set(['i','home','search','explore','notifications','messages','settings','intent','share','login','signup','compose','tos','privacy']),
  linkedin: new Set(),
};
export function submittedSocialIdentity(raw: string, recordedAt: string): SubmittedSocialIdentity {
  if (typeof raw !== 'string' || raw.length > 2000 || /[\x00-\x20\x7f\\]/.test(raw)) throw Error('Enter a complete social profile URL without spaces.');
  if (!Number.isFinite(Date.parse(recordedAt))) throw Error('A valid capture date is required.');
  const rawPath = raw.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? '';
  if (rawPath.split('/').some(part => part === '.' || part === '..') || rawPath.includes('%')) throw Error('Use the canonical profile URL without encoded or relative paths.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw Error('Enter a complete https:// social profile URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || /%/.test(parsed.pathname)) throw Error('Use an HTTPS profile URL without credentials, custom ports or encoded paths.');
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/$/, '');
  const parts = path.split('/').filter(Boolean);
  // Reject ambiguous path spellings rather than silently interpreting them as an identity.
  if (parsed.pathname.includes('//')) throw Error('Use the canonical profile URL.');
  let platform: SocialPlatform, canonical: string, kind: SubmittedSocialIdentity['account_kind'] = 'unspecified';
  if (['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com'].includes(host)) {
    platform = 'facebook';
    if (path === '/profile.php' && /^\d+$/.test(parsed.searchParams.get('id') || '') && parsed.searchParams.getAll('id').length === 1) {
      canonical = `https://www.facebook.com/profile.php?id=${parsed.searchParams.get('id')}`;
    } else if (parts.length === 3 && parts[0] === 'people' && /^[a-zA-Z0-9._-]+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
      canonical = `https://www.facebook.com/people/${parts[1]}/${parts[2]}`;
    } else if (parts.length === 1 && /^[a-zA-Z0-9.]+$/.test(parts[0]) && !reserved.facebook.has(parts[0].toLowerCase()) && !parts[0].toLowerCase().endsWith('.php')) {
      canonical = `https://www.facebook.com/${parts[0].toLowerCase()}`;
    } else throw Error('Use a Facebook profile or Page URL, not an individual post or ad.');
  } else if (['instagram.com','www.instagram.com'].includes(host)) {
    platform = 'instagram'; kind = 'profile';
    if (parts.length !== 1 || !/^[a-zA-Z0-9._]{1,30}$/.test(parts[0]) || reserved.instagram.has(parts[0].toLowerCase())) throw Error('Use an Instagram profile URL, not a post.');
    canonical = `https://www.instagram.com/${parts[0].toLowerCase()}`;
  } else if (['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(host)) {
    platform = 'x'; kind = 'profile';
    if (parts.length !== 1 || !/^[a-zA-Z0-9_]{1,15}$/.test(parts[0]) || reserved.x.has(parts[0].toLowerCase())) throw Error('Use an X profile URL, not a post.');
    canonical = `https://x.com/${parts[0].toLowerCase()}`;
  } else if (['linkedin.com','www.linkedin.com'].includes(host)) {
    platform = 'linkedin';
    if (parts.length !== 2 || !['in','company'].includes(parts[0]) || !/^[a-zA-Z0-9_-]+$/.test(parts[1])) throw Error('Use a LinkedIn member or company profile URL.');
    kind = parts[0] === 'company' ? 'company' : 'profile';
    canonical = `https://www.linkedin.com/${parts[0]}/${parts[1].toLowerCase()}`;
  } else throw Error('Choose a Facebook, Instagram, X or LinkedIn profile URL.');
  return { platform, url: canonical, account_kind: kind, source: 'broker_supplied', recorded_at: new Date(recordedAt).toISOString(), ownership: 'unverified', retrieval: 'not_checked' };
}

export type SocialProfileMap = Partial<Record<SocialPlatform, SubmittedSocialIdentity>>;
/** Omitted keys retain saved identities; null explicitly removes one. Never accept client proof. */
export function mergeSubmittedProfiles(previous: SocialProfileMap, patch: unknown, recordedAt: string): SocialProfileMap {
  if (patch === undefined) return { ...previous };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Social profiles must be a platform-to-URL map.');
  const result = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(reserved, key)) throw Error('Unsupported social platform.');
    const platform = key as SocialPlatform;
    if (value === null) { delete result[platform]; continue; }
    if (typeof value !== 'string') throw Error('Supply a profile URL, not a verification record.');
    const identity = submittedSocialIdentity(value, recordedAt);
    if (identity.platform !== platform) throw Error('The profile URL does not match its platform.');
    // Resubmitting the same URL is not new evidence and must not reset provenance dates.
    result[platform] = previous[platform]?.url === identity.url ? previous[platform] : identity;
  }
  return result;
}
/** Match only stable roster IDs, never a display name or a URL guessed from that name. */
export function preserveAgentProfiles<T extends {id: string}>(agents: T[], previous: Array<{id: string; social_profiles?: SocialProfileMap}>, patches: unknown[], recordedAt: string): Array<T & {social_profiles?: SocialProfileMap}> {
  if (agents.length !== patches.length || new Set(agents.map(agent => agent.id)).size !== agents.length) throw Error('Agent identifiers must be unique.');
  const saved = new Map(previous.map(agent => [agent.id, agent.social_profiles]));
  return agents.map((agent, index) => {
    const profiles = mergeSubmittedProfiles(saved.get(agent.id) ?? {}, patches[index], recordedAt);
    return Object.keys(profiles).length ? { ...agent, social_profiles: profiles } : agent;
  });
}
