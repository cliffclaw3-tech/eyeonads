import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isBroker } from '@/lib/broker-access';
import { sameOrigin } from '@/lib/discovery-jobs';
import { selectedOffices } from '@/lib/public-brokerage-preview';
import { suggestPublicAgents, suggestPublicOffices } from '@/lib/public-brokerage-search';

export const runtime = 'nodejs';
export const maxDuration = 120;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: 'Sign in to find public office information.' }, 401);
  if (!await isBroker(db, user)) return reply({ error: 'Broker access required.' }, 403);
  if (!user.app_metadata?.eyeonads_pilot) return reply({ error: 'Public office lookup is available to invited beta brokers.' }, 403);
  if (process.env.EYEONADS_PAID_ANALYSIS_ENABLED !== '1') return reply({ error: 'Public suggestions are temporarily unavailable. Enter offices and agents manually.' }, 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply({ error: 'Enter your brokerage and area.' }, 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 150) return reply({ error: 'Enter a brokerage name up to 150 characters.' }, 400);
  try {
    if (body.action === 'offices') {
      const region = typeof body.region === 'string' ? body.region.trim() : '';
      const website = typeof body.website === 'string' ? body.website.trim() : '';
      if (!region || region.length > 150 || website.length > 2000) return reply({ error: 'Enter a region, such as East Tennessee, and an optional website.' }, 400);
      if (website) {
        const url = new URL(website);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return reply({ error: 'Use a public HTTPS brokerage website.' }, 400);
      }
      return reply({ offices: await suggestPublicOffices(name, region, website), note: 'Suggestions only. Confirm the offices you oversee before finding agents. No setup was saved.' });
    }
    if (body.action === 'agents') {
      const offices = selectedOffices(body.offices);
      if (!offices || offices.length > 5) return reply({ error: 'Select up to five offices you oversee.' }, 400);
      return reply({ agents: await suggestPublicAgents(name, offices), note: 'Public directory suggestions may be incomplete or outdated. Confirm each name and office before saving a roster. No setup was saved.' });
    }
    return reply({ error: 'Choose office or agent suggestions.' }, 400);
  } catch {
    return reply({ error: 'Public lookup did not finish. Retry or enter offices and agents manually. No setup was changed.' }, 503);
  }
}
