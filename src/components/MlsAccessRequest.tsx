"use client";
import { useEffect, useState } from 'react';
import { EMPTY_MLS_REQUEST, MLS_REQUEST_STATUSES, mlsRequestLetter, type MlsAccessRequest as RequestDetails } from '@/lib/mls-access-request';
const field = 'mt-1 w-full rounded-lg border border-white/25 bg-[#142438] p-3 text-white';
export function MlsAccessRequest({ brokerage }: { brokerage: string }) {
  const [draft, setDraft] = useState<RequestDetails>({ ...EMPTY_MLS_REQUEST });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setError(''); setLoaded(false);
    try {
      const response = await fetch('/api/brokerage/mls-access-request', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Request status could not be loaded. Retry.');
      setDraft(data.request || { ...EMPTY_MLS_REQUEST }); setLoaded(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Request status could not be loaded. Retry.'); }
  }
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return load(); }); return () => { active = false; }; }, []);
  function edit(key: keyof RequestDetails, value: string) { setDraft(previous => ({ ...previous, [key]: value })); setMessage(''); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/brokerage/mls-access-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Request status could not be saved. Retry.');
      setDraft(data.request); setMessage('Request tracking saved to your account. No application was sent and no API connection was enabled.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed. Retry.'); }
    finally { setBusy(false); }
  }
  const letter = mlsRequestLetter(brokerage, draft);
  return <section aria-labelledby="mls-access-heading" className="rounded-xl border border-blue-400/40 p-5">
    <h2 id="mls-access-heading" className="text-xl font-semibold">Request MLS API access</h2>
    <p className="mt-2 text-white/80">Request your brokerage’s own approved data access from its MLS. Prepare a draft below, submit it through the MLS’s official process, then record the response here.</p>
    <p className="mt-2 text-sm text-white/70">Already applied? Record “Submitted” below. This tracks your report of the application; MLS approval and a tested connection are separate steps. Do not enter API keys, passwords or tokens here.</p>
    <p className="mt-3 text-sm"><a className="underline" href="https://sparkplatform.com/docs/overview/set_up_access" target="_blank" rel="noopener noreferrer">Official Spark access instructions ↗</a> · Your MLS decides eligibility, fees, required agreements and permitted use. An IDX key may not permit internal roster/compliance use.</p>
    {error && <p role="alert" className="mt-3 text-red-200">{error} {!loaded && <button className="min-h-11 underline" type="button" onClick={() => void load()}>Retry loading request</button>}</p>}
    {!loaded && !error && <p role="status" className="mt-3">Loading request tracking…</p>}
    <form onSubmit={save} className="mt-4 space-y-3">
      <fieldset disabled={!loaded || busy} className="space-y-3 disabled:opacity-50">
        <label className="block">MLS name<input required maxLength={120} className={field} value={draft.mls} onChange={e => edit('mls', e.target.value)} /></label>
        <label className="block">Offices / MLS office IDs (optional)<input maxLength={200} className={field} value={draft.offices} onChange={e => edit('offices', e.target.value)} /></label>
        <label className="block">Broker contact (optional)<input maxLength={120} className={field} value={draft.contact} onChange={e => edit('contact', e.target.value)} /></label>
        <label className="block">Application reference (optional; no credentials)<input maxLength={120} className={field} value={draft.reference} onChange={e => edit('reference', e.target.value)} /></label>
        <label className="block">Application status — reported by you<select className={field} value={draft.status} onChange={e => edit('status', e.target.value)}>{Object.entries(MLS_REQUEST_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {draft.status === 'approved_reported' && <p className="rounded-lg border border-amber-300/40 p-3">Next: arrange secure credential provisioning and verify the permitted roster feed with EyeOnAds support. This status does not activate imports. Self-service credential connection is not available yet.</p>}
        <button className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 font-semibold" type="submit">{busy ? 'Saving…' : 'Save request tracking'}</button>
      </fieldset>
    </form>
    {message && <p role="status" className="mt-3 text-green-200">{message}</p>}
    <details className="mt-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Review your application draft</summary>
      <p className="mb-2 text-sm text-white/70">Uses your saved brokerage name. If it is missing, save brokerage setup or replace the placeholder in your application. Review all placeholders and permissions before submitting to your MLS. Nothing is sent by EyeOnAds.</p>
      <textarea aria-label="MLS application draft" readOnly rows={12} className={field} value={letter} />
      <button type="button" className="mt-2 min-h-11 underline" onClick={async () => { try { await navigator.clipboard.writeText(letter); setMessage('Application draft copied. Submit it through your MLS’s official process; EyeOnAds has not sent it.'); } catch { setError('Copy was unavailable. Select and copy the draft text above.'); } }}>Copy application draft</button>
    </details>
    <p className="mt-3 text-sm text-white/70">You can keep entering your roster manually while approval is pending. MLS access does not grant access to agents’ social-media accounts.</p>
  </section>;
}
