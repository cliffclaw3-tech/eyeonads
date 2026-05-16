"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Database, ComplianceFlag } from "@/lib/supabase/types";

type ComplianceScan = Database["public"]["Tables"]["compliance_scans"]["Row"];

type ScanResult = {
  result: "green" | "yellow" | "red";
  flags: ComplianceFlag[];
  summary: string;
};

function ComplianceBadge({ result }: { result: "green" | "yellow" | "red" }) {
  const config = {
    green: {
      bg: "bg-green-900/30",
      border: "border-green-600",
      text: "text-green-400",
      label: "GREEN — Compliant",
      emoji: "✅",
    },
    yellow: {
      bg: "bg-yellow-900/30",
      border: "border-yellow-600",
      text: "text-yellow-400",
      label: "YELLOW — Review Needed",
      emoji: "⚠️",
    },
    red: {
      bg: "bg-red-900/30",
      border: "border-red-600",
      text: "text-red-400",
      label: "RED — Violation Found",
      emoji: "🚨",
    },
  };
  const c = config[result];
  return (
    <span
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-bold ${c.bg} ${c.border} ${c.text}`}
    >
      {c.emoji} {c.label}
    </span>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "green" | "yellow" | "red";
}) {
  const map = {
    green: "bg-green-900/30 text-green-400",
    yellow: "bg-yellow-900/30 text-yellow-400",
    red: "bg-red-900/30 text-red-400",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${map[severity]}`}
    >
      {severity}
    </span>
  );
}

export default function CompliancePage() {
  const [adCopy, setAdCopy] = useState("");
  const [state, setState] = useState<string>("TN");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ComplianceScan[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's state from profile
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("state")
        .eq("id", user.id)
        .single();
      if (profile?.state) setState(profile.state);

      // Load scan history
      const { data: scans } = await supabase
        .from("compliance_scans")
        .select("*")
        .eq("user_id", user.id)
        .order("scanned_at", { ascending: false })
        .limit(10);
      setHistory((scans as ComplianceScan[]) ?? []);
      setHistoryLoading(false);
    }
    load();
  }, []);

  const handleScan = async () => {
    if (!adCopy.trim()) return;
    setScanning(true);
    setError(null);
    setScanResult(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_copy: adCopy,
          state,
          user_id: user?.id ?? "",
        }),
      });

      const data = (await response.json()) as {
        result?: ScanResult;
        error?: string;
      };
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? "Scan failed");
      }

      setScanResult(data.result ?? null);

      // Refresh history
      if (user) {
        const { data: scans } = await supabase
          .from("compliance_scans")
          .select("*")
          .eq("user_id", user.id)
          .order("scanned_at", { ascending: false })
          .limit(10);
        setHistory((scans as ComplianceScan[]) ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Topbar */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-white/50 hover:text-white text-sm"
          >
            ← Dashboard
          </Link>
          <span className="text-white/20">/</span>
          <span className="text-white text-sm font-medium">
            Compliance Scanner
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Compliance Scanner</h1>
          <p className="text-white/50 mt-1 text-sm">
            Paste your ad copy below. AI will check it against Tennessee RE
            Commission rules and Fair Housing law.
          </p>
        </div>

        {/* Scanner form */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-white/70 text-sm font-medium shrink-0">
              State:
            </label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="TN">Tennessee (TN)</option>
              <option value="VA">Virginia (VA)</option>
              <option value="NC">North Carolina (NC)</option>
            </select>
          </div>

          <div>
            <label className="block text-white/70 text-sm font-medium mb-2">
              Ad Copy
            </label>
            <textarea
              value={adCopy}
              onChange={(e) => setAdCopy(e.target.value)}
              rows={6}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Paste your ad copy here… e.g. 'Beautiful 3BR/2BA home in Brentwood. Call Jane Smith for a showing! Best agent in Nashville!'"
            />
          </div>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={handleScan}
              disabled={scanning || !adCopy.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold transition"
            >
              {scanning ? "Scanning…" : "🛡️ Scan Now"}
            </button>
            <p className="text-white/30 text-xs max-w-xs text-right">
              EyeOnAds is not a law firm. Results are not legal advice.
            </p>
          </div>
        </div>

        {/* Scan Result */}
        {scanResult && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Scan Result
              </h2>
              <ComplianceBadge result={scanResult.result} />
            </div>

            <p className="text-white/70 text-sm">{scanResult.summary}</p>

            {scanResult.flags.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-white/50 text-xs uppercase tracking-widest">
                  Flags ({scanResult.flags.length})
                </h3>
                {scanResult.flags.map((flag, i) => (
                  <div
                    key={i}
                    className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={flag.severity} />
                      <span className="text-white text-sm font-medium">
                        {flag.rule}
                      </span>
                    </div>
                    <p className="text-white/60 text-sm">{flag.explanation}</p>
                    <p className="text-blue-300 text-xs">
                      💡 {flag.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {scanResult.flags.length === 0 && (
              <div className="bg-green-900/20 border border-green-800/40 rounded-lg px-4 py-3 text-green-300 text-sm">
                No compliance flags found. Your ad looks good!
              </div>
            )}
          </div>
        )}

        {/* History */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Scan History (Last 10)
          </h2>
          {historyLoading ? (
            <p className="text-white/30 text-sm">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-white/40 text-sm">No scans yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                    <th className="pb-2 text-left">Date</th>
                    <th className="pb-2 text-left">State</th>
                    <th className="pb-2 text-left">Result</th>
                    <th className="pb-2 text-left">Flags</th>
                    <th className="pb-2 text-left">Ad Copy Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {history.map((scan) => (
                    <tr key={scan.id} className="py-3">
                      <td className="py-3 text-white/50">
                        {new Date(scan.scanned_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 text-white/50">{scan.state}</td>
                      <td className="py-3">
                        <ComplianceBadge result={scan.result} />
                      </td>
                      <td className="py-3 text-white/50">
                        {(scan.flags as ComplianceFlag[]).length}
                      </td>
                      <td className="py-3 text-white/50 max-w-xs truncate">
                        {scan.ad_copy.slice(0, 60)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-white/20 text-xs text-center">
          EyeOnAds is not a law firm. Compliance scan results are not legal
          advice. Always consult a qualified real estate attorney for legal
          guidance.
        </p>
      </main>
    </div>
  );
}
