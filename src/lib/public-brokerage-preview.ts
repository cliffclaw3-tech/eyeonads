export type PublicOffice = { name: string; location: string; website: string; source_url: string };
export type PublicAgent = { name: string; office: string; source_url: string; source_type?: 'public' | 'spark' };

const clean = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
const publicLink = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /(^|\.)(localhost|local)$/.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(':')) return '';
    return url.href;
  } catch { return ''; }
};
export function previewOffices(raw: unknown): PublicOffice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 15).flatMap(item => {
    const name = clean(item?.name, 120), location = clean(item?.location, 120);
    const website = publicLink(item?.website), source_url = publicLink(item?.source_url);
    const key = `${name}|${location}`.toLowerCase();
    if (!name || !location || !source_url || seen.has(key)) return [];
    seen.add(key);
    return [{ name, location, website, source_url }];
  });
}
export function previewAgents(raw: unknown, selected: PublicOffice[]): PublicAgent[] {
  if (!Array.isArray(raw)) return [];
  const offices = new Set(selected.map(office => `${office.name}|${office.location}`.toLowerCase()));
  const seen = new Set<string>();
  return raw.slice(0, 250).flatMap(item => {
    const name = clean(item?.name, 120), office = clean(item?.office, 250), source_url = publicLink(item?.source_url);
    const key = `${name}|${office}`.toLowerCase();
    if (!/^\S+\s+\S+/.test(name) || !source_url || !offices.has(office.toLowerCase()) || seen.has(key)) return [];
    seen.add(key);
    return [{ name, office, source_url }];
  });
}
export function selectedOffices(raw: unknown): PublicOffice[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) return null;
  const offices = previewOffices(raw);
  return offices.length === raw.length ? offices : null;
}
