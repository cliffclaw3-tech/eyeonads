import RecoveryForm from '@/components/recovery-form';
import { createRecoveryClient } from '@/lib/supabase/recovery';
import { hasRecoverySession } from '@/lib/password-recovery';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  let valid = false;
  if (!(await searchParams).invalid) {
    try { valid = await hasRecoverySession((await createRecoveryClient(true)).auth); } catch { /* Fail closed. */ }
  }
  return <RecoveryForm mode={valid ? 'reset' : 'invalid'} />;
}
