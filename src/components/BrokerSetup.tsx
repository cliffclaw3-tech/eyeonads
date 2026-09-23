"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SparkRosterPreview } from "@/lib/spark-roster";

type Scope = "both" | "brokerage" | "agents";
type Agent = { id?: string; name: string; email: string; social_url: string };
type Setup = {
  brokerage: null | { id: string; name: string; expected_agents: number; scope: Scope; website?: string; location?: string; discovery_agent_ids?: string[] | null; discovery_location?: string | null };
  agents: Agent[];
  error?: string;
};
function serializeAgents(agents: Agent[]) {
  return agents.map((agent) => [agent.name.replaceAll(",", " "), agent.email || "", agent.social_url || ""].join(", ").replace(/,\s*$/, "")).join("\n");
}
const identity = (agent: Agent) => agent.name.replaceAll(",", " ").trim().replace(/\s+/g, " ").toLowerCase();
const fieldClass = "w-full rounded-lg border border-white/25 bg-white/10 px-3 py-3 text-white disabled:opacity-50";

function parseAgents(text: string): Agent[] {
  const seen = new Set<string>();
  return text.split("\n").filter((line) => line.trim()).map((line, index) => {
    const parts = line.split(",").map((part) => part.trim());
    const [name, email = "", social_url = ""] = parts;
    if (!name || parts.length > 3) throw new Error(`Line ${index + 1}: use Name, email, optional social URL. Keep commas out of names.`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Line ${index + 1}: check the email address.`);
    if (email && seen.has(email.toLowerCase())) throw new Error(`Line ${index + 1}: that email is already in the roster.`);
    if (email) seen.add(email.toLowerCase());
    if (social_url) {
      let url: URL;
      try { url = new URL(social_url); } catch { throw new Error(`Line ${index + 1}: enter a complete social URL beginning with https://.`); }
      if (!["https:", "http:"].includes(url.protocol)) throw new Error(`Line ${index + 1}: use an http or https social URL.`);
    }
    return { name, email, social_url };
  });
}

export function BrokerSetup() {
  const [saved, setSaved] = useState<Setup | null>(null);
  const [name, setName] = useState("Greater Impact Realty");
  const [expected, setExpected] = useState("88");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [scope, setScope] = useState<Scope>("both");
  const [roster, setRoster] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [officeScope, setOfficeScope] = useState("jonesborough");
  const [knownAgents, setKnownAgents] = useState<Agent[]>([]);
  const [importPreview, setImportPreview] = useState<SparkRosterPreview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/brokerage", { cache: "no-store" });
      const data: Setup = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Setup could not be loaded. Try again.");
      setSaved(data);
      setName(data.brokerage?.name || "Greater Impact Realty");
      setExpected(data.brokerage ? String(data.brokerage.expected_agents) : "88");
      setScope(data.brokerage?.scope || "both");
      setWebsite(data.brokerage?.website || "");
      setLocation(data.brokerage?.location || "");
      setKnownAgents(data.agents);
      setRoster(serializeAgents(data.agents));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup could not be loaded. Try again.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load]);

  function edited() { setDirty(true); setMessage(""); setError(""); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const expected_agents = Number(expected);
      if (!name.trim()) throw new Error("Enter your brokerage name.");
      if (!expected || !Number.isInteger(expected_agents) || expected_agents < 1) throw new Error("Enter the total number of agents you expect to include, at least 1.");
      if (website.trim()) {
        let url: URL;
        try { url = new URL(website.trim()); } catch { throw new Error("Enter a complete brokerage website beginning with https://."); }
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http or https brokerage website.");
      }
      const agents = draftAgents();
      if (agents.length > expected_agents) throw new Error("Your roster has more agents than your expected total. Update the total or remove duplicate entries.");
      setSaving(true);
      const response = await fetch("/api/brokerage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), expected_agents, scope, agents, website: website.trim(), location: location.trim() }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Setup could not be saved. Your edits are still here; try again.");
      const check = await fetch("/api/brokerage", { cache: "no-store" });
      const confirmed: Setup = await check.json();
      if (!check.ok || confirmed.error || !confirmed.brokerage) throw new Error("The save was sent, but we could not confirm it. Your edits are still here. Retry to confirm.");
      setSaved(confirmed);
      setKnownAgents(confirmed.agents);
      setDirty(false);
      setMessage("Brokerage and roster saved. Open public searches or your broker report for the next step.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup could not be saved. Your edits are still here; try again.");
    } finally { setSaving(false); }
  }

  function draftAgents() {
    return parseAgents(roster).map((agent) => {
      const known = knownAgents.find((item) => (agent.email && item.email.toLowerCase() === agent.email.toLowerCase()) || identity(item) === identity(agent));
      return known?.id ? { ...agent, id: known.id } : agent;
    });
  }

  async function importSpark() {
    setError(""); setMessage("");
    try {
      const current = draftAgents();
      setImporting(true);
      const response = await fetch("/api/brokerage/import-spark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ office_scope: officeScope }) });
      const preview: SparkRosterPreview & { error?: string } = await response.json();
      if (!response.ok || preview.error) throw new Error(preview.error || "Spark import could not be completed. Your saved roster is unchanged.");
      const merged = [...current];
      let added = 0;
      for (const agent of preview.agents) {
        const existing = merged.findIndex((item) => (agent.email && item.email.toLowerCase() === agent.email.toLowerCase()) || identity(item) === identity(agent));
        if (existing >= 0) merged[existing] = { ...merged[existing], id: merged[existing].id || agent.id };
        else { merged.push(agent); added += 1; }
      }
      setKnownAgents(merged); setRoster(serializeAgents(merged)); setImportPreview(preview); setDirty(dirty || JSON.stringify(current) !== JSON.stringify(merged));
      setMessage(`Added ${added} Spark agents to your draft; ${merged.length} total draft entries. Existing entries were retained. Review the roster and expected total, then Save brokerage and roster to persist it.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Spark import failed. Your roster is unchanged."); }
    finally { setImporting(false); }
  }

  async function saveSearchScope(agentIds: string[] | null, searchLocation: string | null = null) {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/brokerage/discovery-scope", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_ids: agentIds, location: searchLocation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Office scope could not be saved.");
      setSaved(previous => previous?.brokerage ? { ...previous, brokerage: { ...previous.brokerage, discovery_agent_ids: result.agent_ids, discovery_location: result.location } } : previous);
      setMessage(`Search scope saved for ${result.scoped_count} agents. All ${result.roster_count} agents remain in your saved roster. No search was started.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Office scope could not be saved. Retry."); }
    finally { setSaving(false); }
  }

  const count = saved?.agents.length ?? 0;
  const expectedCount = saved?.brokerage?.expected_agents;
  const missing = expectedCount === undefined ? null : Math.max(expectedCount - count, 0);
  const busy = loading || saving || importing;

  return <main className="min-h-screen bg-[#0d1b2a] px-4 py-8 text-white sm:px-8">
    <div className="mx-auto max-w-3xl space-y-7">
      <nav className="flex flex-wrap gap-5 text-sm text-white/75"><Link href="/dashboard" className="underline">← Dashboard</Link><Link href="/dashboard/compliance" className="underline">Scan an ad manually</Link><Link href="/broker/discovery" className="underline">Discover public marketing</Link></nav>
      <header><h1 className="text-3xl font-bold">Brokerage setup</h1><p className="mt-3 text-white/75">Add your brokerage and agent roster, then compare the saved count with your expected total. No developer account or API keys are needed.</p></header>
      <section aria-labelledby="monitoring-heading" className="rounded-xl border border-blue-400/40 bg-blue-900/15 p-5">
        <h2 id="monitoring-heading" className="text-lg font-semibold">Public-ad search pilot</h2>
        <p className="mt-2 text-white/80">{saved?.brokerage ? `${saved.brokerage.discovery_agent_ids?.length ?? count} saved agents are selected for public searches.` : "Save your roster to select agents for public searches."} Each result shows what was found and what still needs review.</p>
        <Link href="/broker/discovery" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold">Start or review public searches</Link>
        <details className="mt-3 text-sm text-white/75"><summary className="min-h-11 cursor-pointer py-2">What these checks cover</summary><p>We look for publicly accessible marketing without requiring agents to connect social accounts. Private or unindexed posts can be missed. A saved roster, completed search, or empty result is not compliance clearance. Connected-account monitoring is unavailable.</p></details>
      </section>
      <section aria-labelledby="roster-status" className="rounded-xl border border-white/20 p-5">
        <h2 id="roster-status" className="text-lg font-semibold">Saved roster</h2>
        {loading ? <p role="status" className="mt-2">Loading saved setup…</p> : !saved ? <p className="mt-2">Saved setup could not be verified.</p> : !saved.brokerage ? <p className="mt-2">No brokerage setup saved yet. Enter the expected agent total below to check for missing roster entries.</p> : <>
          <p className="mt-2 text-xl font-semibold">{count} of {expectedCount} expected agents listed</p>
          <p className="mt-2 text-white/75">{missing ? `${missing} agent${missing === 1 ? " is" : "s are"} still missing compared with your full brokerage estimate. This is separate from the selected office search scope.` : "The roster count matches your expected total. Review the names below to confirm the correct people are listed."}</p>
          <p className="mt-2 font-semibold">Search scope: {saved.brokerage.discovery_agent_ids?.length ?? count} saved agents{saved.brokerage.discovery_agent_ids ? " in the selected office subset" : " (entire roster)"}.</p>{saved.brokerage.discovery_location && <p className="mt-2 text-white/80">Search area: {saved.brokerage.discovery_location}</p>}{saved.brokerage.discovery_agent_ids && <button type="button" disabled={busy} className="min-h-11 underline" onClick={() => void saveSearchScope(null)}>Use entire saved roster for searches</button>}
          <p className="mt-2 text-white/65">This checks your roster count only. Open the broker report to see which agents have advertising text assessed.</p>
          {count > 0 && <details className="mt-4"><summary className="min-h-11 cursor-pointer py-2 font-medium">Review {count} saved agent names</summary><ul className="max-h-96 space-y-2 overflow-y-auto">{saved.agents.map((agent, index) => <li key={agent.id || index} className="break-words rounded-lg bg-white/5 p-3"><span className="font-medium">{agent.name}</span>{agent.email && <span className="block text-sm text-white/70">{agent.email}</span>}{agent.social_url && <span className="block text-sm text-white/60">Social link recorded · not connected</span>}</li>)}</ul></details>}
        </>}
      </section>
      {error && <div role="alert" className="rounded-lg border border-red-400/40 bg-red-900/20 p-4">{error}{!saved && <button onClick={() => { setLoading(true); setError(""); void load(); }} disabled={busy} className="ml-3 min-h-11 underline">Retry loading</button>} <Link href="/login" className="ml-3 underline">Sign in again</Link></div>}
      {message && <p role="status" className="rounded-lg border border-green-500/40 p-4">{message}</p>}
      <form onSubmit={save} className="space-y-5 rounded-xl border border-white/20 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Your setup</h2>
        <div className="rounded-lg border border-white/20 p-4">
          <h3 className="font-semibold">Import your Spark roster</h3>
          <p className="mt-2 text-sm text-white/70">Private pilot import for Greater Impact Realty. Save the brokerage name first. Import adds active, visible feed agents to this draft, retains existing entries, and never saves automatically. Review the names and expected total before saving. Allow up to two minutes.</p>
          <label htmlFor="spark-office" className="mt-3 block font-medium">Office to import</label><select id="spark-office" value={officeScope} onChange={(event) => { setOfficeScope(event.target.value); setImportPreview(null); }} disabled={busy} className={fieldClass}><option value="jonesborough">Jonesborough pilot</option><option value="current-feed">All offices in current feed (excluding Knoxville)</option></select>
          <button type="button" onClick={() => void importSpark()} disabled={busy || !saved?.brokerage} className="mt-3 min-h-11 rounded-lg border border-blue-400/60 px-4 py-2 font-semibold disabled:opacity-50">{importing ? "Reading Spark roster…" : "Import Spark roster"}</button>
          {importPreview && <div role="status" className="mt-4 space-y-2 text-sm text-white/80"><p>{importPreview.total} agents found in {importPreview.source}. {importPreview.complete_feed ? "All requested feed pages were read." : "Import is incomplete — some feed pages or records are missing."}</p><ul>{importPreview.offices.map((office) => <li key={office.name}>{office.name}: {office.count}</li>)}</ul>{importPreview.missing_offices?.length > 0 && <p className="font-semibold text-amber-200">Missing office roster: {importPreview.missing_offices.join(", ")}. This import cannot establish company-wide coverage.</p>}<p>{importPreview.warning}</p><p>Import preview only; saved roster counts above change after you save.</p>{importPreview.complete_feed && importPreview.total > 0 && <button type="button" disabled={busy} className="min-h-11 rounded-lg border border-blue-400/60 px-4 py-2 font-semibold" onClick={() => void saveSearchScope(importPreview.agents.map(agent => agent.id), officeScope === "jonesborough" ? "Jonesborough, Tennessee" : null)}>Use these {importPreview.total} agents for searches</button>}</div>}
        </div>
        <fieldset disabled={busy || !saved} className="space-y-5 disabled:opacity-60">
          <div><label htmlFor="brokerage-name" className="mb-2 block font-medium">Brokerage name</label><input id="brokerage-name" value={name} required maxLength={200} onChange={(e) => { edited(); setName(e.target.value); }} className={fieldClass} /></div>
          <div><label htmlFor="brokerage-website" className="mb-2 block font-medium">Brokerage website (optional)</label><input id="brokerage-website" type="url" placeholder="https://example.com" maxLength={2000} value={website} onChange={(e) => { edited(); setWebsite(e.target.value); }} className={fieldClass} /></div>
          <div><label htmlFor="brokerage-location" className="mb-2 block font-medium">Brokerage location (optional)</label><input id="brokerage-location" placeholder="City, state" maxLength={200} value={location} onChange={(e) => { edited(); setLocation(e.target.value); }} className={fieldClass} /><p className="mt-2 text-sm text-white/65">Website and location help distinguish similarly named agents when looking for public marketing.</p></div>
          <div><label htmlFor="agent-total" className="mb-2 block font-medium">How many agents should be included?</label><input id="agent-total" type="number" min="1" step="1" required value={expected} onChange={(e) => { edited(); setExpected(e.target.value); }} className={fieldClass} aria-describedby="agent-total-help" /><p id="agent-total-help" className="mt-2 text-sm text-white/65">Enter the expected count for the offices you are testing. The initial Jonesborough import contained 88 active agents; confirm against the current preview. Knoxville is outside this pilot.</p></div>
          <div><label htmlFor="review-scope" className="mb-2 block font-medium">What do you want to review?</label><select id="review-scope" value={scope} onChange={(e) => { edited(); setScope(e.target.value as Scope); }} className={fieldClass}><option value="both">Brokerage ads and individual agent ads</option><option value="brokerage">Brokerage ads only</option><option value="agents">Individual agent ads only</option></select><p className="mt-2 text-sm text-white/65">This records your intended scope. Public searches use the selected agents; brokerage-account collection is not enabled by this setting.</p></div>
          <div><label htmlFor="agent-roster" className="mb-2 block font-medium">Paste your agent roster</label><p id="roster-help" className="mb-2 text-sm text-white/70">One agent per line: Name, email, optional social URL. Names are required; email and social URL may be blank. If a name contains a comma, remove that comma. No invitations or emails are sent.</p><textarea id="agent-roster" value={roster} onChange={(e) => { edited(); setRoster(e.target.value); }} rows={8} aria-describedby="roster-help" placeholder={"Jane Smith, jane@example.com, https://www.facebook.com/example\nAlex Jones, alex@example.com"} className={`${fieldClass} resize-y`} /><p className="mt-2 text-sm text-white/65">Saving replaces your saved roster with the entries above. Remove a line to remove that roster entry.</p></div>
          <div className="flex flex-wrap items-center gap-4"><button type="submit" className="min-h-11 rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:opacity-50" disabled={busy}>{saving ? "Saving…" : "Save brokerage and roster"}</button>{dirty && <span className="text-sm text-amber-200">Unsaved edits — counts above show the saved roster.</span>}</div>
        </fieldset>
      </form>
    </div>
  </main>;
}
