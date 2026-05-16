"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type AdAccount = Database["public"]["Tables"]["ad_accounts"]["Row"];

function ConnectContent() {
  const searchParams = useSearchParams();
  const highlightPlatform = searchParams.get("platform");

  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("ad_accounts")
        .select("*")
        .eq("user_id", user.id);
      setAccounts((data as AdAccount[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const disconnect = async (accountId: string) => {
    setDisconnecting(accountId);
    const supabase = createClient();
    await supabase.from("ad_accounts").delete().eq("id", accountId);
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    setMessage("Ad account disconnected.");
    setDisconnecting(null);
  };

  const connectedMeta = accounts.some((a) => a.platform === "meta");
  const connectedGoogle = accounts.some((a) => a.platform === "google");

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Topbar */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <Link href="/dashboard" className="text-white/50 hover:text-white text-sm">
            ← Dashboard
          </Link>
          <span className="text-white/20">/</span>
          <span className="text-white text-sm font-medium">Ad Accounts</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Connect Ad Accounts</h1>
          <p className="text-white/50 mt-1 text-sm">
            Link your Meta and Google Ads accounts to pull live performance data
            and enable automatic compliance scanning.
          </p>
        </div>

        {message && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 text-green-300 text-sm">
            {message}
          </div>
        )}

        {/* Meta Ads */}
        <div
          className={`bg-white/5 border rounded-xl p-6 ${
            highlightPlatform === "meta"
              ? "border-blue-500"
              : "border-white/10"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">📘</span>
              <div>
                <h2 className="text-lg font-semibold text-white">Meta Ads</h2>
                <p className="text-white/50 text-sm">
                  Facebook & Instagram advertising
                </p>
              </div>
            </div>
            {connectedMeta ? (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-900/30 text-green-400">
                Connected
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/40">
                Not connected
              </span>
            )}
          </div>

          <div className="mt-5">
            {connectedMeta ? (
              <div className="space-y-3">
                {accounts
                  .filter((a) => a.platform === "meta")
                  .map((acct) => (
                    <div
                      key={acct.id}
                      className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3"
                    >
                      <div>
                        <div className="text-white text-sm font-medium">
                          {acct.account_name ?? acct.account_id ?? "Meta Ad Account"}
                        </div>
                        <div className="text-white/40 text-xs">
                          Connected{" "}
                          {new Date(acct.connected_at).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => disconnect(acct.id)}
                        disabled={disconnecting === acct.id}
                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                      >
                        {disconnecting === acct.id ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-white/50 text-sm">
                  Connect your Meta Business account to pull ad performance data
                  and auto-scan ads for Fair Housing compliance.
                </p>
                <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-4 py-3 text-yellow-300 text-xs">
                  <strong>Required setup:</strong> META_APP_ID and META_APP_SECRET
                  must be configured. See SETUP.md for instructions.
                </div>
                <a
                  href="/api/meta/oauth"
                  className="inline-flex items-center gap-2 bg-[#1877f2] hover:bg-[#1565d8] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
                >
                  📘 Connect Meta Ads via OAuth
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Google Ads */}
        <div
          className={`bg-white/5 border rounded-xl p-6 ${
            highlightPlatform === "google"
              ? "border-red-500"
              : "border-white/10"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🟥</span>
              <div>
                <h2 className="text-lg font-semibold text-white">Google Ads</h2>
                <p className="text-white/50 text-sm">Search & display advertising</p>
              </div>
            </div>
            {connectedGoogle ? (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-900/30 text-green-400">
                Connected
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/40">
                Not connected
              </span>
            )}
          </div>

          <div className="mt-5">
            {connectedGoogle ? (
              <div className="space-y-3">
                {accounts
                  .filter((a) => a.platform === "google")
                  .map((acct) => (
                    <div
                      key={acct.id}
                      className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3"
                    >
                      <div>
                        <div className="text-white text-sm font-medium">
                          {acct.account_name ?? acct.account_id ?? "Google Ad Account"}
                        </div>
                        <div className="text-white/40 text-xs">
                          Connected{" "}
                          {new Date(acct.connected_at).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => disconnect(acct.id)}
                        disabled={disconnecting === acct.id}
                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                      >
                        {disconnecting === acct.id ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-white/50 text-sm">
                  Connect your Google Ads account to monitor campaign
                  performance and ad copy compliance.
                </p>
                <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-4 py-3 text-yellow-300 text-xs">
                  <strong>Required setup:</strong> GOOGLE_CLIENT_ID and
                  GOOGLE_CLIENT_SECRET must be configured. See SETUP.md for
                  instructions.
                </div>
                <a
                  href="/api/google/oauth"
                  className="inline-flex items-center gap-2 bg-white hover:bg-gray-100 text-gray-800 px-5 py-2.5 rounded-lg text-sm font-medium transition"
                >
                  🟥 Connect Google Ads via OAuth
                </a>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="text-center text-white/30 py-4">Loading accounts…</div>
        )}
      </main>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0d1b2a]" />}>
      <ConnectContent />
    </Suspense>
  );
}
