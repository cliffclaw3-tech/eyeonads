import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseMlsAccessRequest } from '@/lib/mls-access-request';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return reply({ error: 'Sign in to view your MLS request.' }, 401);
  const saved = user.user_metadata?.eyeonads_mls_request;
  if (!saved) return reply({ request: null });
  try { return reply({ request: parseMlsAccessRequest(saved) }); }
  catch { return reply({ error: 'Saved request details could not be read. Contact support to recover them.' }, 503); }
}
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  try {
    if (!origin || new URL(origin).host !== (req.headers.get('x-forwarded-host') || req.headers.get('host'))) return reply({ error: 'Invalid request origin.' }, 403);
  } catch { return reply({ error: 'Invalid request origin.' }, 403); }
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return reply({ error: 'Sign in to save your MLS request.' }, 401);
  let request;
  try {
    const text = await req.text();
    if (text.length > 3000) return reply({ error: 'Request details are too long.' }, 400);
    request = parseMlsAccessRequest(JSON.parse(text));
  } catch (err) { return reply({ error: err instanceof SyntaxError ? 'Check the request format.' : err instanceof Error ? err.message : 'Check the request details.' }, 400); }
  // User-reported tracking only. Never used as authorization or credential configuration.
  // Auth updates merge this single metadata key; no roster, schedule or access settings change.
  const { data, error: saveError } = await db.auth.updateUser({ data: { eyeonads_mls_request: request } });
  if (saveError || !data.user) return reply({ error: 'Request status could not be saved. Your edits are still here; retry.' }, 503);
  return reply({ request: parseMlsAccessRequest(data.user.user_metadata.eyeonads_mls_request) });
}
