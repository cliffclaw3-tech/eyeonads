import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BrokerSetup } from "@/components/BrokerSetup";

export default async function BrokerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <BrokerSetup />;
}
