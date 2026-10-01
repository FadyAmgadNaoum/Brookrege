"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { api, errorText, SIGNIN_NOTICE_KEY } from "@/lib/api";
import { safeNext } from "@/lib/safeNext";

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [step, setStep] = useState<"password" | "code">("password");
  const [useBackup, setUseBackup] = useState(false);
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
      const r = await api<{ mfaRequired?: boolean }>("/auth/login", { method: "POST", json: { email: fd.get("email"), password: fd.get("password") } });
      if (r.mfaRequired) { setStep("code"); setBusy(false); return; }
      router.replace(next);
    });
  };

  const submitCode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    void run(async () => {
      await api("/auth/2fa/verify", { method: "POST", json: useBackup ? { backupCode: value } : { code: value } });
      router.replace(next);
    });
  };

  if (step === "code") {
    return (
      <form onSubmit={submitCode} className="panel w-full max-w-sm space-y-4 p-6">
        <h1 className="text-lg font-semibold">Two-step verification</h1>
        <p className="text-silt-soft">{useBackup ? "Enter one of your backup codes. Each code works once." : "Enter the 6-digit code from your authenticator app."}</p>
        <input key={String(useBackup)} name="code" required autoFocus dir="ltr" autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"} maxLength={useBackup ? 12 : 7} placeholder={useBackup ? "xxxx-xxxx" : "123 456"}
          aria-label={useBackup ? "Backup code" : "6-digit code"} className="field text-center text-lg tracking-widest" />
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
        <div className="flex justify-between text-sm">
          <button type="button" onClick={() => { setUseBackup((b) => !b); setError(null); }} className="text-palm hover:underline">{useBackup ? "Use the app code" : "Use a backup code"}</button>
          <button type="button" onClick={() => { setStep("password"); setError(null); }} className="text-silt-soft hover:underline">Start again</button>
        </div>
      </form>
    );
  }

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
