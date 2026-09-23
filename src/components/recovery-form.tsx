'use client';

import { useState } from 'react';
import Link from 'next/link';
import { INVALID_RECOVERY, passwordError } from '@/lib/password-recovery';

export default function RecoveryForm({ mode }: { mode: 'request' | 'reset' | 'invalid' }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = mode === 'request' ? { email: form.get('email') } : { password: form.get('password'), confirmation: form.get('confirmation') };
    const validation = mode === 'reset' ? passwordError(body.password, body.confirmation) : null;
    if (validation) { setError(validation); return; }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/auth/recovery/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) setError(result.error || 'Unable to continue. Please try again.');
      else if (mode === 'reset') window.location.assign('/login?message=Password+updated.+Sign+in+with+your+new+password.');
      else setMessage(result.message);
    } catch { setError('Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }
  const inputClass = 'w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  return <main className="min-h-screen bg-[#0d1b2a] flex items-center justify-center py-12 px-4">
    <div className="w-full max-w-md text-white">
      <div className="text-center mb-8">
        <Link href="/" className="text-2xl font-bold">👁 EyeOnAds</Link>
        <h1 className="text-2xl font-bold mt-4">{mode === 'request' ? 'Forgot password?' : 'Reset password'}</h1>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-5">
        {mode === 'invalid' ? <p role="alert">{INVALID_RECOVERY}</p> : message ? <p role="status">{message}</p> : <form onSubmit={submit} className="space-y-5">
          {mode === 'request' ? <>
            <p className="text-white/70 text-sm">Enter your account email. Open the latest reset link in this browser. Once opened, you have 15 minutes to choose a new password.</p>
            <label className="block text-sm">Email<input name="email" type="email" autoComplete="email" required maxLength={254} className={inputClass} /></label>
          </> : <>
            <p className="text-white/70 text-sm">Choose a new password between 8 and 128 characters.</p>
            <label className="block text-sm">New password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} /></label>
            <label className="block text-sm">Confirm new password<input name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} /></label>
          </>}
          {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
          <button disabled={busy} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-3 rounded-xl font-semibold">{busy ? 'Please wait…' : mode === 'request' ? 'Send reset link' : 'Save new password'}</button>
        </form>}
        {mode === 'request' && message ? <button type="button" onClick={() => setMessage('')} className="block text-blue-400 hover:underline">Request a new reset link</button> : mode !== 'request' && <Link href="/forgot-password" className="block text-blue-400 hover:underline">Request a new reset link</Link>}
        <Link href="/login" className="block text-blue-400 hover:underline">Back to sign in</Link>
      </div>
    </div>
  </main>;
}
