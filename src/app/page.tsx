import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0d1b2a] text-white">
      {/* Navigation */}
      <nav className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden="true">👁</span>
            <span className="leading-tight">
              <span className="block text-2xl font-bold text-white">EyeOnAds</span>
              <span className="block text-[11px] font-normal text-white/50">a Shields Enterprises solution</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/support"
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
          Brokerage beta: public marketing discovery
        </div>
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-tight">
          Review your brokerage’s{" "}
          <span className="text-blue-400">public marketing.</span>
          <br />
          <span className="text-white/80 text-4xl sm:text-5xl lg:text-6xl font-semibold">
            Find potential issues. Keep the broker in control.
          </span>
        </h1>
        <p className="text-xl text-white/60 max-w-2xl mx-auto mb-12">
          Build your agent roster, search public marketing, and review source-linked findings. You can also scan pasted or dictated ad copy. Public search is incomplete and every potential issue needs broker review.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup?role=agent"
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-semibold text-lg transition shadow-lg shadow-blue-600/20"
          >
            Start as Agent{" "}
            <span className="text-blue-200 font-normal">(free beta)</span>
          </Link>
          <Link
            href="/signup?role=broker"
            className="bg-white text-[#0d1b2a] hover:bg-blue-50 px-8 py-4 rounded-xl font-semibold text-lg transition shadow-lg"
          >
            Start as Broker{" "}
            <span className="text-gray-600 font-normal">(free beta)</span>
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
              A clear roster. Visible gaps. Evidence you can review.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                stat: "Roster",
                label: "See which agents and offices are included—and which are still missing",
              },
              {
                stat: "Evidence",
                label:
                  "Open the source behind a potential issue before making a decision",
              },
              {
                stat: "Coverage",
                label:
                  "Separate completed public searches from private, paid, and offline marketing that remains unverified",
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
              desc: "Saved scan history keeps recent pasted-copy reviews together. Meta and Google account connections are unavailable during this beta.",
              highlight: "bg-blue-900/20 border-blue-800/40",
            },
            {
              icon: "📬",
              title: "Weekly Reports",
              desc: "Use saved scan history to review recent results. Scheduled reports and automated alerts are not part of this beta candidate.",
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
                title: "Submit ad copy",
                desc: "Paste or dictate the ad copy you want reviewed. Ad-account connections are unavailable during beta.",
              },
              {
                step: "3",
                title: "Review the saved result",
                desc: "Review the result and its flags, then use your professional judgment before publishing.",
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
          <h2 className="text-4xl font-bold text-white">Free beta · no billing</h2>
          <p className="text-white/60 mt-2">
            Cancel any time. No contracts.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
            <div className="text-blue-400 font-semibold text-sm uppercase tracking-widest mb-4">
              Agent
            </div>
            <div className="text-5xl font-bold text-white mb-1">Free</div>
            <div className="text-white/50 text-sm mb-8">during beta</div>
            <ul className="space-y-3 mb-8 text-white/70 text-sm">
              {[
                "Unlimited compliance scans",
                "Saved personal scan history",
                "Pasted-copy review",
                "Professional review reminder",
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
            <div className="text-5xl font-bold text-white mb-1">Free</div>
            <div className="text-blue-200 text-sm mb-8">during beta</div>
            <ul className="space-y-3 mb-8 text-blue-100 text-sm">
              {[
                "Everything in Agent",
                "Brokerage-wide compliance dashboard",
                "All agents under one account",
                "Saved brokerage scan history",
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
