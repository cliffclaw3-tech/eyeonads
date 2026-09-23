'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function OfficeSocialControls({ running = false }: { running?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recovery, setRecovery] = useState<'signin' | 'setup' | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(timer);
  }, [running, router]);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setRecovery(null);
    setMessage('');
    try {
      const response = await fetch('/api/social-discovery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(95000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setRecovery(response.status === 401 ? 'signin' : response.status === 400 ? 'setup' : null);
        setError(response.status === 409
          ? 'A public social check is already running. Refresh saved results to see its progress.'
          : response.status === 401 ? 'Your session has ended. Sign in again to check public social ads.'
          : response.status === 403 ? 'Public social checks are available to invited brokerage pilots. This account cannot start a check.'
          : response.status === 400 ? 'Save your brokerage name in Brokerage setup before starting this check.'
          : 'The public social check could not finish. Your saved evidence is still available. Try again.');
      } else if (result?.review?.status === 'complete') {
        setMessage('Check saved. Updated evidence appears below. Review its coverage limits before drawing conclusions.');
      } else {
        setMessage('A public social check is already running. Refresh saved results to see its progress.');
      }
      router.refresh();
    } catch {
      setError('The connection ended before completion was confirmed. Refresh saved results first; if no check is running, try again.');
      router.refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="mt-4 space-y-3 print:hidden">
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={run} disabled={busy || running}
        className="rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
        {busy || running ? 'Checking public social ads…' : error ? 'Try public social check again' : 'Check public social ads'}
      </button>
      <button type="button" onClick={() => router.refresh()} className="rounded-lg border border-white/40 px-4 py-3 underline">Refresh saved results</button>
    </div>
    {(busy || running) && <p role="status">Checking a small sample of public Meta ads. This usually takes up to 90 seconds. Saved results remain below while the check runs.</p>}
    {error && <div role="alert" className="rounded-lg border border-amber-400 p-3"><p>{error}</p>{recovery === 'signin' && <a href="/login" className="mt-2 inline-block underline">Sign in again</a>}{recovery === 'setup' && <a href="/broker" className="mt-2 inline-block underline">Open Brokerage setup</a>}</div>}
    {message && !running && <p role="status">{message}</p>}
  </div>;
}
