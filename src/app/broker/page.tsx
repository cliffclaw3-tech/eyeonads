import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type UserProfile = Database["public"]["Tables"]["user_profiles"]["Row"];
type ComplianceScan = Database["public"]["Tables"]["compliance_scans"]["Row"];

function ComplianceBadge({ result }: { result: "green" | "yellow" | "red" }) {
  const config = {
    green: { bg: "bg-green-900/30", border: "border-green-700", text: "text-green-400", label: "GREEN" },
    yellow: { bg: "bg-yellow-900/30", border: "border-yellow-700", text: "text-yellow-400", label: "YELLOW" },
    red: { bg: "bg-red-900/30", border: "border-red-700", text: "text-red-400", label: "RED" },
  };
  const c = config[result];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold ${c.bg} ${c.border} ${c.text}`}>
      {c.label}
    </span>
  );
}

export default async function BrokerPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "broker") redirect("/dashboard");

  // Get agents in this brokerage
  const { data: agents } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("brokerage_id", profile.brokerage_id ?? "")
    .eq("role", "agent");

  const agentList = (agents as UserProfile[]) ?? [];

  // Get latest compliance scan per agent
  const agentIds = agentList.map((a) => a.id);
  let latestScansByAgent: Record<string, ComplianceScan> = {};

  if (agentIds.length > 0) {
    const { data: scans } = await supabase
      .from("compliance_scans")
      .select("*")
      .in("user_id", agentIds)
      .order("scanned_at", { ascending: false });

    const allScans = (scans as ComplianceScan[]) ?? [];
    // Keep only the latest scan per agent
    for (const scan of allScans) {
      if (!latestScansByAgent[scan.user_id]) {
        latestScansByAgent[scan.user_id] = scan;
      }
    }
  }

  // Get brokerage info
  const { data: brokerage } = profile.brokerage_id
    ? await supabase
        .from("brokerages")
        .select("*")
        .eq("id", profile.brokerage_id)
        .single()
    : { data: null };

  const greenCount = agentList.filter(
    (a) => latestScansByAgent[a.id]?.result === "green"
  ).length;
  const complianceRate =
    agentList.length > 0
      ? Math.round((greenCount / agentList.length) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Topbar */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-white">
            👁 EyeOnAds
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-white/50 text-sm">
              {profile?.full_name ?? user.email} — Broker
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white">Broker Dashboard</h1>
          <p className="text-white/50 mt-1 text-sm">
            Brokerage: {brokerage?.name ?? "Not configured"} &nbsp;·&nbsp;
            Invite Code:{" "}
            <span className="font-mono text-blue-400">
              {brokerage?.invite_code ?? "—"}
            </span>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="text-white/50 text-xs uppercase tracking-wide mb-1">
              Total Agents
            </div>
            <div className="text-3xl font-bold text-white">{agentList.length}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="text-white/50 text-xs uppercase tracking-wide mb-1">
              Compliance Rate
            </div>
            <div
              className={`text-3xl font-bold ${
                complianceRate >= 80
                  ? "text-green-400"
                  : complianceRate >= 50
                  ? "text-yellow-400"
                  : "text-red-400"
              }`}
            >
              {complianceRate}%
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="text-white/50 text-xs uppercase tracking-wide mb-1">
              Agents Green
            </div>
            <div className="text-3xl font-bold text-green-400">{greenCount}</div>
          </div>
        </div>

        {/* Invite agents */}
        <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">
            Invite Agents
          </h2>
          <p className="text-white/60 text-sm mb-3">
            Share your brokerage invite code with your agents so they can join
            your brokerage on EyeOnAds.
          </p>
          <div className="flex items-center gap-3">
            <code className="bg-white/10 px-4 py-2 rounded-lg text-blue-300 font-mono text-lg tracking-widest">
              {brokerage?.invite_code ?? "—"}
            </code>
            <span className="text-white/40 text-sm">
              Agents enter this code when signing up
            </span>
          </div>
        </div>

        {/* Agent List */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Agents ({agentList.length})
          </h2>
          {agentList.length === 0 ? (
            <p className="text-white/40 text-sm">
              No agents in your brokerage yet. Share your invite code above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                    <th className="pb-2 text-left">Agent</th>
                    <th className="pb-2 text-left">State</th>
                    <th className="pb-2 text-left">Last Scan Result</th>
                    <th className="pb-2 text-left">Last Scanned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {agentList.map((agent) => {
                    const scan = latestScansByAgent[agent.id];
                    return (
                      <tr key={agent.id}>
                        <td className="py-3">
                          <div className="text-white font-medium">
                            {agent.full_name ?? agent.email}
                          </div>
                          <div className="text-white/40 text-xs">{agent.email}</div>
                        </td>
                        <td className="py-3 text-white/50">{agent.state}</td>
                        <td className="py-3">
                          {scan ? (
                            <ComplianceBadge result={scan.result} />
                          ) : (
                            <span className="text-white/30 text-xs">No scans</span>
                          )}
                        </td>
                        <td className="py-3 text-white/40 text-xs">
                          {scan
                            ? new Date(scan.scanned_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Email Alert Settings */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">
            Email Alert Settings
          </h2>
          <p className="text-white/50 text-sm mb-4">
            Configure when EyeOnAds sends you email notifications.
          </p>
          <div className="space-y-3">
            {[
              { label: "Notify me when an agent gets a RED compliance flag", defaultOn: true },
              { label: "Weekly brokerage compliance report every Monday", defaultOn: true },
              { label: "Alert when an ad account needs reconnection", defaultOn: true },
            ].map((setting) => (
              <label
                key={setting.label}
                className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3 cursor-pointer group"
              >
                <span className="text-white/70 text-sm group-hover:text-white transition">
                  {setting.label}
                </span>
                <input
                  type="checkbox"
                  defaultChecked={setting.defaultOn}
                  className="w-4 h-4 accent-blue-500"
                />
              </label>
            ))}
          </div>
          <div className="mt-4">
            <button className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium transition">
              Save Preferences
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
