"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceInput } from "@/components/VoiceInput";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Database, ComplianceFlag } from "@/lib/supabase/types";

type ComplianceScan = Database["public"]["Tables"]["compliance_scans"]["Row"];

type ScanResult = {
  result: "green" | "yellow" | "red";
  flags: ComplianceFlag[];
  summary: string;
  persisted?: boolean;
  scan_id?: string;
  analysis_source?: string;
};

function ComplianceBadge({ result }: { result: "green" | "yellow" | "red" }) {
  const config = {
    green: {
      bg: "bg-green-900/30",
      border: "border-green-600",
      text: "text-green-400",
      label: "GREEN — No issues detected",
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
      label: "RED — Potential issue",
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
  const [scannedInput, setScannedInput] = useState<{ adCopy: string; state: string } | null>(null);
  const inputVersion = useRef(0);
  const imageReadVersion = useRef(0);
  const [imageLoading, setImageLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ComplianceScan[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fix My Ad state
  const [fixing, setFixing] = useState(false);
  const [fixedCopy, setFixedCopy] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) { window.location.assign("/login"); return; }

      // Get user's state from profile
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("state")
        .eq("id", user.id)
        .single();
      if (profile?.state) setState(profile.state);

      // Load scan history
      const { data: scans, error: historyError } = await supabase
        .from("compliance_scans")
        .select("*")
        .eq("user_id", user.id)
        .order("scanned_at", { ascending: false })
        .limit(10);
      if (historyError) setError("Saved history could not be loaded. Refresh to retry.");
      setHistory((scans as ComplianceScan[]) ?? []);
      setHistoryLoading(false);
    }
    load();
  }, []);

  function invalidateResult() {
    inputVersion.current += 1;
    setScanResult(null);
    setScannedInput(null);
    setFixedCopy(null);
    setFixError(null);
    setCopied(false);
  }

  function handleImageFile(file: File) {
    if (scanning || fixing) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setError("Choose a JPG or PNG image.");
      return;
    }
    if (4 * Math.ceil(file.size / 3) + `data:${file.type};base64,`.length > 2_000_000) {
      setError("This image is too large. Choose a JPG or PNG smaller than 1.5 MB.");
      return;
    }
    invalidateResult();
    setError(null);
    setImageLoading(true);
    const readVersion = ++imageReadVersion.current;

    const reader = new FileReader();
    reader.onload = (e) => {
      if (readVersion !== imageReadVersion.current) return;
      const result = e.target?.result as string;
      setImageLoading(false);
      setImageFile(file);
      setImagePreview(result);
      setImageBase64(result);
    };
    reader.onerror = () => {
      if (readVersion !== imageReadVersion.current) return;
      setImageLoading(false);
      setError("The image could not be read. Choose it again or try another JPG or PNG.");
    };
    reader.readAsDataURL(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImageFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function clearImage() {
    if (scanning || fixing) return;
    invalidateResult();
    imageReadVersion.current += 1;
    setImageLoading(false);
    setImageFile(null);
    setImagePreview(null);
    setImageBase64(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openSavedScan(scan: ComplianceScan) {
    if (scanning || fixing) return;
    clearImage();
    setAdCopy(scan.ad_copy); setState(scan.state);
    setScannedInput({adCopy: scan.ad_copy, state: scan.state});
    setScanResult({result: scan.result, flags: scan.flags, summary: scan.ai_explanation ?? "Saved review", persisted: true, scan_id: scan.id, analysis_source: scan.analysis_source ?? "unknown"});
    setFixedCopy(null); setError(null);
    window.setTimeout(() => document.getElementById("scan-result")?.scrollIntoView({behavior: "smooth", block: "start"}), 0);
  }

  const handleScan = async () => {
    if (!adCopy.trim() || scanning || fixing || imageLoading) return;
    const submitted = { adCopy, state };
    const version = inputVersion.current;
    setScanning(true);
    setError(null);
    setScanResult(null);
    setFixedCopy(null);
    setFixError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_copy: submitted.adCopy,
          state: submitted.state,
          user_id: user?.id ?? "",
          ...(imageBase64 ? { image_base64: imageBase64 } : {}),
        }),
      });

      const data = (await response.json()) as {
        result?: ScanResult;
        error?: string;
      };
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? "Scan failed");
      }

      if (version !== inputVersion.current) return;
      if (!data.result) throw new Error("No scan result was returned. Please try again.");
      setScannedInput(submitted);
      setScanResult(data.result);

      // Refresh history
      if (user) {
        const { data: scans, error: historyError } = await supabase
          .from("compliance_scans")
          .select("*")
          .eq("user_id", user.id)
          .order("scanned_at", { ascending: false })
          .limit(10);
        if (historyError) setError("Saved history could not be loaded. Refresh to retry.");
      setHistory((scans as ComplianceScan[]) ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setScanning(false);
    }
  };

  const handleFixAd = async () => {
    if (!scanResult || !scannedInput || fixing) return;
    const version = inputVersion.current;
    setFixing(true);
    setFixError(null);
    setFixedCopy(null);

    try {
      const response = await fetch("/api/fix-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_copy: scannedInput.adCopy,
          flags: scanResult.flags,
          state: scannedInput.state,
        }),
      });

      const data = (await response.json()) as {
        rewritten_copy?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Fix failed");
      }

      if (version !== inputVersion.current) return;
      if (!data.rewritten_copy) throw new Error("No revision was returned. Please try again.");
      setFixedCopy(data.rewritten_copy);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setFixing(false);
    }
  };

  const handleCopy = async () => {
    if (!fixedCopy) return;
    try {
      await navigator.clipboard.writeText(fixedCopy);
      setCopied(true);
      setFixError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFixError("Copy was unavailable. Select the suggested revision and copy it manually.");
    }
  };

  const hasIssues = scanResult && (scanResult.result === "red" || scanResult.result === "yellow");

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Topbar */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center gap-4">
          <Link
            href="/dashboard"
            className="text-white/50 hover:text-white text-sm"
          >
            ← Dashboard
          </Link>
          <span className="text-white/20">/</span>
          <span className="leading-tight text-white">
            <span className="block text-sm font-medium">EyeOnAds · Compliance Scanner</span>
            <span className="block text-[11px] font-normal text-white/50">a Shields Enterprises solution</span>
          </span>
          <a
            href="/support"
            title="Share feedback or suggest a feature"
            className="ml-auto rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/60 hover:text-white"
          >
            Beta
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Compliance Scanner</h1>
          <p className="text-white/50 mt-1 text-sm">
            Paste your ad copy for an automated review. Limited rules are used when AI analysis is unavailable. Results require professional review.
          </p>
        </div>

        {/* Scanner form */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor="scan-state" className="text-white/70 text-sm font-medium shrink-0">
              State:
            </label>
            <select
              id="scan-state"
              disabled={scanning || fixing}
              value={state}
              onChange={(e) => { invalidateResult(); setState(e.target.value); }}
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="TN">Tennessee (TN)</option>
              <option value="VA">Virginia (VA)</option>
              <option value="NC">North Carolina (NC)</option>
            </select>
          </div>

          {/* Image Upload */}
          <div>
            <label htmlFor="ad-image" className="block text-white/70 text-sm font-medium mb-2">
              Ad Creative (Optional)
            </label>
            {!imagePreview ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                role="button"
                tabIndex={scanning || fixing ? -1 : 0}
                aria-label="Upload ad image"
                aria-disabled={scanning || fixing}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!scanning && !fixing) fileInputRef.current?.click();
                  }
                }}
                onClick={() => { if (!scanning && !fixing) fileInputRef.current?.click(); }}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-blue-400 bg-blue-500/10"
                    : "border-white/20 hover:border-white/40 hover:bg-white/5"
                }`}
              >
                <div className="text-4xl mb-3">🖼️</div>
                <p className="text-white/60 text-sm font-medium">
                  Drop your ad image here, or click to upload
                </p>
                <p className="text-white/30 text-xs mt-1">JPG or PNG, smaller than 1.5 MB</p>
                <input
                  ref={fileInputRef}
                  id="ad-image"
                  disabled={scanning || fixing}
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  onClick={(event) => event.stopPropagation()}
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-white/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="Ad creative preview"
                  className="w-full max-h-64 object-contain bg-black/20"
                />
                <div className="absolute top-2 right-2 flex items-center gap-2">
                  <span className="bg-black/60 text-white/70 text-xs px-2 py-1 rounded-full">
                    {imageFile?.name ?? "image"}
                  </span>
                  <button
                    onClick={clearImage}
                    disabled={scanning || fixing}
                    className="bg-red-900/80 hover:bg-red-700 text-white text-xs px-2 py-1 rounded-full transition"
                  >
                    ✕ Remove
                  </button>
                </div>
                <div className="absolute bottom-2 left-2">
                  <span className="bg-blue-600/80 text-white text-xs px-2 py-1 rounded-full">
                    Image attached — review availability shown in results
                  </span>
                </div>
              </div>
            )}
          </div>

          {imageLoading && <p role="status" className="text-white/70 text-sm">Loading image…</p>}
          <div>
            <label htmlFor="ad-copy" className="block text-white/70 text-sm font-medium mb-2">
              Ad Copy
            </label>
            <VoiceInput disabled={scanning || fixing} label="Dictate your ad" onTranscript={(text) => { invalidateResult(); setAdCopy((current) => [current.trimEnd(), text].filter(Boolean).join(" ")); }} />
            <textarea
              id="ad-copy"
              disabled={scanning || fixing}
              maxLength={10000}
              value={adCopy}
              onChange={(e) => { invalidateResult(); setAdCopy(e.target.value); }}
              rows={6}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Paste your ad copy here… e.g. 'Beautiful 3BR/2BA home in Brentwood. Call Jane Smith for a showing! Best agent in Nashville!'"
            />
          </div>

          {error && (
            <div role="alert" className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <button
              onClick={handleScan}
              disabled={scanning || fixing || imageLoading || !adCopy.trim()}
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
          <div id="scan-result" className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Scan Result
              </h2>
              <ComplianceBadge result={scanResult.result} />
            </div>

            <p className="text-white/70 text-sm">{scanResult.summary}</p><p role="status">{scanResult.persisted ? "Saved to your scan history." : "Not saved — test result only."} {scanResult.analysis_source !== "openai" ? "Limited rule review; not a full AI assessment." : ""}</p>

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
              <div className="bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white/80 text-sm">
                {scanResult.analysis_source === "openai" && scanResult.result === "green"
                  ? "No issues were detected by this review. Check the complete ad and applicable requirements before publishing."
                  : "No issues were detected by the limited checks. This review is incomplete; verify the ad before publishing."}
              </div>
            )}

            {/* Fix My Ad button */}
            {hasIssues && scanResult.flags.length > 0 && !fixedCopy && (
              <div className="pt-2">
                <button
                  onClick={handleFixAd}
                  disabled={fixing}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold transition flex items-center gap-2"
                >
                  {fixing ? (
                    <>
                      <span className="animate-spin">⟳</span>
                      Rewriting your ad copy for compliance…
                    </>
                  ) : (
                    "✏️ Fix My Ad"
                  )}
                </button>
                {fixError && (
                  <p className="mt-2 text-red-400 text-sm">{fixError}</p>
                )}
              </div>
            )}

            {/* Fixed Copy Result */}
            {fixedCopy && (
              <div className="border-2 border-green-600 rounded-xl p-5 space-y-3 bg-green-900/10">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <h3 className="text-green-400 font-semibold text-base">
                    Suggested revision — review before use
                  </h3>
                  <button
                    onClick={handleFixAd}
                    disabled={fixing}
                    className="text-white/40 hover:text-white/70 text-xs transition"
                    title="Regenerate"
                  >
                    ↺ Regenerate
                  </button>
                </div>
                {fixError && <p role="alert" className="text-red-300 text-sm">{fixError}</p>}
                <pre className="text-white/90 text-sm whitespace-pre-wrap font-sans leading-relaxed bg-white/5 rounded-lg p-4">
                  {fixedCopy}
                </pre>
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <button
                    onClick={handleCopy}
                    className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    {copied ? "✓ Copied!" : "📋 Copy to Clipboard"}
                  </button>
                  <p className="text-white/40 text-xs">
                    Verify all facts and replace any bracketed placeholders before posting
                  </p>
                </div>
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
            <div>
              <div className="space-y-4 sm:hidden">{history.map(scan => <article key={scan.id} className="rounded-lg border border-white/15 p-3 space-y-2">
                <p className="text-sm text-white/60">{new Date(scan.scanned_at).toLocaleDateString()} · {scan.state} · {scan.flags.length} flags</p>
                <ComplianceBadge result={scan.result}/><p className="text-sm break-words">{scan.ad_copy.slice(0,150)}</p>
                <button disabled={scanning || fixing} onClick={() => openSavedScan(scan)} className="min-h-11 text-blue-300 underline">View result</button>
              </article>)}</div>
              <div className="hidden sm:block overflow-x-auto"><table className="w-full min-w-[650px] text-sm [&_th]:pr-4 [&_td]:pr-4">
                <thead>
                  <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                    <th className="pb-2 text-left">Date</th>
                    <th className="pb-2 text-left">State</th>
                    <th className="pb-2 text-left">Result</th>
                    <th className="pb-2 text-left">Flags</th>
                    <th className="pb-2 text-left">Ad Copy Preview</th><th className="pb-2 text-left">Review</th>
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
                      </td><td><button disabled={scanning || fixing} onClick={() => openSavedScan(scan)} className="min-h-11 px-3 text-blue-300 underline whitespace-nowrap">View result</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
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
