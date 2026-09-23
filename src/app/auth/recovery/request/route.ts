import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryClient, configuredRecoveryOrigin, clearRecoveryCookies } from '@/lib/supabase/recovery';
import { requestRecovery } from '@/lib/password-recovery';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const origin = configuredRecoveryOrigin();
    if (request.headers.get('origin') !== origin) return NextResponse.json({ error: 'Invalid request.' }, { status: 403, headers });
    const body = await request.json().catch(() => null);
    if (typeof body?.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400, headers });
    }
    await clearRecoveryCookies();
    const client = await createRecoveryClient();
    const message = await requestRecovery(client.auth, body.email.trim(), origin);
    return NextResponse.json({ message }, { headers });
  } catch {
    return NextResponse.json({ error: 'Password recovery is temporarily unavailable. Please try again later.' }, { status: 503, headers });
  }
}
