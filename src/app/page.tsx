import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Navigation */}
      <nav className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden="true">👁</span>
            <span className="leading-tight">
              <span className="block text-2xl font-bold text-white">EyeOnAds</span>
              <span className="block text-[11px] font-normal text-white/50">a Shields Enterprises solution</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="mailto:feedback@shieldsenterprises.example?subject=EyeOnAds%20beta%20feedback"
              title="Share feedback or suggest a feature"
              className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/60 hover:text-white"
            >
              Beta
            </a>
            <Link
              href="/login"
              className="text-white/70 hover:text-white transition text-sm"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 rounded-full px-4 py-1.5 text-blue-300 text-sm mb-8">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Now monitoring real estate ads 24/7
        </div>
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-tight">
          AI keeps an eye on{" "}
          <span className="text-blue-400">your agents&apos; ads.</span>
          <br />
          <span className="text-white/80 text-4xl sm:text-5xl lg:text-6xl font-semibold">
            24/7 compliance + performance — so you don&apos;t have to.
          </span>
        </h1>
        <p className="text-xl text-white/60 max-w-2xl mx-auto mb-12">
          EyeOnAds automatically scans every ad your team runs for Tennessee RE
          Commission violations, Fair Housing issues, and performance drops.
          Know before the commission does.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup?role=agent"
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-semibold text-lg transition shadow-lg shadow-blue-600/20"
          >
            Start as Agent{" "}
            <span className="text-blue-200 font-normal">($49/mo)</span>
          </Link>
          <Link
            href="/signup?role=broker"
            className="bg-white text-[#0d1b2a] hover:bg-blue-50 px-8 py-4 rounded-xl font-semibold text-lg transition shadow-lg"
          >
            Start as Broker{" "}
            <span className="text-gray-600 font-normal">($149/mo)</span>
          </Link>
        </div>
      </section>

      {/* Pain Section */}
      <section className="bg-red-950/30 border-y border-red-800/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-10">
            <span className="text-red-400 font-semibold text-sm uppercase tracking-widest">
              The Risk Is Real
            </span>
            <h2 className="text-3xl font-bold text-white mt-2">
              Brokers are personally liable for every ad their agents run.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                stat: "$10,000+",
                label: "Per violation fine from Tennessee RE Commission",
              },
              {
                stat: "License",
                label:
                  "At risk — yours, not just the agent's — for advertising violations",
              },
              {
                stat: "1 in 4",
                label:
                  "Real estate Facebook ads missing required Fair Housing language",
              },
            ].map((item) => (
              <div
                key={item.stat}
                className="bg-red-900/20 border border-red-800/40 rounded-xl p-6 text-center"
              >
                <div className="text-4xl font-bold text-red-400 mb-2">
                  {item.stat}
                </div>
                <div className="text-white/70 text-sm">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <span className="text-blue-400 font-semibold text-sm uppercase tracking-widest">
            Features
          </span>
          <h2 className="text-4xl font-bold text-white mt-2">
            Everything you need to stay compliant
          </h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-8">
          {[
            {
              icon: "🛡️",
              title: "Compliance Scanning",
              desc: "Paste ad copy and get an instant GREEN / YELLOW / RED verdict. Our AI checks Tennessee RE Commission rules, Fair Housing requirements, and more — with plain-English explanations for every flag.",
              highlight: "bg-green-900/20 border-green-800/40",
            },
            {
              icon: "📊",
              title: "Performance Dashboard",
              desc: "Connect Meta Ads and Google Ads via OAuth. See spend, impressions, clicks, and CTR in one place — updated daily so you catch underperforming ads before they drain budgets.",
              highlight: "bg-blue-900/20 border-blue-800/40",
            },
            {
              icon: "📬",
              title: "Weekly Reports",
              desc: "Every Monday, brokers receive a brokerage-wide report: compliance status per agent, top performing ads, and any red flags from the previous week — straight to your inbox.",
              highlight: "bg-purple-900/20 border-purple-800/40",
            },
          ].map((f) => (
            <div
              key={f.title}
              className={`rounded-xl border p-8 ${f.highlight}`}
            >
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="text-xl font-bold text-white mb-3">{f.title}</h3>
              <p className="text-white/60 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white/5 border-y border-white/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <span className="text-blue-400 font-semibold text-sm uppercase tracking-widest">
            How It Works
          </span>
          <h2 className="text-4xl font-bold text-white mt-2 mb-12">
            Up and running in 5 minutes
          </h2>
          <div className="grid sm:grid-cols-3 gap-8 text-left">
            {[
              {
                step: "1",
                title: "Create your account",
                desc: "Sign up as Agent or Broker. Select your state. You're in.",
              },
              {
                step: "2",
                title: "Connect your ad accounts",
                desc: "Authorize Meta Ads and Google Ads with one click. We pull your live data securely.",
              },
              {
                step: "3",
                title: "Let AI do the watching",
                desc: "EyeOnAds scans new ads automatically and alerts you the moment something looks off.",
              },
            ].map((s) => (
              <div key={s.step} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-lg">
                  {s.step}
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">{s.title}</h4>
                  <p className="text-white/60 text-sm">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing / CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white">Simple pricing</h2>
          <p className="text-white/60 mt-2">
            Cancel any time. No contracts.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
            <div className="text-blue-400 font-semibold text-sm uppercase tracking-widest mb-4">
              Agent
            </div>
            <div className="text-5xl font-bold text-white mb-1">$49</div>
            <div className="text-white/50 text-sm mb-8">/month</div>
            <ul className="space-y-3 mb-8 text-white/70 text-sm">
              {[
                "Unlimited compliance scans",
                "Meta + Google ad account connect",
                "Weekly performance report",
                "Real-time violation alerts",
              ].map((l) => (
                <li key={l} className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> {l}
                </li>
              ))}
            </ul>
            <Link
              href="/signup?role=agent"
              className="block text-center bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold transition"
            >
              Start as Agent
            </Link>
          </div>
          <div className="bg-blue-600 border border-blue-500 rounded-2xl p-8 relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-white/20 rounded-full px-3 py-1 text-xs font-semibold text-white">
              Most Popular
            </div>
            <div className="text-blue-100 font-semibold text-sm uppercase tracking-widest mb-4">
              Broker
            </div>
            <div className="text-5xl font-bold text-white mb-1">$149</div>
            <div className="text-blue-200 text-sm mb-8">/month</div>
            <ul className="space-y-3 mb-8 text-blue-100 text-sm">
              {[
                "Everything in Agent",
                "Brokerage-wide compliance dashboard",
                "All agents under one account",
                "Weekly brokerage report + email alerts",
                "Invite agents via brokerage code",
              ].map((l) => (
                <li key={l} className="flex items-center gap-2">
                  <span className="text-white/80">✓</span> {l}
                </li>
              ))}
            </ul>
            <Link
              href="/signup?role=broker"
              className="block text-center bg-white hover:bg-blue-50 text-blue-700 px-6 py-3 rounded-xl font-semibold transition"
            >
              Start as Broker
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-white/40 text-sm">
          <span>© {new Date().getFullYear()} EyeOnAds. All rights reserved.</span>
          <span>
            EyeOnAds is not a law firm. Compliance results are not legal advice.
          </span>
        </div>
      </footer>
    </div>
  );
}
