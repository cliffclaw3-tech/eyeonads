import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { RECOVERY_SECONDS, recoveryOrigin } from '@/lib/password-recovery';

const COOKIE_NAME = 'eyeonads-recovery';
export function configuredRecoveryOrigin() {
  return recoveryOrigin(process.env.NEXT_PUBLIC_APP_URL);
}

export async function clearRecoveryCookies() {
  const store = await cookies();
  store.getAll().filter(({ name }) => name === COOKIE_NAME || name.startsWith(`${COOKIE_NAME}.`) || name.startsWith(`${COOKIE_NAME}-`))
    .forEach(({ name }) => store.delete(name));
}

export async function createRecoveryClient(readOnly = false) {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: COOKIE_NAME, httpOnly: true, sameSite: 'lax', secure: configuredRecoveryOrigin().startsWith('https:'), path: '/', maxAge: RECOVERY_SECONDS },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (values) => {
          if (!readOnly) values.forEach(({ name, value, options }) => store.set(name, value, { ...options, maxAge: options.maxAge === 0 ? 0 : RECOVERY_SECONDS }));
        },
      },
    },
  );
}
