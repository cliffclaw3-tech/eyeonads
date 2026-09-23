import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/discovery-runner';
import { runOfficeSocial } from '@/lib/office-social-runner';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const secret = process.env.EYEONADS_WORKER_SECRET;
  const provided = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret || ''}`;
  if (!secret || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EYEONADS_PAID_ANALYSIS_ENABLED !== '1' || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'Background search is not configured.' }, { status: 503 });
  }
  // This client must never use request cookies: the worker acts only on atomically claimed items.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const due = await db.rpc('eyeonads_enqueue_due_reports');
  if (due.error) return NextResponse.json({ error: 'Scheduled checks could not be prepared.' }, { status: 503 });
  const { data, error } = await db.rpc('eyeonads_claim_discovery_job_item');
  if (error) return NextResponse.json({ error: 'Queue unavailable.' }, { status: 503 });
  const item = data?.[0];
  if (!item) return NextResponse.json({ idle: true });
  let success = false;
  try {
    // Recover an interrupted worker after the review saved, without buying another search.
    const prior = await db.from('eyeonads_discovery_reviews').select('status,searched_at')
      .eq('owner_id', item.owner_id).eq('agent_id', item.agent_id).maybeSingle();
    if (prior.error) throw prior.error;
    await Promise.all([
      prior.data?.status !== 'complete' || !prior.data.searched_at || new Date(prior.data.searched_at) < new Date(item.created_at) ? runDiscovery(db, item.owner_id, item.setup, item.agent) : Promise.resolve(),
      // Once per report batch, separately from roster counts; failures remain visible in the social report.
      runOfficeSocial(db, item.owner_id, item.setup, item.created_at).catch(()=>null),
    ]);
    success = true;
  } catch { /* Store a safe message in the finish RPC, never provider errors or secrets. */ }
  const finished = await db.rpc('eyeonads_finish_discovery_job_item', {
    p_item: item.id, p_token: item.lease_token, p_success: success,
  });
  if (finished.error) return NextResponse.json({ error: 'Progress could not be saved; the lease will retry.' }, { status: 503 });
  return NextResponse.json({ processed: finished.data === true, completed: success });
}
