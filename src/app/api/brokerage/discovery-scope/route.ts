import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/discovery-jobs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: 'Sign in to choose the office search scope.' }, 401);
  if (!user.app_metadata?.eyeonads_pilot) return reply({ error: 'Office search scope is available to invited pilots.' }, 403);
  const body = await request.json().catch(() => null);
  const ids = body?.agent_ids;
  const location = body?.location ?? null;
  if (location !== null && (typeof location !== "string" || !location.trim() || location.length > 200)) return reply({ error: "Use an office location up to 200 characters." }, 400);
  if (ids !== null && (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !id || id.length > 300) || new Set(ids).size !== ids.length)) return reply({ error: 'Choose at least one unique saved agent, or use the entire saved roster.' }, 400);
  const { data: setup, error } = await db.from('eyeonads_brokerage_setups').select('agents').eq('owner_id', user.id).maybeSingle();
  if (error) return reply({ error: 'Saved roster could not be checked. Retry.' }, 503);
  if (!setup) return reply({ error: 'Save your brokerage roster first.' }, 400);
  const saved = new Set((setup.agents as { id: string }[]).map(agent => agent.id));
  if (ids && ids.some((id: string) => !saved.has(id))) return reply({ error: 'Some imported agents are not in the saved roster. Save the import first, then select the office scope.' }, 400);
  const { data: job, error: jobError } = await db.from('eyeonads_discovery_jobs').select('status').eq('owner_id', user.id).maybeSingle();
  if (jobError) return reply({ error: 'Search status could not be checked. Retry.' }, 503);
  if (job && ['running', 'paused'].includes(job.status)) return reply({ error: 'Finish the existing search batch before changing its office scope.' }, 409);
  const result = await db.from('eyeonads_brokerage_setups').update({ discovery_agent_ids: ids, discovery_location: ids ? location?.trim() || null : null, updated_at: new Date().toISOString() }).eq('owner_id', user.id).select('discovery_agent_ids,discovery_location').single();
  if (result.error) return reply({ error: 'Office scope could not be saved. Retry.' }, 503);
  return reply({ agent_ids: result.data.discovery_agent_ids, location: result.data.discovery_location, scoped_count: ids?.length ?? saved.size, roster_count: saved.size });
}
