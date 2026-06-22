import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type AdAccount = Database["public"]["Tables"]["ad_accounts"]["Row"];
type ComplianceScan = Database["public"]["Tables"]["compliance_scans"]["Row"];
type AdPerformance = Database["public"]["Tables"]["ad_performance"]["Row"];

function ComplianceBadge({ result }: { result: "green" | "yellow" | "red" }) {
  const config = {
    green: { bg: "bg-green-900/30", border: "border-green-600", text: "text-green-400", label: "GREEN — Compliant" },
    yellow: { bg: "bg-yellow-900/30", border: "border-yellow-600", text: "text-yellow-400", label: "YELLOW — Review Needed" },
    red: { bg: "bg-red-900/30", border: "border-red-600", text: "text-red-400", label: "RED — Violation Found" },
  };
  const c = config[result];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${c.bg} ${c.border} ${c.text}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: adAccounts } = await supabase
    .from("ad_accounts")
    .select("*")
    .eq("user_id", user.id);

  const { data: recentScans } = await supabase
    .from("compliance_scans")
    .select("*")
    .eq("user_id", user.id)
    .order("scanned_at", { ascending: false })
    .limit(1);

  const latestScan: ComplianceScan | null = recentScans?.[0] ?? null;

  // Pull performance data for connected accounts
  const accountIds = (adAccounts as AdAccount[] | null)?.map((a) => a.id) ?? [];
  let performance: AdPerformance[] = [];
  if (accountIds.length > 0) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: perfData } = await supabase
      .from("ad_performance")
      .select("*")
      .in("ad_account_id", accountIds)
      .gte("date", sevenDaysAgo.toISOString().split("T")[0]);
    performance = (perfData as AdPerformance[]) ?? [];
  }

  const totalSpend = performance.reduce((sum, p) => sum + p.spend, 0);
  const totalImpressions = performance.reduce((sum, p) => sum + p.impressions, 0);
  const totalClicks = performance.reduce((sum, p) => sum + p.clicks, 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const displayName = profile?.full_name ?? user.email ?? "Agent";

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Topbar */}
      <header className="border-b border-white/10 bg-[#0d1b2a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white">
            <span className="text-xl" aria-hidden="true">👁</span>
            <span className="leading-tight">
              <span className="block text-xl font-bold">EyeOnAds</span>
              <span className="block text-[11px] font-normal text-white/50">a Shields Enterprises solution</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <a
              href="mailto:feedback@shieldsenterprises.example?subject=EyeOnAds%20beta%20feedback"
              title="Share feedback or suggest a feature"
              className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/60 hover:text-white"
            >
              Beta
            </a>
            <span className="text-white/50 text-sm">{displayName}</span>
            <form action="/auth/signout" method="post">
              <button className="text-white/40 hover:text-white text-sm transition">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="border-b border-white/10 bg-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6">
            {[
              { href: "/dashboard", label: "Overview" },
              { href: "/dashboard/compliance", label: "Compliance" },
              { href: "/dashboard/connect", label: "Ad Accounts" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="py-3 text-sm font-medium text-white/70 hover:text-white border-b-2 border-transparent hover:border-blue-500 transition"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white">
            Welcome back, {displayName.split(" ")[0]}
          </h1>
          <p className="text-white/50 mt-1 text-sm">
            State: {profile?.state ?? "—"} &nbsp;·&nbsp; Plan:{" "}
            {profile?.subscription_tier ?? "free"}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Spend (7d)", value: `$${totalSpend.toFixed(2)}` },
            { label: "Impressions (7d)", value: totalImpressions.toLocaleString() },
            { label: "Clicks (7d)", value: totalClicks.toLocaleString() },
            { label: "CTR (7d)", value: `${avgCTR.toFixed(2)}%` },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white/5 border border-white/10 rounded-xl p-5"
            >
              <div className="text-white/50 text-xs uppercase tracking-wide mb-1">
                {stat.label}
              </div>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Connected Ad Accounts */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Connected Ad Accounts
            </h2>
            <Link
              href="/dashboard/connect"
              className="text-blue-400 text-sm hover:underline"
            >
              Manage →
            </Link>
          </div>
          {(adAccounts as AdAccount[] | null)?.length ? (
            <div className="space-y-3">
              {(adAccounts as AdAccount[]).map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {account.platform === "meta" ? "📘" : "🟥"}
                    </span>
                    <div>
                      <div className="text-white font-medium text-sm capitalize">
                        {account.platform === "meta" ? "Meta Ads" : "Google Ads"}
                      </div>
                      <div className="text-white/40 text-xs">
                        {account.account_name ?? account.account_id ?? "Connected"}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      account.needs_reconnect
                        ? "bg-red-900/30 text-red-400"
                        : "bg-green-900/30 text-green-400"
                    }`}
                  >
                    {account.needs_reconnect ? "Needs Reconnect" : "Active"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/40 text-sm">
              No ad accounts connected yet.{" "}
              <Link href="/dashboard/connect" className="text-blue-400 hover:underline">
                Connect now →
              </Link>
            </p>
          )}
        </div>

        {/* Compliance Status */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Last Compliance Scan
            </h2>
            <Link
              href="/dashboard/compliance"
              className="text-blue-400 text-sm hover:underline"
            >
              View all →
            </Link>
          </div>
          {latestScan ? (
            <div className="space-y-3">
              <ComplianceBadge result={latestScan.result} />
              <p className="text-white/60 text-sm line-clamp-2">
                {latestScan.ai_explanation ?? "No explanation available."}
              </p>
              <p className="text-white/30 text-xs">
                Scanned{" "}
                {new Date(latestScan.scanned_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ) : (
            <p className="text-white/40 text-sm">
              No scans yet.{" "}
              <Link
                href="/dashboard/compliance"
                className="text-blue-400 hover:underline"
              >
                Run your first scan →
              </Link>
            </p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Quick Actions
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/compliance"
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              🛡️ Run Compliance Scan
            </Link>
            <Link
              href="/dashboard/connect?platform=meta"
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              📘 Connect Meta Ads
            </Link>
            <Link
              href="/dashboard/connect?platform=google"
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              🟥 Connect Google Ads
            </Link>
          </div>
        </div>

        {/* Weekly Report Preview */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">
            Weekly Report
          </h2>
          <p className="text-white/50 text-sm mb-4">
            Every Monday you receive a summary of your ad performance and
            compliance status.
          </p>
          <div className="bg-white/5 rounded-lg p-4 border border-white/10 text-center">
            <p className="text-white/30 text-sm">
              No reports generated yet. Your first report will arrive next
              Monday.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
