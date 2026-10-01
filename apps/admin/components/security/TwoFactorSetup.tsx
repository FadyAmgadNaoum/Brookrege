"use client";

import { useState, type FormEvent } from "react";
import { api, errorText } from "@/lib/api";
import { BackupCodes } from "./BackupCodes";

interface SetupData { secret: string; otpauthUrl: string; qrSvg: string }

/** Scan → confirm a code → save backup codes. Nothing changes until the code is confirmed. */
export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setErr(null); setBusy(true);
    try { setSetup((await api<{ data: SetupData }>("/auth/2fa/setup", { method: "POST" })).data); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setCodes((await api<{ data: { backupCodes: string[] } }>("/auth/2fa/enable", { method: "POST", json: { code } })).data.backupCodes); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }

  if (codes) return <BackupCodes codes={codes} onDone={onDone} intro="Two-step verification is on. Save these backup codes now — each one signs you in once if you lose your phone. They won't be shown again." />;

  if (!setup) {
    return (
      <div className="max-w-lg space-y-3">
        <p>You'll need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
        {err && <p role="alert" className="text-red-700">{err}</p>}
        <button onClick={start} disabled={busy} className="btn-primary">{busy ? "Preparing…" : "Set up two-step verification"}</button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="grid max-w-2xl gap-6 md:grid-cols-[13rem_1fr]">
      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR code to scan with your authenticator app" className="w-52 rounded-md border border-reed bg-white p-2" />
      <div className="space-y-3">
        <p><span className="font-medium">1.</span> In your authenticator app, add an account and scan this QR code.</p>
        <details className="text-sm text-silt-soft"><summary className="cursor-pointer">Can't scan? Enter this key instead</summary>
          <p className="mt-1 select-all font-medium tracking-wider text-silt" dir="ltr">{setup.secret}</p>
        </details>
        <p><span className="font-medium">2.</span> Enter the 6-digit code the app shows.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="123 456" aria-label="6-digit code" className="field w-40 text-center text-lg tracking-widest" dir="ltr" />
        {err && <p role="alert" className="text-red-700">{err}</p>}
        <div><button disabled={busy || code.replace(/\s/g, "").length !== 6} className="btn-primary">{busy ? "Checking…" : "Turn on"}</button></div>
      </div>
    </form>
  );
}
