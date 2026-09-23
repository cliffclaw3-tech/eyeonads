import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type ComplianceScan = Database["public"]["Tables"]["compliance_scans"]["Row"];

function ComplianceBadge({ result }: { result: "green" | "yellow" | "red" }) {
  const config = {
    green: { bg: "bg-green-900/30", border: "border-green-600", text: "text-green-400", label: "GREEN — No issues detected" },
    yellow: { bg: "bg-yellow-900/30", border: "border-yellow-600", text: "text-yellow-400", label: "YELLOW — Review Needed" },
    red: { bg: "bg-red-900/30", border: "border-red-600", text: "text-red-400", label: "RED — Potential issue" },
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

  const { data: recentScans } = await supabase
    .from("compliance_scans")
    .select("*")
    .eq("user_id", user.id)
    .order("scanned_at", { ascending: false })
    .limit(5);

  const latestScan: ComplianceScan | null = recentScans?.[0] ?? null;

  const displayName = profile?.full_name ?? user.email ?? "Agent";

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Topbar */}
      <header className="border-b border-white/10 bg-[#0d1b2a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap gap-3 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white">
            <span className="text-xl" aria-hidden="true">👁</span>
            <span className="leading-tight">
              <span className="block text-xl font-bold">EyeOnAds</span>
              <span className="block text-[11px] font-normal text-white/50">a Shields Enterprises solution</span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/support"
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
          <div className="flex flex-wrap gap-6">
            {[
              { href: "/dashboard", label: "Overview" },
              { href: "/dashboard/compliance", label: "Compliance" },
              { href: "/dashboard/connect", label: "Ad Accounts" },
              { href: "/broker", label: "Brokerage setup" },
              { href: "/broker/report", label: "Broker report" },
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

        {/* Beta boundary */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Your broker report
            </h2>
            <Link
              href="/broker/report"
              className="text-blue-400 text-sm hover:underline"
            >
              Open report →
            </Link>
          </div>
          <p className="text-white/70 text-sm">Review possible issues found in public marketing, see which agents and ads were checked, and identify coverage gaps. Run a report on demand or choose daily or weekly checks.</p>
          <Link href="/broker/report" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500">Open broker report</Link>
        </div>

        {/* Compliance Status */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
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
              {recentScans && recentScans.length > 1 && (
                <p className="text-white/40 text-xs">{recentScans.length - 1} additional saved scan{recentScans.length === 2 ? "" : "s"} shown in compliance history.</p>
              )}
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
              href="/dashboard/connect"
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              📘 Ad connections unavailable
            </Link>
            <Link
              href="/dashboard/compliance"
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              🟥 Use pasted ad copy
            </Link>
          </div>
        </div>

        {/* Beta support boundary */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">
            Beta support
          </h2>
          <p className="text-white/50 text-sm mb-4">
            Public-web report schedules are managed in your broker report. Email alerts and direct Meta/Google account connections are not enabled.
          </p>
          <div className="bg-white/5 rounded-lg p-4 border border-white/10 text-center">
            <p className="text-white/30 text-sm">
              Use saved compliance history to review results, and password recovery for account access.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
