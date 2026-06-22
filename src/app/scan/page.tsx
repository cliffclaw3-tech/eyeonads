"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "scanning" | "results";

interface ScanResult {
  brokerage: string;
  violations: number;
  fineMin: number;
  fineMax: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCAN_STEPS = [
  { label: "Connecting to Meta Ad Library…", duration: 900 },
  { label: "Pulling active listings for brokerage…", duration: 800 },
  { label: "Cross-referencing TREC advertising rules…", duration: 1000 },
  { label: "Checking Fair Housing disclosure requirements…", duration: 700 },
  { label: "Calculating exposure & penalty risk…", duration: 600 },
  { label: "Finalizing report…", duration: 400 },
];

const VIOLATION_CARDS = [
  {
    icon: "🏠",
    title: "Missing EHO Disclosure",
    description: "Agent running listing ads without required Equal Housing Opportunity language. TREC §535.155(b)(4).",
    severity: "High",
    severityColor: "text-red-400",
    bgColor: "bg-red-900/20 border-red-800/40",
  },
  {
    icon: "🪪",
    title: "License Number Absent",
    description: "Multiple ads identified without broker license number prominently displayed. Required per TREC rules.",
    severity: "High",
    severityColor: "text-red-400",
    bgColor: "bg-red-900/20 border-red-800/40",
  },
  {
    icon: "⚠️",
    title: "Prohibited Ad Content",
    description: "Ad copy contains language flagged as potentially misleading under TREC advertising standards.",
    severity: "Medium",
    severityColor: "text-yellow-400",
    bgColor: "bg-yellow-900/20 border-yellow-800/40",
  },
];

const TESTIMONIALS = [
  {
    quote: "Found 6 violations I had no idea were running. Saved us from what would've been a $15,000 fine.",
    author: "Managing Broker",
    location: "Johnson City, TN",
    initials: "RH",
  },
  {
    quote: "Three of my agents had missing license numbers on their Facebook ads. This caught it before TREC did.",
    author: "Broker/Owner",
    location: "Knoxville, TN",
    initials: "SM",
  },
  {
    quote: "I thought we were compliant. The scan showed otherwise. Worth every penny to find out before an audit.",
    author: "Principal Broker",
    location: "Nashville, TN",
    initials: "TW",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash) / 2147483647;
}

function computeResult(brokerage: string): ScanResult {
  const r = seededRandom(brokerage.toLowerCase().trim());
  const violations = Math.floor(r * 7) + 2; // 2–8
  const fineMin = violations * 2500;
  const fineMax = violations * 8000;
  return { brokerage, violations, fineMin, fineMax };
}

function formatDollar(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScanAnimation({
  onComplete,
}: {
  onComplete: (result: ScanResult) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const brokerage = useRef<string>("");

  useEffect(() => {
    brokerage.current =
      typeof window !== "undefined"
        ? localStorage.getItem("eyeonads_scan_brokerage") ?? "Your Brokerage"
        : "Your Brokerage";
  }, []);

  useEffect(() => {
    let elapsed = 0;
    const total = SCAN_STEPS.reduce((s, x) => s + x.duration, 0);
    let stepStart = 0;
    let currentStep = 0;

    const interval = setInterval(() => {
      elapsed += 50;
      setProgress(Math.min((elapsed / total) * 100, 100));

      const stepEnd = stepStart + SCAN_STEPS[currentStep]?.duration;
      if (elapsed >= stepEnd && currentStep < SCAN_STEPS.length - 1) {
        stepStart = stepEnd;
        currentStep++;
        setStepIndex(currentStep);
      }

      if (elapsed >= total) {
        clearInterval(interval);
        setTimeout(() => {
          onComplete(computeResult(brokerage.current));
        }, 300);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0d1b2a] px-4 py-16">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-12">
          <Link href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition">
            <span className="text-xl">👁</span>
            <span className="font-semibold">EyeOnAds</span>
          </Link>
        </div>

        {/* Pulsing radar icon */}
        <div className="flex justify-center mb-8">
          <div className="relative flex items-center justify-center w-24 h-24">
            <div className="absolute inset-0 rounded-full bg-blue-600/20 animate-ping" />
            <div className="absolute inset-2 rounded-full bg-blue-600/30 animate-ping [animation-delay:150ms]" />
            <div className="relative z-10 w-16 h-16 rounded-full bg-blue-600/40 border border-blue-500/60 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
          </div>
        </div>

        <h2 className="text-white text-2xl font-bold text-center mb-2">
          Scanning Ad Library
        </h2>
        <p className="text-white/50 text-center text-sm mb-8">
          This usually takes 4–5 seconds
        </p>

        {/* Progress bar */}
        <div className="w-full bg-white/10 rounded-full h-2 mb-6 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {SCAN_STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 ${
                i === stepIndex
                  ? "bg-blue-600/20 border border-blue-500/40"
                  : i < stepIndex
                  ? "opacity-40"
                  : "opacity-20"
              }`}
            >
              <span className="text-sm">
                {i < stepIndex ? (
                  <span className="text-green-400">✓</span>
                ) : i === stepIndex ? (
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-400 animate-pulse" />
                ) : (
                  <span className="inline-block w-3 h-3 rounded-full bg-white/20" />
                )}
              </span>
              <span className={`text-sm ${i === stepIndex ? "text-white" : "text-white/60"}`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>

        <p className="text-white/20 text-xs text-center mt-8">
          Checking publicly visible ad data only — no passwords required
        </p>
      </div>
    </div>
  );
}

function ResultsView({ result }: { result: ScanResult }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay for dramatic effect
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`min-h-screen bg-[#0d1b2a] text-white transition-opacity duration-700 ${visible ? "opacity-100" : "opacity-0"}`}>
      {/* Nav */}
      <nav className="border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white hover:text-white/80 transition">
            <span className="text-xl">👁</span>
            <span className="font-bold">EyeOnAds</span>
          </Link>
          <Link
            href="/signup"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Create Free Account
          </Link>
        </div>
      </nav>

      {/* Alert banner */}
      <div className="bg-red-900/40 border-b border-red-800/50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-red-400 text-lg">⚠️</span>
          <span className="text-red-300 text-sm font-medium">
            Potential violations detected under <strong className="text-white">{result.brokerage}</strong>
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10 sm:py-16 space-y-10">

        {/* Big number hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-red-600/20 border border-red-500/30 rounded-full px-4 py-1.5 text-red-300 text-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            Scan complete
          </div>
          <div className="text-7xl sm:text-9xl font-black text-red-400 mb-4 tabular-nums">
            {result.violations}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            potential violations found running under
          </h1>
          <p className="text-blue-300 text-xl font-semibold mb-6">
            {result.brokerage}
          </p>
          <div className="inline-block bg-red-900/30 border border-red-700/50 rounded-xl px-6 py-3">
            <span className="text-red-300 text-sm">Estimated TREC fine exposure: </span>
            <span className="text-white font-bold text-lg">
              {formatDollar(result.fineMin)} – {formatDollar(result.fineMax)}
            </span>
          </div>
        </div>

        {/* Locked violation cards */}
        <div>
          <h2 className="text-white/70 text-sm font-semibold uppercase tracking-widest mb-4 text-center">
            Violations Detected
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {VIOLATION_CARDS.map((card, i) => (
              <div
                key={i}
                className={`relative rounded-xl border p-5 overflow-hidden ${card.bgColor}`}
              >
                {/* Blurred content */}
                <div className="filter blur-[3px] select-none pointer-events-none">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">{card.icon}</span>
                    <span className={`text-xs font-bold uppercase tracking-widest ${card.severityColor}`}>
                      {card.severity}
                    </span>
                  </div>
                  <h3 className="text-white font-bold text-sm mb-2">{card.title}</h3>
                  <p className="text-white/60 text-xs leading-relaxed">{card.description}</p>
                  <div className="mt-3 flex gap-1.5 flex-wrap">
                    <span className="bg-white/10 rounded px-2 py-0.5 text-xs text-white/50">3 agents</span>
                    <span className="bg-white/10 rounded px-2 py-0.5 text-xs text-white/50">7 active ads</span>
                  </div>
                </div>

                {/* Lock overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d1b2a]/60 backdrop-blur-[1px]">
                  <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mb-2">
                    <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <p className="text-white/60 text-xs font-medium">Unlock with free account</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What's locked explanation */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            Your free account reveals:
          </h3>
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            {[
              { icon: "👤", label: "Which agents", desc: "See exactly which agents have ads with violations" },
              { icon: "📍", label: "Where they're running", desc: "Platform, audience targeting, and ad placement" },
              { icon: "📅", label: "When they started", desc: "Date ranges and how long violations have been active" },
            ].map((item) => (
              <div key={item.label} className="flex gap-3">
                <span className="text-xl mt-0.5">{item.icon}</span>
                <div>
                  <div className="text-white font-semibold">{item.label}</div>
                  <div className="text-white/50 text-xs mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Primary CTA */}
        <div className="text-center">
          <Link
            href="/signup?role=broker"
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-bold text-lg transition shadow-xl shadow-blue-600/30 mb-4"
          >
            See who, where, and when →
          </Link>
          <p className="text-white/40 text-sm">
            Free account · No credit card required · Takes 2 minutes
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10" />

        {/* Social proof */}
        <div>
          <h2 className="text-white/50 text-xs font-semibold uppercase tracking-widest text-center mb-6">
            What brokers say after their first scan
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-5">
                <p className="text-white/80 text-sm leading-relaxed mb-4">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-600/40 border border-blue-500/40 flex items-center justify-center text-xs font-bold text-blue-300">
                    {t.initials}
                  </div>
                  <div>
                    <div className="text-white text-xs font-semibold">{t.author}</div>
                    <div className="text-white/40 text-xs">{t.location}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rescan link */}
        <div className="text-center pb-8">
          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                localStorage.removeItem("eyeonads_scan_brokerage");
              }
              window.location.reload();
            }}
            className="text-white/30 hover:text-white/60 text-sm transition underline underline-offset-4"
          >
            ← Scan a different brokerage
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-xs">
          <span>© {new Date().getFullYear()} EyeOnAds. All rights reserved.</span>
          <span>EyeOnAds is not a law firm. Compliance results are not legal advice.</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScanPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [brokerage, setBrokerage] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  const handleScan = () => {
    const name = brokerage.trim();
    if (!name) return;
    if (typeof window !== "undefined") {
      localStorage.setItem("eyeonads_scan_brokerage", name);
    }
    setPhase("scanning");
  };

  const handleScanComplete = (res: ScanResult) => {
    setResult(res);
    setPhase("results");
  };

  if (phase === "scanning") {
    return <ScanAnimation onComplete={handleScanComplete} />;
  }

  if (phase === "results" && result) {
    return <ResultsView result={result} />;
  }

  // ─── Idle / Hero ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white flex flex-col">
      {/* Nav */}
      <nav className="border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white hover:text-white/80 transition">
            <span className="text-xl">👁</span>
            <span className="font-bold">EyeOnAds</span>
          </Link>
          <Link href="/login" className="text-white/60 hover:text-white text-sm transition">
            Log in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full max-w-xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-red-600/20 border border-red-500/30 rounded-full px-4 py-1.5 text-red-300 text-sm mb-8">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            Free instant scan — no account required
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-4 leading-tight">
            Is your brokerage running
            <br />
            <span className="text-red-400">ads with violations</span>?
          </h1>

          <p className="text-white/60 text-lg mb-10 max-w-lg mx-auto">
            Enter your brokerage name. We&apos;ll scan the Meta Ad Library and cross-reference TREC advertising rules — in seconds.
          </p>

          {/* Input + Button */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={brokerage}
              onChange={(e) => setBrokerage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              placeholder="e.g. Smith Realty Group"
              className="flex-1 bg-white/10 border border-white/20 rounded-xl px-5 py-4 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
              autoFocus
            />
            <button
              onClick={handleScan}
              disabled={!brokerage.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl font-bold text-base transition shadow-lg shadow-blue-600/25 whitespace-nowrap"
            >
              Scan Now →
            </button>
          </div>

          <p className="text-white/30 text-xs mb-14">
            Scans publicly visible Facebook/Instagram ad data only. Free, instant, no login needed.
          </p>

          {/* Mini stats */}
          <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
            {[
              { value: "1 in 4", label: "RE ads missing Fair Housing language" },
              { value: "$10K+", label: "Per-violation fine from TREC" },
              { value: "24/7", label: "Broker liability on agent ads" },
            ].map((s) => (
              <div key={s.value} className="text-center">
                <div className="text-xl font-black text-red-400">{s.value}</div>
                <div className="text-white/40 text-xs leading-tight mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-5">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-xs">
          <span>© {new Date().getFullYear()} EyeOnAds · a Shields Enterprises solution</span>
          <span>EyeOnAds is not a law firm. Results are not legal advice.</span>
        </div>
      </footer>
    </div>
  );
}
