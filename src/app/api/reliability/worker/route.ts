import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { runReliabilityWorker } from '@/lib/reliability-canary/runner';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  const secret = process.env.EYEONADS_WORKER_SECRET;
  const provided = request.headers.get('authorization') || '', expected = `Bearer ${secret || ''}`;
  if (!secret || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: 'Monthly reliability worker is not configured.' }, { status: 503 });
  // Never attach browser cookies to this service-owned queue client.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try { return NextResponse.json(await runReliabilityWorker(db), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Monthly reliability processing could not be confirmed. Saved leases and receipts prevent an automatic duplicate send.' }, { status: 503 }); }
}
