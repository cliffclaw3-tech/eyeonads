import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function discoveryJobProgress(db: SupabaseClient, ownerId: string) {
  const { data: job, error } = await db.from('eyeonads_discovery_jobs')
    .select('id,status,error').eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  if (!job) return null;
  const { data: items, error: itemError } = await db.from('eyeonads_discovery_job_items')
    .select('status').eq('job_id', job.id).eq('owner_id', ownerId);
  if (itemError) throw itemError;
  const completed = items!.filter(item => item.status === 'complete').length;
  const failed = items!.filter(item => item.status === 'failed').length;
  return { ...job, total: items!.length, completed, failed, pending: items!.length - completed - failed };
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get('x-forwarded-host') || request.headers.get('host'));
  } catch { return false; }
}
