"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicMode, setMagicMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    if (magicMode) {
      const { error: magicError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (magicError) {
        setError(magicError.message);
      } else {
        setMagicSent(true);
      }
      setLoading(false);
      return;
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  };

  return (
    <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-white">
            👁 EyeOnAds
          </Link>
          <h1 className="text-2xl font-bold text-white mt-4">Welcome back</h1>
          <p className="text-white/50 mt-1 text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-blue-400 hover:underline">
              Sign up
            </Link>
          </p>
        </div>

        {message && (
          <div className="bg-green-900/40 border border-green-700 rounded-lg px-4 py-3 text-green-300 text-sm mb-6">
            {message}
          </div>
        )}

        {magicSent ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-4">✉️</div>
            <h2 className="text-white font-semibold text-lg mb-2">
              Check your email
            </h2>
            <p className="text-white/60 text-sm">
              We sent a magic link to <strong>{email}</strong>. Click it to log
              in — no password needed.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleLogin}
            className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-5"
          >
            <div>
              <label className="block text-white/70 text-sm mb-1 font-medium">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="jane@realty.com"
              />
            </div>

            {!magicMode && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-white/70 text-sm font-medium">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setMagicMode(true)}
                    className="text-blue-400 text-xs hover:underline"
                  >
                    Use magic link instead
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={!magicMode}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your password"
                />
              </div>
            )}

            {magicMode && (
              <p className="text-white/50 text-sm">
                We&apos;ll email you a magic link — no password needed.{" "}
                <button
                  type="button"
                  onClick={() => setMagicMode(false)}
                  className="text-blue-400 hover:underline"
                >
                  Use password
                </button>
              </p>
            )}

            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition"
            >
              {loading
                ? "Signing in…"
                : magicMode
                ? "Send magic link"
                : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0d1b2a]" />}>
      <LoginForm />
    </Suspense>
  );
}
