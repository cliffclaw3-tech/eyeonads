import { load } from 'cheerio';
import { readPublicPage } from './public-page.ts';
import { previewAgents, type PublicAgent, type PublicOffice } from './public-brokerage-preview.ts';

const DIRECTORY_LINK = /(?:agents?|realtors?|our[-_ ]team|meet[-_ ](?:our[-_ ])?team|associates|people|staff|brokers?)/i;
const ROLE = /\b(?:realtor|real estate agent|real estate broker|affiliate broker|managing broker|broker|sales associate|email me)\b/i;
const BAD_NAME = /\b(?:realty|properties|homes|office|team|contact|search|listing|locations|learn|read|view|more|information|website|facebook|instagram|brokerage|group)\b/i;
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

function personName(raw: string): string | null {
  const name = tidy(raw).replace(/\s*(?:[-|–]\s*)?(?:REALTOR|BROKER)\s*®?\s*$/i, '').trim();
  if (name.length < 5 || name.length > 80 || BAD_NAME.test(name) || /\d|[@<>]/.test(name)) return null;
  const words = name.split(/\s+/);
  return words.length >= 2 && words.length <= 5 && words.every(word => /^[\p{L}][\p{L}'’.\-]*$/u.test(word)) ? name : null;
}

function sameSite(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base), root = new URL(base);
    const host = (value: URL) => value.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || host(url) !== host(root) || url.username || url.password || url.port || url.hash) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function inspectDirectory(html: string, pageUrl: string, directoryPage = false) {
  const $ = load(html);
  $('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove();
  const links = new Set<string>();
  const pages = new Set<string>();
  const names = new Set<string>();
  $('a[href]').each((_, node) => {
    const element = $(node), url = sameSite(element.attr('href') || '', pageUrl);
    if (!url) return;
    const label = tidy(element.text());
    const path = new URL(url).pathname;
    const profile = (/\/agent\.php$/i.test(path) && new URL(url).searchParams.has('agentid')) || /\/agents?\/[^/]+/i.test(path);
    if (DIRECTORY_LINK.test(`${label} ${path}`) && !profile) links.add(url);
    if (directoryPage && new URL(url).pathname === new URL(pageUrl).pathname && (/^\d{1,3}$/.test(label) || /^(?:next|last|›|»)$/i.test(label) || element.attr('rel') === 'next')) pages.add(url);
    if (directoryPage && /\/(?:agent|realtor)(?:s)?(?:\/|\.php)/i.test(path)) {
      const name = personName(label);
      if (name) names.add(name);
    }
  });
  if (directoryPage) $('h1,h2,h3,h4,[class*="team_member_box_overlay_title"],[class*="agent-name"],[class*="agent_name"],[class*="team-member-name"],[itemprop="name"]').each((_, node) => {
    const element = $(node), name = personName(element.text());
    if (!name) return;
    const container = element.parent().closest('article,li,[class*="agent"],[class*="team"],[class*="member"]');
    const scope = container.length ? container : element.parent();
    const context = tidy(scope.find('h1,h2,h3,h4,p,span,a,[class*="subtitle"]').map((_, child) => $(child).text()).get().join(' ')).slice(0, 450);
    if (ROLE.test(context)) names.add(name);
  });
  return { links: [...links], pages: [...pages], names: [...names] };
}

export async function readOfficialDirectory(
  offices: PublicOffice[], defaultOffice: PublicOffice,
  read?: (url: string) => Promise<{ url: string; html: string }>,
): Promise<{ agents: PublicAgent[]; pagesRead: number; incomplete: boolean }> {
  const deadline = Date.now() + 35000;
  const fetchPage = read ?? (async (url: string) => {
    const page = await readPublicPage(url, { timeoutMs: 9000, deadline, includeHtml: true });
    return { url: page.url, html: page.html || '' };
  });
  const officeKey = `${defaultOffice.name}|${defaultOffice.location}`;
  const seeds = offices.flatMap(office => [office.website, office.source_url]).filter(Boolean).slice(0, 10);
  const queue: { url: string; directory: boolean }[] = seeds.map(url => ({ url, directory: DIRECTORY_LINK.test(new URL(url).pathname) }));
  const visited = new Set<string>();
  const found = new Map<string, PublicAgent>();
  let pagesRead = 0, incomplete = false;
  while (queue.length && visited.size < 20 && Date.now() < deadline) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    try {
      const page = await fetchPage(item.url);
      const source = sameSite(page.url, item.url);
      if (!source) { incomplete = true; continue; }
      const directory = item.directory || DIRECTORY_LINK.test(new URL(source).pathname);
      const result = inspectDirectory(page.html, source, directory);
      if (directory) {
        pagesRead++;
        for (const name of result.names) if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, office: officeKey, source_url: source });
        for (const url of result.pages) if (!visited.has(url)) queue.push({ url, directory: true });
      } else {
        for (const url of result.links.slice(0, 8)) if (!visited.has(url)) queue.push({ url, directory: true });
      }
    } catch { incomplete = true; }
  }
  if (queue.length || found.size > 250 || found.size === 0) incomplete = true;
  return { agents: previewAgents([...found.values()], offices), pagesRead, incomplete };
}
