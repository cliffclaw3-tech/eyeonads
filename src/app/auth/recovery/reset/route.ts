import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryClient, configuredRecoveryOrigin, clearRecoveryCookies } from '@/lib/supabase/recovery';
import { completeRecovery } from '@/lib/password-recovery';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (request.headers.get('origin') !== configuredRecoveryOrigin()) return NextResponse.json({ error: 'Invalid request.' }, { status: 403, headers });
    const body = await request.json().catch(() => null);
    const client = await createRecoveryClient();
    const result = await completeRecovery(client.auth, body?.password, body?.confirmation);
    if (result.status === 200 || result.status === 401) await clearRecoveryCookies();
    return NextResponse.json(result.status === 200 ? { ok: true } : { error: result.error }, { status: result.status, headers });
  } catch {
    return NextResponse.json({ error: 'Password recovery is temporarily unavailable. Please try again later.' }, { status: 503, headers });
  }
}
