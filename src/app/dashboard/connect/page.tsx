import Link from "next/link";

export default function ConnectPage() {
  return (
    <main className="min-h-screen bg-[#0d1b2a] px-4 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/dashboard" className="text-sm text-white/70 underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Account connections are optional</h1>
        <p className="text-white/80">Public-web broker reports work without connecting social accounts or adding API keys. Direct Meta and Google ad connections are unavailable during beta; these could add coverage later.</p>
        <Link href="/broker/report" className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500">Open broker report</Link>
        <p><Link href="/dashboard/compliance" className="underline">Or check pasted or dictated ad copy manually</Link></p>
        <details className="rounded-xl border border-white/20 p-5">
          <summary className="cursor-pointer font-medium">Setting up your own installation?</summary>
          <p className="mt-4 text-sm text-white/70">These buttons open the provider’s setup page in a new tab. Create app credentials there and configure them on your server. These are administrator settings; customers do not need their own keys. Setup does not enable beta connections.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-white/30 px-4 py-2 underline">Get Google credentials ↗</a>
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-white/30 px-4 py-2 underline">Get Meta credentials ↗</a>
          </div>
          <p className="mt-3 text-xs text-white/60">Google Ads uses an OAuth client ID and secret. A Google AI Studio API key will not connect an advertising account.</p>
        </details>
      </div>
    </main>
  );
}
