"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const steps = [
  { title: "Welcome to EyeOnAds", text: "Start with your brokerage, confirm who is on your roster, then check marketing and review possible issues. This short guide shows you where to go.", action: "Set up my brokerage", href: "/broker", tip: "Already set up? Review your saved roster before starting a search." },
  { title: "1. Save your brokerage", text: "Open Brokerage setup. Enter your brokerage name, website, location, and expected number of agents. Choose whether to include brokerage ads, agent ads, or both, then save.", action: "Open brokerage setup", href: "/broker#brokerage-name", tip: "Your expected agent total helps you spot missing people and offices." },
  { title: "2. Confirm every agent", text: "Paste your agent roster, including known public social links. Greater Impact’s authorized pilot account can also import its Spark roster. Review the preview, then choose Save brokerage and roster.", action: "Review my roster", href: "/broker#agent-roster", tip: "An import is not proof of complete coverage. Check missing offices, including Knoxville, against your own company roster." },
  { title: "3. Find public marketing", text: "Open Public marketing search, choose an agent for a single search, or start a background batch for your saved roster. A batch continues after you close the browser. Return to review source links and confirm each result belongs to the right agent.", action: "Open public marketing search", href: "/broker/discovery", tip: "Searches can miss ads. Facebook, Instagram, and Google account connections are currently unavailable; this does not turn on continuous monitoring." },
  { title: "4. Review an ad", text: "Open Compliance, paste or dictate ad copy, select the state, and optionally attach an image. Run the scan, review the findings, and use Fix My Ad for a suggested rewrite. Saved findings can be reopened in your history.", action: "Check my first ad", href: "/dashboard/compliance", tip: "AI findings need human review and are not legal approval. You can reopen this guide anytime using Getting started." },
];

export function BrokerGuide({ userId }: { userId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const key = `eyeonads:broker-guide:v1:${userId}`;

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(key) === "dismissed"; } catch { /* Still offer help when storage is unavailable. */ }
    if (!dismissed && !dialog.current?.open) dialog.current?.showModal();
  }, [key]);

  useEffect(() => { if (dialog.current?.open) heading.current?.focus(); }, [step]);

  function dismiss() {
    try { localStorage.setItem(key, "dismissed"); } catch { /* The guide remains usable without storage. */ }
    dialog.current?.close();
  }

  const current = steps[step];
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 bg-[#12253a] px-4 py-2 text-white">
      <p className="text-sm">Need a hand setting up your brokerage?</p>
      <button type="button" className="min-h-11 rounded-lg border border-blue-400/60 px-4 py-2 text-sm font-semibold hover:bg-white/10" onClick={() => { setStep(0); dialog.current?.showModal(); }}>Getting started</button>
    </div>
    <dialog ref={dialog} aria-labelledby="broker-guide-title" aria-describedby="broker-guide-description" onCancel={dismiss} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-white/20 bg-[#12253a] p-5 text-white shadow-2xl backdrop:bg-black/75 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-blue-200">Getting started · {step + 1} of {steps.length}</p>
        <button type="button" onClick={dismiss} className="min-h-11 rounded-lg px-3 text-sm hover:bg-white/10" aria-label="Close getting started guide">Close</button>
      </div>
      <h2 ref={heading} tabIndex={-1} id="broker-guide-title" className="text-2xl font-bold outline-none">{current.title}</h2>
      <p id="broker-guide-description" className="mt-4 leading-relaxed text-white/85">{current.text}</p>
      <p className="mt-4 rounded-lg border border-blue-300/20 bg-blue-300/10 p-3 text-sm leading-relaxed text-blue-100">{current.tip}</p>
      <Link href={current.href} onClick={dismiss} className="mt-6 block rounded-lg bg-blue-600 px-4 py-3 text-center font-semibold hover:bg-blue-500">{current.action}</Link>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="min-h-11 rounded-lg px-4 py-2 hover:bg-white/10 disabled:opacity-35">Back</button>
        {step < steps.length - 1 ? <button type="button" onClick={() => setStep(step + 1)} className="min-h-11 rounded-lg border border-white/30 px-4 py-2 hover:bg-white/10">Next</button> : <button type="button" onClick={dismiss} className="min-h-11 rounded-lg border border-white/30 px-4 py-2 hover:bg-white/10">Finish guide</button>}
      </div>
    </dialog>
  </>;
}
