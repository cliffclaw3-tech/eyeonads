"use client";
import { useState } from "react";
import Link from "next/link";
import { competitorExamples, competitiveBrief } from "@/lib/competitor-examples";
export default function ExamplesPage() {
  const [selected, setSelected] = useState(competitorExamples[0]);
  const [draft, setDraft] = useState("");
  const [output, setOutput] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(selected.copy); setOutput("Example copied. Adapt it and verify your own facts before use."); }
    catch { setOutput("Copy unavailable. Select the example text above and copy it manually."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([competitiveBrief(selected.id, draft)], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = `${selected.id}-study.txt`; a.click(); URL.revokeObjectURL(url);
    setOutput("Study file prepared for download. Nothing was published.");
  }
  return <main className="w-full min-h-screen bg-[#0d1b2a] mx-auto p-6 space-y-6 text-white">
    <Link className="underline" href="/scan">Back to scan</Link>
    <h1 className="text-3xl font-bold">Competitor practice library</h1>
    <p>10 fictional examples to explore messaging. These are teaching examples, not collected competitor ads, verified claims or performance data.</p>
    <label className="block">Choose an example<select className="block w-full bg-slate-900 p-3" value={selected.id} onChange={e => { setSelected(competitorExamples.find(x => x.id === e.target.value)!); setOutput(""); }}>{competitorExamples.map(e => <option key={e.id} value={e.id}>{e.name} — {e.angle}</option>)}</select></label>
    <article className="border rounded p-4"><h2>{selected.name}</h2><p>{selected.copy}</p></article>
    <label className="block">Your draft<textarea className="block w-full bg-slate-900 p-3" rows={4} maxLength={10000} value={draft} onChange={e => setDraft(e.target.value)} /></label>
    <div className="flex flex-wrap gap-3">
      <button className="border rounded p-3" onClick={() => setOutput(competitiveBrief(selected.id, draft))}>Compare messaging</button>
      <button className="border rounded p-3" onClick={() => setOutput(`Draft an alternative: describe one verified property feature, explain its practical use, then invite readers to request details. Reference angle: ${selected.angle}. Add your brokerage and required disclosures.`)}>Plan an alternative</button>
      <button className="border rounded p-3" onClick={() => setOutput("Review checklist: verify property facts; substantiate comparisons; use inclusive language; include required brokerage/license disclosures; choose one clear next step. This is not legal approval.")}>Review checklist</button>
      <button className="border rounded p-3" onClick={copy}>Copy example</button>
      <button className="border rounded p-3" onClick={download}>Download study</button>
    </div>
    <p role="status" className="whitespace-pre-wrap">{output}</p>
  </main>;
}
