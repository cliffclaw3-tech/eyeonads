import type { SupabaseClient } from '@supabase/supabase-js';

export const RECOVERY_MESSAGE = 'If an account can receive a reset email, a link will arrive shortly. Check your spam folder and open the latest link in this browser.';
export const INVALID_RECOVERY = 'This reset link is invalid or has expired. Request a new link and open it in the same browser.';
export const RECOVERY_SECONDS = 15 * 60;

export function passwordError(password: unknown, confirmation: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim()) {
    return 'Use a password between 8 and 128 characters.';
  }
  return password !== confirmation ? 'Passwords must match.' : null;
}

export function recoveryOrigin(value: string | undefined): string {
  if (!value) throw new Error('Recovery origin is not configured');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Invalid recovery origin');
  }
  return url.origin;
}

export function freshRecoveryClaims(claims: Record<string, unknown>, now = Date.now() / 1000): boolean {
  return typeof claims.exp === 'number' && claims.exp > now && Array.isArray(claims.amr) &&
    claims.amr.some((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return false;
      const { method, timestamp } = entry as Record<string, unknown>;
      return method === 'recovery' && typeof timestamp === 'number' && timestamp <= now && now - timestamp < RECOVERY_SECONDS;
    });
}

// Claims are signature-verified by the SDK; getUser also checks with the provider.
// Never authorize from getSession or from a client-supplied recovery flag.
export async function hasRecoverySession(auth: SupabaseClient['auth']): Promise<boolean> {
  try {
    const { data, error } = await auth.getClaims();
    if (error || !data || !freshRecoveryClaims(data.claims)) return false;
    const user = await auth.getUser();
    return !user.error && !!user.data.user && user.data.user.id === data.claims.sub;
  } catch { return false; }
}

export async function requestRecovery(auth: SupabaseClient['auth'], email: string, origin: string) {
  try {
    await auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/recovery/callback` });
  } catch { /* Provider errors must not disclose account existence or request data. */ }
  return RECOVERY_MESSAGE;
}

export async function exchangeRecovery(auth: SupabaseClient['auth'], code: string | null): Promise<boolean> {
  if (!code || !/^[a-zA-Z0-9_-]{16,512}$/.test(code)) return false;
  try {
    const { data, error } = await auth.exchangeCodeForSession(code);
    return !error && !!data.session && await hasRecoverySession(auth);
  } catch { return false; }
}

export async function completeRecovery(auth: SupabaseClient['auth'], password: unknown, confirmation: unknown) {
  const validation = passwordError(password, confirmation);
  if (validation) return { error: validation, status: 400 };
  if (!await hasRecoverySession(auth)) return { error: INVALID_RECOVERY, status: 401 };
  try {
    const { error } = await auth.updateUser({ password: password as string });
    if (error) return { error: 'Unable to update your password. Use a different password or request a new link.', status: 400 };
  } catch { return { error: 'Unable to update your password. Please try again.', status: 503 }; }
  // Only the isolated recovery session is signed out; ordinary auth cookies are untouched.
  try { await auth.signOut({ scope: 'local' }); } catch { /* Cookies are cleared by the route regardless. */ }
  return { status: 200 };
}
