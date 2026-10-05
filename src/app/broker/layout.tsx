import { BrokerGuide } from "@/components/BrokerGuide";
import { createClient } from "@/lib/supabase/server";
import { isBroker } from "@/lib/broker-access";

export default async function BrokerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <>{user && await isBroker(supabase, user) && <BrokerGuide userId={user.id} />}{children}</>;
}
