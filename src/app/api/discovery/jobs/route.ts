import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { discoveryJobProgress, sameOrigin } from '@/lib/discovery-jobs';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function handle(request: Request, action: 'read' | 'start' | 'control') {
  if (action !== 'read' && !sameOrigin(request)) return reply({ error: 'Invalid request origin.' }, 403);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: 'Sign in to manage public searches.' }, 401);
  if (!user.app_metadata?.eyeonads_pilot) return reply({ error: 'Public discovery is enabled for invited brokerage pilots only.' }, 403);
  try {
    if (action === 'start') {
      if (process.env.EYEONADS_PAID_ANALYSIS_ENABLED !== '1' || !process.env.OPENAI_API_KEY || !process.env.EYEONADS_WORKER_SECRET) {
        return reply({ error: 'Background public search is not configured.' }, 503);
      }
      const { data: setup, error } = await db.from('eyeonads_brokerage_setups').select('agents').eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (!setup?.agents?.length) return reply({ error: 'Save agents in brokerage setup first.' }, 400);
      const body = await request.json().catch(() => null);
      const started = await db.rpc(body?.fresh === true ? 'eyeonads_start_fresh_report' : 'eyeonads_start_discovery_job');
      if (started.error?.message?.includes('already in progress')) return reply({ error: 'A batch is already in progress. Open search progress to resume or finish it before starting a fresh report.' }, 409);
      if (started.error) throw started.error;
    }
    if (action === 'control') {
      const body = await request.json().catch(() => null);
      if (!['pause', 'resume'].includes(body?.action)) return reply({ error: 'Choose pause or resume.' }, 400);
      const result = await db.rpc('eyeonads_control_discovery_job', { p_action: body.action });
      if (result.error) throw result.error;
    }
    return reply({ job: await discoveryJobProgress(db, user.id) });
  } catch {
    return reply({ error: 'Background search progress could not be loaded or updated. Please retry.' }, 503);
  }
}
export async function GET(request: Request) { return handle(request, 'read'); }
export async function POST(request: Request) { return handle(request, 'start'); }
export async function PATCH(request: Request) { return handle(request, 'control'); }
