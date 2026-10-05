import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DiscoveryDashboard } from "@/components/DiscoveryDashboard";
import { isBroker } from "@/lib/broker-access";

export default async function DiscoveryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!await isBroker(supabase, user)) redirect('/dashboard/compliance');
  return <DiscoveryDashboard />;
}
