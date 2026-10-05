import type { User } from '@supabase/supabase-js';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

/** Role is stored at signup in a table users cannot edit. Pilot metadata keeps existing invited owners working. */
export async function isBroker(db: Db, user: User): Promise<boolean> {
  if (user.app_metadata?.eyeonads_pilot === true) return true;
  const { data, error } = await db.from('eyeonads_account_roles').select('role').eq('user_id', user.id).maybeSingle();
  return !error && data?.role === 'broker';
}
