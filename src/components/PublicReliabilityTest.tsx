'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type Setup = { brokerage: string; office: string; copy_template: string; configured: boolean; public_url: string | null; verified_at: string | null };
export function PublicReliabilityTest({ onVerified }: { onVerified?: () => void | Promise<void> }) {
  const [setup, setSetup] = useState<Setup | null>(null), [url, setUrl] = useState(''), [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [signedOut, setSignedOut] = useState(false), [setupRequired, setSetupRequired] = useState(false);
  const pending = useRef(false), copyRef = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/reliability/public-test', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      setSignedOut(response.status === 401); setSetupRequired(!!data.setup_required);
      if (!response.ok) throw Error(data.error || 'Public test setup could not be loaded.');
      setSetup(data); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Public test setup could not be loaded. Retry shortly.'); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  async function copy() {
    if (!setup) return;
    try { await navigator.clipboard.writeText(setup.copy_template); setMessage('Test wording copied. Publish it yourself as an unpaid public Facebook post.'); }
    catch { copyRef.current?.focus(); copyRef.current?.select(); setMessage('The test wording is selected. Use your device’s Copy action.'); }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/reliability/public-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), authorized }), signal: AbortSignal.timeout(28000) });
      const data = await response.json(); setSignedOut(response.status === 401);
      if (!response.ok || data.saved !== true) throw Error(data.error || 'The public test was not saved. Check its visibility and direct post link, then retry.');
      setMessage(data.message); setSetup(current => current ? { ...current, configured: true, public_url: data.public_url, verified_at: data.verified_at } : current);
      await onVerified?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verification ended before confirmation. Refresh saved setup before retrying.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section id="public-reliability-test" aria-labelledby="public-test-heading" className="mt-5 rounded-lg border border-white/25 p-4 print:border-gray-400">
    <h3 id="public-test-heading" className="text-lg font-semibold">Set up a public Facebook test</h3>
    <p className="mt-2 text-sm">Use a plainly labeled fictional post to check public discovery. You publish it yourself on a profile or Page you control. No account connection is needed.</p>
    {!setup && !error && <p role="status" className="mt-3">Loading your brokerage’s test wording…</p>}
    {setup && <>
      {setup.configured && <p className="mt-3 text-sm">Saved public test: <a className="break-all underline" href={setup.public_url || undefined} target="_blank" rel="noopener noreferrer">Open the configured post</a>{setup.verified_at ? ` · Public source verified ${new Date(setup.verified_at).toLocaleString()}` : ''}. Each future check must confirm it remains available.</p>}
      <ol className="mt-4 list-decimal space-y-4 pl-5 print:hidden">
        <li><label htmlFor="public-test-copy" className="font-semibold">Copy your brokerage’s test wording.</label><textarea id="public-test-copy" ref={copyRef} readOnly value={setup.copy_template} rows={7} className="mt-2 block w-full rounded-lg border border-white/30 bg-slate-950 p-3 text-sm text-white"/><button type="button" onClick={() => void copy()} className="mt-2 min-h-11 rounded-lg border border-white/40 px-4 py-2">Copy test wording</button></li>
        <li><p className="font-semibold">Publish it as an unpaid Facebook post with audience set to Public.</p><p className="mt-1 text-sm">Use a profile or Page you control. Keep the exact fictional label and brokerage wording. Open the published post, copy its direct link, and check that it is visible while signed out.</p></li>
        <li><form onSubmit={event => void verify(event)}><label htmlFor="public-test-url" className="font-semibold">Paste the direct public post link.</label><input id="public-test-url" type="url" required maxLength={3000} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.facebook.com/your-page/posts/..." className="mt-2 block min-h-11 w-full rounded-lg border border-white/30 bg-slate-950 p-3 text-white"/><label className="mt-3 flex items-start gap-3"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} required className="mt-1 h-5 w-5 shrink-0"/><span className="text-sm">I control this Facebook profile or Page and am authorized to publish and use this public test for my saved brokerage and office.</span></label><button type="submit" disabled={busy || !authorized || !url.trim()} className="mt-3 min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50">{busy ? 'Verifying public post…' : 'Verify and save public test'}</button></form></li>
      </ol>
      <p className="mt-4 text-sm">Verification applies to future checks. This month’s saved report and report email stay unchanged. Public publisher metadata does not prove account ownership; control of the profile or Page is your attestation.</p>
    </>}
    {error && <div role="alert" className="mt-3 rounded-lg border border-amber-400 p-3"><p>{error}</p>{signedOut && <a href="/login" className="mt-2 inline-block underline">Sign in again</a>}{setupRequired && <a href="/broker" className="mt-2 inline-block underline">Open brokerage setup</a>}<button type="button" onClick={() => void load()} className="mt-2 block min-h-11 underline">Refresh saved setup</button></div>}
    {message && <p role="status" className="mt-3 rounded-lg border border-blue-400 p-3">{message}</p>}
  </section>;
}
