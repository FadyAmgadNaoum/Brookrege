"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { api, errorText, SIGNIN_NOTICE_KEY } from "@/lib/api";
import { safeNext } from "@/lib/safeNext";

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setNotice(sessionStorage.getItem(SIGNIN_NOTICE_KEY));
      sessionStorage.removeItem(SIGNIN_NOTICE_KEY);
    } catch { /* private mode */ }
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (err) { setError(errorText(err)); setBusy(false); }
  }

  const submitPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(async () => {
      await api("/auth/login", { method: "POST", json: { email: fd.get("email"), password: fd.get("password") } });
      router.replace(next);
    });
  };

  return (
    <form onSubmit={submitPassword} className="panel w-full max-w-sm space-y-4 p-6">
      <h1 className="text-lg font-semibold">Sign in to Brookrege admin</h1>
      {notice && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="field" />
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink lg:block" aria-hidden="true">
        <img src="/signin.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/10 to-ink/40" />
        <div className="absolute inset-x-10 bottom-10 text-white">
          <p className="wordmark text-2xl">Brookrege</p>
          <p className="mt-2 text-xs uppercase tracking-[0.32em] text-gold">Staff sign-in</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <p className="wordmark mb-8 text-center lg:hidden">Brookrege</p>
          <Suspense><LoginForm /></Suspense>
        </div>
      </div>
    </main>
  );
}
