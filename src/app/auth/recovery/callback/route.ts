import { NextRequest, NextResponse } from 'next/server';
import { createRecoveryClient, clearRecoveryCookies } from '@/lib/supabase/recovery';
import { exchangeRecovery } from '@/lib/password-recovery';

export async function GET(request: NextRequest) {
  let valid = false;
  try {
    const params = request.nextUrl.searchParams;
    if (!params.has('error') && !params.has('error_code') && params.getAll('code').length === 1) {
      const client = await createRecoveryClient();
      valid = await exchangeRecovery(client.auth, params.get('code'));
    }
  } catch { /* Fail closed without exposing provider errors or the callback URL. */ }
  if (!valid) await clearRecoveryCookies();
  // Relative Location avoids trusting Host or forwarding headers, and strips the code.
  return new NextResponse(null, { status: 303, headers: {
    Location: valid ? '/reset-password' : '/reset-password?invalid=1',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
}
