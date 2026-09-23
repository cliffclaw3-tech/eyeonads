import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/discovery-jobs';
export const runtime = 'nodejs';
async function session() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: 'Sign in to view monthly reliability checks.' }, { status: 401 }) };
  if (!user.app_metadata?.eyeonads_pilot) return { response: NextResponse.json({ error: 'Monthly reliability checks are available to invited brokerage pilots.' }, { status: 403 }) };
  return { db, user };
}
export async function GET() {
  const auth = await session(); if (auth.response) return auth.response;
  const { db, user } = auth;
  const [config, runs] = await Promise.all([
    db.from('eyeonads_reliability_configs').select('enabled,next_run_at,public_canary_url,target_verified_at,pilot_recipient_override').eq('owner_id', user.id).maybeSingle(),
    db.from('eyeonads_reliability_runs').select('id,period,status,attempts,error,created_at,completed_at,report').eq('owner_id', user.id).order('period', { ascending: false }).limit(3),
  ]);
  if (config.error || runs.error) return NextResponse.json({ error: 'Monthly reliability status could not be loaded. Try again.' }, { status: 503 });
  const ids = (runs.data || []).map(row => row.id);
  const deliveries = ids.length ? await db.from('eyeonads_reliability_deliveries').select('run_id,status,recipient,attempts,error,accepted_at,delivered_at').eq('owner_id', user.id).in('run_id', ids) : { data: [], error: null };
  if (deliveries.error) return NextResponse.json({ error: 'Report delivery status could not be loaded. Try again.' }, { status: 503 });
  return NextResponse.json({ config: config.data || { enabled: false, next_run_at: null, public_canary_url: null, target_verified_at: null }, runs: runs.data || [], deliveries: deliveries.data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const auth = await session(); if (auth.response) return auth.response;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: 'Choose a monthly reliability action.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Choose a monthly reliability action.' }, { status: 400 });
  const action = body as Record<string, unknown>;
  // Reject hidden target/recipient/owner overrides, not just ignore them.
  if (Object.keys(action).some(key => !['action', 'enabled'].includes(key)) || !['schedule', 'run'].includes(String(action.action)) || action.action === 'schedule' && typeof action.enabled !== 'boolean') return NextResponse.json({ error: 'Invalid monthly reliability action.' }, { status: 400 });
  const result = action.action === 'schedule' ? await auth.db.rpc('eyeonads_set_reliability_schedule', { p_enabled: action.enabled }) : await auth.db.rpc('eyeonads_start_reliability');
  if (result.error) return NextResponse.json({ error: 'Save your brokerage roster first, then retry. If it is already saved, monthly checks may be temporarily unavailable.' }, { status: 503 });
  return NextResponse.json({ state: result.data?.[0] || null, message: action.action === 'schedule' ? action.enabled ? 'Monthly checks enabled. The next check is scheduled separately from daily monitoring.' : 'Monthly checks disabled.' : 'This month’s check is queued or already saved. Repeating this action does not create another check or email.' }, { headers: { 'Cache-Control': 'no-store' } });
}
