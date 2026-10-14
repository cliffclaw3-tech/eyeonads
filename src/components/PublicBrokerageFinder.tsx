"use client";

import { useState } from "react";
import type { PublicAgent, PublicOffice } from "@/lib/public-brokerage-preview";

type Props = {
  name: string;
  region: string;
  website: string;
  expectedAgents: number;
  disabled: boolean;
  onApply: (offices: PublicOffice[], agents: PublicAgent[]) => boolean;
};

export function PublicBrokerageFinder({ name, region, website, expectedAgents, disabled, onApply }: Props) {
  const [offices, setOffices] = useState<PublicOffice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [chosenAgents, setChosenAgents] = useState<string[]>([]);
  const [officeOverrides, setOfficeOverrides] = useState<Record<string, string>>({});
  const [defaultOffice, setDefaultOffice] = useState("");
  const [lookupNote, setLookupNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"start" | "offices" | "agents">("start");
  const officeKey = (office: PublicOffice) => `${office.name}|${office.location}`;
  const agentKey = (agent: PublicAgent) => `${agent.name}|${agent.office}`;

  async function lookup(action: "offices" | "agents") {
    setError("");
    setBusy(true);
    try {
      const picked = offices.filter(office => selected.includes(officeKey(office)));
      if (action === "agents" && !picked.length) throw new Error("Choose at least one office you oversee.");
      const response = await fetch("/api/brokerage/public-preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "offices" ? { action, name, region, website } : { action, name, offices: picked, default_office: picked.some(office => officeKey(office) === defaultOffice) ? defaultOffice : officeKey(picked[0]), expected_agents: expectedAgents }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The public directory lookup did not finish.");
      if (action === "offices") { setOffices(result.offices || []); setSelected([]); setAgents([]); setDefaultOffice(""); setOfficeOverrides({}); setLookupNote(""); setStage("offices"); }
      else { setAgents(result.agents || []); setChosenAgents([]); setOfficeOverrides({}); setLookupNote(result.note || ""); setStage("agents"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The lookup did not finish."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="office-finder-heading" className="space-y-3 rounded-lg border border-blue-400/40 p-4">
    <h3 id="office-finder-heading" className="font-semibold">Find offices and agents from public directories</h3>
    <p className="text-sm text-white/75">Enter your brokerage and area below, then check only the offices you manage. Review every suggested agent before adding names to your draft. Suggestions may be incomplete or outdated.</p>
    <button type="button" disabled={disabled || busy || !name.trim() || !region.trim()} onClick={() => void lookup("offices")} className="min-h-11 rounded-lg border border-blue-400 px-4 py-2 disabled:opacity-50">{busy && stage !== "agents" ? "Finding offices…" : "Suggest offices"}</button>
    {stage !== "start" && <div className="space-y-3">
      <p className="font-medium">Which of these offices do you oversee?</p>
      {!offices.length && <p className="text-sm text-amber-200">No sourced offices found. You can still enter your roster manually.</p>}
      {offices.map(office => <label key={officeKey(office)} className="flex gap-3 rounded-lg border border-white/20 p-3"><input type="checkbox" checked={selected.includes(officeKey(office))} disabled={disabled || busy || stage === "agents"} onChange={event => setSelected(previous => event.target.checked ? [...previous, officeKey(office)] : previous.filter(key => key !== officeKey(office)))} /><span>{office.name} · {office.location}<a className="block break-all text-sm text-blue-300 underline" href={office.source_url} target="_blank" rel="noopener noreferrer">View public source</a></span></label>)}
      {stage === "offices" && selected.length > 0 && <label className="block text-sm">Suggest an office for agents found in the public directory<select value={selected.includes(defaultOffice) ? defaultOffice : selected[0]} onChange={event => setDefaultOffice(event.target.value)} className="mt-2 block min-h-11 w-full rounded-lg bg-slate-900 p-2">{offices.filter(office => selected.includes(officeKey(office))).map(office => <option key={officeKey(office)} value={officeKey(office)}>{office.name} · {office.location}</option>)}</select><span className="mt-1 block text-white/65">This is a starting point. You can correct agents before saving.</span></label>}
      {stage === "offices" && <button type="button" disabled={disabled || busy || !selected.length || selected.length > 5} onClick={() => void lookup("agents")} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 disabled:opacity-50">Find agents</button>}
    </div>}
    {stage === "agents" && <div className="space-y-3">
      <p className="font-medium">Review {agents.length} agents found</p>
      {lookupNote && <p role="status" className="text-sm text-amber-200">{lookupNote}</p>}
      {!agents.length && <p className="text-sm text-amber-200">No agent names could be confirmed from the public pages. Upload a roster CSV below or add names manually; an empty result is not a complete roster.</p>}
      {agents.length > 0 && <div className="flex gap-4 text-sm"><button type="button" className="min-h-11 underline" onClick={() => setChosenAgents(agents.map(agentKey))}>Select all</button><button type="button" className="min-h-11 underline" onClick={() => setChosenAgents([])}>Clear</button><span className="self-center">{chosenAgents.length} selected</span></div>}
      <div className="max-h-80 space-y-2 overflow-y-auto">{agents.map(agent => <div key={agentKey(agent)} className="rounded-lg border border-white/20 p-3"><label className="flex gap-3"><input type="checkbox" checked={chosenAgents.includes(agentKey(agent))} onChange={event => setChosenAgents(previous => event.target.checked ? [...previous, agentKey(agent)] : previous.filter(key => agentKey(agent) !== key))} /><span>{agent.name}{agent.source_type === 'spark' ? <span className="block text-sm text-white/65">Connected Spark roster · office suggested for review</span> : <a className="block break-all text-sm text-blue-300 underline" href={agent.source_url} target="_blank" rel="noopener noreferrer">View public source</a>}</span></label><label className="mt-2 block pl-6 text-sm">Suggested office<select value={officeOverrides[agentKey(agent)] || agent.office} onChange={event => setOfficeOverrides(previous => ({ ...previous, [agentKey(agent)]: event.target.value }))} className="mt-1 block min-h-11 w-full rounded-lg bg-slate-900 p-2">{offices.filter(office => selected.includes(officeKey(office))).map(office => <option key={officeKey(office)} value={officeKey(office)}>{office.name} · {office.location}</option>)}</select></label></div>)}</div>
      <button type="button" disabled={disabled || busy} onClick={() => { if (onApply(offices.filter(office => selected.includes(officeKey(office))), agents.filter(agent => chosenAgents.includes(agentKey(agent))).map(agent => ({ ...agent, office: officeOverrides[agentKey(agent)] || agent.office })))) setStage("start"); }} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 disabled:opacity-50">Add selected offices and agents to draft</button>
    </div>}
    {error && <p role="alert" className="text-amber-200">{error}</p>}
  </section>;
}
