'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MonthlyReport, Stage } from '@/lib/reliability-canary/engine';
type Run = { id: string; period: string; status: string; error: string | null; report: MonthlyReport | null };
type Status = { config: { enabled: boolean; next_run_at: string | null; public_canary_url: string | null; target_verified_at: string | null; pilot_recipient_override?: string }; runs: Run[]; deliveries: { run_id: string; status: string; recipient: string | null; error: string | null }[] };
function StageResult({ name, stage }: { name: string; stage: Stage }) {
  return <li className="rounded-lg border border-white/20 p-3 print:border-gray-400"><strong>{name}: {stage.status.toUpperCase()}</strong><p className="mt-1 text-sm">{stage.reason}</p>{stage.evidence && <details className="mt-2"><summary className="cursor-pointer text-sm underline">View stage evidence</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(stage.evidence, null, 2)}</pre></details>}</li>;
}
export function MonthlyReliability() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [signedOut, setSignedOut] = useState(false);
  const pending = useRef(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/reliability', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      if (!response.ok) { setSignedOut(response.status === 401); throw Error(data.error || 'Monthly check status could not be loaded.'); }
      setStatus(data); setError(''); setSignedOut(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Monthly check status could not be loaded.'); }
  }, []);
  useEffect(() => { const timer=setTimeout(() => void load(),0); return () => clearTimeout(timer); }, [load]);
  const running = status?.runs.some(run => ['pending', 'running'].includes(run.status)) || status?.deliveries.some(d => ['queued', 'sending'].includes(d.status));
  useEffect(() => { if (!running) return; const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [running, load]);
  async function act(action: 'schedule' | 'run', enabled?: boolean) {
    if (pending.current) return; pending.current = true; setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/reliability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(enabled === undefined ? {} : { enabled }) }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) { setSignedOut(response.status === 401); throw Error(data.error || 'Monthly reliability action could not be saved.'); }
      setMessage(data.message); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The request ended before confirmation. Refresh the saved status before retrying.'); }
    finally { pending.current = false; setBusy(false); }
  }
  const latest = status?.runs[0], delivery = status?.deliveries.find(item => item.run_id === latest?.id);
  const deliveryText = delivery?.status === 'accepted' ? 'Accepted by the email provider; mailbox delivery is not confirmed.' : delivery?.status === 'delivered' ? 'Mailbox delivery confirmed by a verified provider event.' : delivery?.status === 'uncertain' ? 'Acceptance is uncertain. Automatic resend is stopped to prevent duplicate reports.' : delivery?.status === 'failed' ? 'Email request failed. Only confirmed pre-acceptance failures may retry, up to three attempts.' : delivery?.status === 'blocked' ? 'Email is blocked until the recipient or provider configuration is corrected.' : delivery?.status === 'sending' ? 'Email request is in progress.' : delivery?.status === 'queued' ? 'Report email is queued.' : 'No report email has been queued yet.';
  return <section id="monthly-reliability" className="mt-8 rounded-xl border border-white/20 bg-white/5 p-5 text-white print:bg-white print:text-black print:border-gray-400">
    <h2 className="text-xl font-semibold">Monthly reliability check</h2>
    <p className="mt-2 text-sm text-slate-300 print:text-black">Checks blind discovery of a labeled public test, retrieval of that test, and separate rotating defect and clean assessment controls. This is additional to daily monitoring. A pass does not mean every advertisement was found or that advertising is legally compliant.</p>
    {!status && !error && <p role="status" className="mt-3">Loading saved monthly status…</p>}
    {status && <>
      <p className="mt-3">Schedule: <strong>{status.config.enabled ? 'Monthly' : 'Off'}</strong>. Next check: {status.config.enabled && status.config.next_run_at ? new Date(status.config.next_run_at).toLocaleString(undefined, { timeZone: 'UTC' }) + ' UTC' : 'Not scheduled'}.</p>
      {!status.config.public_canary_url || !status.config.target_verified_at ? <p className="mt-2 rounded-lg border border-amber-400 p-3">Public test setup is incomplete. Discovery and retrieval cannot pass until the correct public post and publisher are verified. Assessment controls can still run.</p> : <p className="mt-2">A public test is configured; each monthly run must independently verify its availability and identity.</p>}
      <div className="mt-4 flex flex-wrap gap-3 print:hidden">
        <button type="button" disabled={busy} onClick={() => void act('schedule', !status.config.enabled)} className="rounded-lg border border-white/40 px-4 py-3 disabled:opacity-50">{status.config.enabled ? 'Turn monthly checks off' : 'Enable monthly checks'}</button>
        <button type="button" disabled={busy || !!running} onClick={() => void act('run')} className="rounded-lg bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50">{running ? 'Monthly check in progress…' : 'Run this month’s check'}</button>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-white/40 px-4 py-3">Refresh monthly status</button>
      </div>
      <p className="mt-2 text-sm text-slate-300 print:text-black">One saved check and report email per month. Repeating Run does not create another email. Allow a few minutes; results are saved if you leave this page.</p>
      {latest && <div className="mt-5"><h3 className="font-semibold">{latest.period} — {latest.status === 'complete' ? latest.report?.outcome.toUpperCase() : latest.status}</h3>{latest.error && <p className="mt-2 text-amber-200 print:text-black">{latest.error}</p>}
        {latest.report && <><ul className="mt-3 grid gap-3 sm:grid-cols-2"><StageResult name="Blind discovery" stage={latest.report.discovery}/><StageResult name="Known-URL retrieval" stage={latest.report.retrieval}/><StageResult name="Public test assessment" stage={latest.report.canaryAssessment}/>{latest.report.controls.map(control => <StageResult key={control.id} name={control.kind === 'clean' ? 'Clean control' : 'Known-defect control'} stage={control.stage}/>)}</ul><p className="mt-3">Known public test recall: {latest.report.metrics.recall === null ? 'Not measurable; no verified public target.' : `${latest.report.metrics.targetsFoundBlind}/${latest.report.metrics.knownPublicTargets} test targets found.`} This single-target check does not measure brokerage-wide recall.</p></>}
        <p className="mt-4"><strong>Broker report:</strong> {deliveryText}</p>{delivery?.recipient && <p className="break-all text-sm">Recipient: {delivery.recipient}</p>}{delivery?.error && <p className="mt-2 text-amber-200 print:text-black">{delivery.error}</p>}
      </div>}
    </>}
    {error && <div role="alert" className="mt-4 rounded-lg border border-amber-400 p-3"><p>{error}</p>{signedOut && <a className="underline" href="/login">Sign in again</a>}<button type="button" onClick={() => void load()} className="ml-3 underline">Retry status</button></div>}
    {message && <p role="status" className="mt-3">{message}</p>}
  </section>;
}
