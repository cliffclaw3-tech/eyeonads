"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Agent = { id: string; name: string; email: string; social_url: string };
type Review = {
  agent_id: string; agent_name: string; status: "running" | "complete" | "failed";
  report: string; sources: { url: string; title: string }[]; searched_at: string; error?: string;
};
type Discovery = {
  brokerage: { name: string; expected_agents: number; website: string; location: string } | null;
  agents: Agent[]; reviews: Review[]; error?: string;
};

type Job = { id: string; status: "running" | "paused" | "complete" | "failed"; error?: string; total: number; completed: number; failed: number; pending: number };
function safeSource(url: string) {
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; }
}
function ReportText({ text }: { text: string }) {
  // Render only ordinary markdown links; everything else remains escaped React text.
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    parts.push(text.slice(start, index));
    parts.push(safeSource(match[2]) ? <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">{match[1]} ↗</a> : match[1]);
    start = index + match[0].length;
  }
  parts.push(text.slice(start));
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">{parts}</div>;
}

export function DiscoveryDashboard() {
  const [data, setData] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobLoaded, setJobLoaded] = useState(false);
  const [jobUpdating, setJobUpdating] = useState(false);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState("all");
  const [visibleCount, setVisibleCount] = useState(25);
  const requestBusy = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/discovery", { cache: "no-store" });
    const result: Discovery = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Search progress could not be loaded. Try refreshing again.");
    if (mounted.current) setData(result);
    return result;
  }, []);

  const refreshJob = useCallback(async () => {
    const response = await fetch("/api/discovery/jobs", { cache: "no-store" });
    const result: { job: Job | null; error?: string } = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Background search status could not be checked. Refresh before starting a search.");
    if (mounted.current) { setJob(result.job); setJobLoaded(true); }
    return result.job;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void Promise.all([refresh(), refreshJob()]).catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : "Search progress could not be loaded."); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [refresh, refreshJob]);

  useEffect(() => {
    if (job?.status !== "running" && job?.status !== "paused") return;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try { await Promise.all([refresh(), refreshJob()]); }
      catch { if (mounted.current) setError("Live progress could not be refreshed. The server batch may still be running; refresh saved progress to check."); }
      finally { polling = false; }
    }, 10_000);
    return () => clearInterval(timer);
  }, [job?.status, refresh, refreshJob]);

  async function reload() {
    setLoading(true); setError("");
    try { await Promise.all([refresh(), refreshJob()]); } catch (err) { setError(err instanceof Error ? err.message : "Could not refresh progress."); }
    finally { setLoading(false); }
  }

  async function searchAgent(agent: Agent): Promise<boolean> {
    if (!mounted.current) return false;
    setActiveId(agent.id);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agent.id }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || `Search failed for ${agent.name}.`);
      const confirmed = await refresh();
      const review = confirmed.reviews.find((item) => item.agent_id === agent.id);
      if (review?.status !== "complete") throw new Error(review?.error || `A completed search for ${agent.name} has not been confirmed. Refresh progress before retrying.`);
      return true;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : `Search failed for ${agent.name}. Retry this agent after checking progress.`);
      try { await refresh(); } catch { /* Keep the search error visible and preserve prior progress. */ }
      return false;
    } finally { if (mounted.current) setActiveId(null); }
  }

  async function runOne(agent: Agent) {
    if (requestBusy.current || !jobLoaded || job?.status === "running") return;
    requestBusy.current = true;
    setError(""); setMessage("");
    try { if (await searchAgent(agent)) setMessage(`Public search saved for ${agent.name}. Review identity matches and source links before relying on the findings.`); }
    finally { requestBusy.current = false; }
  }

  async function updateJob(action: "start" | "pause" | "resume") {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setJobUpdating(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/discovery/jobs", {
        method: action === "start" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(action !== "start" ? { body: JSON.stringify({ action }) } : {}),
      });
      const result: { job: Job | null; error?: string } = await response.json();
      if (!response.ok || result.error || !result.job) throw new Error(result.error || "The batch change could not be confirmed. Refresh saved progress before trying again.");
      setJob(result.job); setJobLoaded(true);
      setMessage(action === "pause" ? "Pause saved. Any agent search already in progress may finish; no additional agents will start while paused." : "Background batch saved. You can close this page and return to review the results.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update the background batch. Refresh progress to check its state."); }
    finally { requestBusy.current = false; setJobUpdating(false); }
  }

  const reviews = new Map((data?.reviews || []).map((review) => [review.agent_id, review]));
  const agents = data?.agents || [];
  const searched = agents.filter((agent) => reviews.get(agent.id)?.status === "complete").length;
  const failed = agents.filter((agent) => reviews.get(agent.id)?.status === "failed").length;
  const unfinished = agents.filter((agent) => reviews.get(agent.id)?.status === "running").length;
  const remaining = agents.filter((agent) => !reviews.has(agent.id)).length;
  const missing = Math.max((data?.brokerage?.expected_agents || 0) - agents.length, 0);
  const visibleAgents = agents.filter((agent) => {
    const status = reviews.get(agent.id)?.status || "unsearched";
    return (!filter || `${agent.name} ${agent.email}`.toLowerCase().includes(filter.toLowerCase())) && (view === "all" || status === view);
  });
  const batch = job?.status === "running";
  const busy = batch || activeId !== null || loading || jobUpdating || !jobLoaded;
  const controlsBusy = activeId !== null || loading || jobUpdating || !jobLoaded;
  const pendingAgents = agents.length - searched;

  return <main className="min-h-screen bg-[#0d1b2a] px-4 py-8 text-white sm:px-8">
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="flex flex-wrap gap-4 text-sm text-white/75"><Link href="/broker" className="underline">← Brokerage setup</Link><Link href="/dashboard/compliance" className="underline">Scan ad copy manually</Link><Link href="/dashboard" className="underline">Dashboard</Link></nav>
      <Link href="/broker/report" className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold">Review broker findings and report</Link>
      <header><h1 className="text-3xl font-bold">Discover public marketing</h1><p className="mt-2 text-white/75">Search the public web for agents in {data?.brokerage?.name || "your brokerage"}, then review saved reports and source links.</p></header>
      {loading && <p role="status">Loading saved progress…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-400/40 p-4">{error}<button onClick={() => void reload()} disabled={loading || jobUpdating} className="ml-3 min-h-11 underline disabled:opacity-50">Refresh progress</button></div>}
      {message && <p role="status" className="rounded-lg border border-white/25 p-4">{message}</p>}
      {data && <>
        <section className="rounded-xl border border-white/20 p-5">
          <h2 className="text-xl font-semibold">Latest saved results: {searched} of {agents.length} agents searched</h2>
          <p className="mt-2 text-white/75">{remaining} not searched · {failed} failed · {unfinished} unfinished or in progress</p>
          <p className="mt-2 text-white/75">Saved results may predate the current batch. Open the broker report for actual ad-text assessments and scheduled checks. Search completion is not a compliance clearance.</p>
          {missing > 0 && <p className="mt-3 text-amber-200">{missing} of your {data.brokerage?.expected_agents} expected agents are missing from the roster and cannot be searched here. <Link href="/broker" className="underline">Add missing agents</Link>.</p>}
          {!data.brokerage || agents.length === 0 ? <p className="mt-4">Start by <Link href="/broker" className="underline text-blue-300">saving your brokerage and agent roster</Link>.</p> : <>
            {job && <div role="status" aria-live="polite" className="mt-4 rounded-lg border border-white/20 p-4"><p className="font-semibold">Batch {job.status === "complete" ? "finished" : job.status}</p><p className="mt-1 text-sm">{job.completed} successfully searched · {job.failed} failed · {job.pending} pending · {job.total} total in this batch</p><p className="mt-2 text-sm">Batch counts track queued searches. Individual searches can update saved findings separately; resume a paused batch to finish its queue.</p>{job.status === "paused" && <p className="mt-2 text-sm">Any current agent may finish. Resume this batch to continue its pending agents.</p>}{job.status === "complete" && job.failed > 0 && <p className="mt-2 text-sm text-amber-200">The batch finished with failures. Those agents still need a successful search; retry below or start another batch.</p>}{job.error && <p className="mt-2 break-words text-sm text-red-300">{job.error}</p>}</div>}
            <div className="mt-4 flex flex-wrap gap-3">
              {(job?.status === "paused" || job?.status === "failed") && job.pending > 0
                ? <button onClick={() => void updateJob("resume")} disabled={controlsBusy} className="min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50">{jobUpdating ? "Updating batch…" : `Resume batch (${job.pending} pending)`}</button>
                : <button onClick={() => void updateJob("start")} disabled={busy || pendingAgents === 0} className="min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50">{batch ? "Background batch running" : jobUpdating ? "Starting batch…" : `Search remaining agents (${pendingAgents})`}</button>}
              {batch && <button onClick={() => void updateJob("pause")} disabled={controlsBusy} className="min-h-11 rounded-lg border border-white/30 px-4 py-3 disabled:opacity-50">{jobUpdating ? "Saving pause…" : "Pause after current agent"}</button>}
              <button onClick={() => void reload()} disabled={loading || jobUpdating} className="min-h-11 px-3 underline disabled:opacity-50">Refresh saved progress</button>
            </div>
            <p className="mt-3 text-sm text-white/70">You can close this page while the batch runs on the server. About one agent starts each minute; large rosters can take several hours. Return here for saved progress. Set daily or weekly public checks in your broker report. These checks sample public sources and do not continuously monitor every social post.</p>
          </>}
          {activeId && <p role="status" className="mt-4 text-blue-200">Searching {agents.find((agent) => agent.id === activeId)?.name || "agent"}… The report will appear after the saved result is confirmed.</p>}
        </section>
        <details className="rounded-xl border border-white/20 p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Public search scope and limits</summary><p className="mt-2">These checks sample public sources. They may miss private or unindexed ads or match someone with the same name. Verify identity and the original source before acting. No verified ad found does not mean no ads exist or that advertising is compliant.</p>{/greater impact realty/i.test(data.brokerage?.name || "") && <p className="mt-2">Knoxville is outside this pilot because it requires a separate MLS/Spark connection. Confirm the intended office and agent names in Brokerage setup.</p>}</details>
        {agents.length > 0 && <section aria-labelledby="agents-heading" className="space-y-4">
          <h2 id="agents-heading" className="text-xl font-semibold">Agent search reports</h2>
          <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="agent-filter" className="mb-1 block text-sm">Find an agent</label><input id="agent-filter" value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(25); }} className="w-full rounded-lg border border-white/25 bg-white/10 p-3" placeholder="Name or email" /></div><div><label htmlFor="search-status" className="mb-1 block text-sm">Search status</label><select id="search-status" value={view} onChange={(event) => { setView(event.target.value); setVisibleCount(25); }} className="w-full rounded-lg border border-white/25 bg-white/10 p-3"><option value="all">All agents</option><option value="unsearched">Not searched</option><option value="complete">Successfully searched</option><option value="failed">Failed — retry needed</option><option value="running">Unfinished or in progress</option></select></div></div>
          <p className="text-sm text-white/60">Showing {Math.min(visibleCount, visibleAgents.length)} of {visibleAgents.length} matching agents. Counts use current roster IDs; reports for removed entries are excluded.</p>
          {visibleAgents.slice(0, visibleCount).map((agent) => {
            const review = reviews.get(agent.id);
            const active = activeId === agent.id;
            const status = active ? "Searching…" : review?.status === "complete" ? "Last saved search completed — review required" : review?.status === "failed" ? "Search failed — no completed assessment" : review?.status === "running" ? "Unfinished or in progress — refresh before retrying" : "Not searched";
            return <article key={agent.id} className="rounded-xl border border-white/20 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 break-words"><h3 className="font-semibold">{agent.name}</h3>{agent.email && <p className="text-sm text-white/65">{agent.email}</p>}<p className="mt-2 text-sm text-white/80">{status}</p>{review?.searched_at && <p className="mt-1 text-xs text-white/60">Last recorded: {new Date(review.searched_at).toLocaleString()}</p>}</div><button onClick={() => void runOne(agent)} disabled={busy} className="min-h-11 rounded-lg border border-blue-400/60 px-4 py-2 text-sm font-semibold disabled:opacity-50">{active ? "Searching…" : review?.status === "complete" ? "Search again" : review ? "Retry search" : "Search agent"}</button></div>
              {review?.error && <p className="mt-3 break-words text-sm text-red-300">{review.error}</p>}
              {review?.status === "complete" && <details className="mt-4"><summary className="min-h-11 cursor-pointer py-2 text-blue-200">Read report and source links</summary>{review.agent_name !== agent.name && <p className="my-2 text-amber-200">This report was recorded under {review.agent_name}. The roster name has changed; verify that the sources identify the current agent.</p>}<ReportText text={review.report || "No report text is available. Review sources or search again."} /><h4 className="mt-4 font-semibold">Sources to verify</h4>{review.sources?.length ? <ul className="mt-2 space-y-2">{review.sources.map((source, index) => <li key={`${source.url}-${index}`} className="break-words text-sm">{safeSource(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">{source.title || new URL(source.url).hostname} ↗<span className="mt-1 block break-all text-xs text-white/60">{source.url}</span></a> : <span className="text-white/60">Source link unavailable</span>}</li>)}</ul> : <p className="mt-2 text-sm text-amber-200">No source links were saved. Treat the report as unverified; do not infer that no ads exist.</p>}</details>}
            </article>;
          })}
          {visibleAgents.length === 0 && <p>No agents match these filters.</p>}
          {visibleAgents.length > visibleCount && <button onClick={() => setVisibleCount((count) => count + 25)} className="min-h-11 rounded-lg border border-white/30 px-5 py-3">Show 25 more agents</button>}
        </section>}
      </>}
    </div>
  </main>;
}
