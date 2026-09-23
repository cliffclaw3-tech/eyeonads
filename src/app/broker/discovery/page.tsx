import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DiscoveryDashboard } from "@/components/DiscoveryDashboard";

export default async function DiscoveryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <DiscoveryDashboard />;
}
