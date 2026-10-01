"use client";

import { useState, type FormEvent } from "react";
import { ErrorNote, Loading, PageHeader, Tabs } from "@/components/ui";
import { BackupCodes } from "@/components/security/BackupCodes";
import { PasswordForm } from "@/components/security/PasswordForm";
import { TwoFactorSetup } from "@/components/security/TwoFactorSetup";
import { describeDevice } from "@/components/security/describeDevice";
import { api, errorText } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

type Tab = "password" | "2fa" | "sessions";

function PasswordTab() {
  const { user, security } = useSession();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="panel p-5">
      <p className="mb-4 text-silt-soft">{security.passwordChangedAt ? `Last changed ${fmtDate(security.passwordChangedAt)}.` : "You haven't changed your password yet."} Changing it signs you out on your other browsers.</p>
      {done && <p role="status" className="mb-4 rounded-md border border-palm/30 bg-palm-tint px-4 py-3 text-palm-dark">{done}</p>}
      <PasswordForm user={user} onDone={(r) => setDone(`Password changed.${r.otherSessionsEnded ? ` Signed out ${r.otherSessionsEnded} other browser(s).` : ""}`)} />
    </div>
  );
}

function TwoFactorTab() {
  const { security, reload } = useSession();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"idle" | "regen" | "off">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      if (mode === "regen") setCodes((await api<{ data: { backupCodes: string[] } }>("/auth/2fa/backup-codes", { method: "POST", json: { code: fd.get("code") } })).data.backupCodes);
      else { await api("/auth/2fa/disable", { method: "POST", json: { password: fd.get("password"), code: fd.get("code") } }); await reload(); }
      setMode("idle");
    } catch (x) { setErr(errorText(x)); }
  }

  if (codes) return <div className="panel p-5"><BackupCodes codes={codes} intro="Your new backup codes. The old ones no longer work." onDone={() => { setCodes(null); void reload(); }} /></div>;
  if (!security.twoFactorEnabled) return <div className="panel p-5"><p className="mb-4">Two-step verification is <strong>off</strong>. Turn it on so a stolen password alone can't open your account.</p><TwoFactorSetup onDone={() => void reload()} /></div>;

  return (
    <div className="panel space-y-4 p-5">
      <p>Two-step verification is <strong className="text-palm-dark">on</strong>. You have <strong>{security.backupCodesLeft}</strong> unused backup code{security.backupCodesLeft === 1 ? "" : "s"}.</p>
      {security.backupCodesLeft <= 3 && <p className="text-amber-800">You're running low on backup codes — create new ones.</p>}
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn-quiet" onClick={() => setMode("regen")}>Create new backup codes</button>
          {security.twoFactorRequired
            ? <p className="text-sm text-silt-soft">Your role requires two-step verification. New phone? Ask a super admin to reset it.</p>
            : <button className="btn-danger" onClick={() => setMode("off")}>Turn off</button>}
        </div>
      ) : (
        <form onSubmit={submit} className="max-w-sm space-y-3">
          {mode === "off" && <div><label className="label" htmlFor="off-pw">Your password</label><input id="off-pw" name="password" type="password" required autoComplete="current-password" className="field" /></div>}
          <div><label className="label" htmlFor="c">Current 6-digit code from your app</label><input id="c" name="code" required inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="field w-40 tracking-widest" /></div>
          <ErrorNote message={err} />
          <div className="flex gap-2"><button className={mode === "off" ? "btn-danger" : "btn-primary"}>{mode === "off" ? "Turn off two-step verification" : "Create new codes"}</button><button type="button" className="btn-quiet" onClick={() => { setMode("idle"); setErr(null); }}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

interface Sess { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; mfaVerified: boolean; current: boolean }
function SessionsTab() {
  const { data, loading, error, reload } = useFetch<{ data: Sess[] }>("/auth/sessions");
  const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await reload(); } catch (e) { setErr(errorText(e)); } };
  if (loading && !data) return <Loading />;
  return (
    <div className="panel p-5">
      <ErrorNote message={error ?? err} />
      <p className="mb-4 text-silt-soft">Browsers signed in to your account. Don't recognise one? Sign it out and change your password.</p>
      <ul className="divide-y divide-reed">
        {data?.data.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{describeDevice(s.userAgent)} {s.current && <span className="ms-1 rounded bg-palm-tint px-1.5 py-0.5 text-xs text-palm-dark">This browser</span>}</p>
              <p className="text-xs text-silt-soft" dir="ltr">{s.ip ?? "unknown address"}, signed in {fmtDateTime(s.createdAt)}, last active {fmtDateTime(s.lastSeenAt)}{s.mfaVerified ? ", with 2FA" : ""}</p>
            </div>
            {!s.current && <button className="text-red-700 hover:underline" onClick={() => act(() => api(`/auth/sessions/${s.id}`, { method: "DELETE" }))}>Sign out</button>}
          </li>
        ))}
      </ul>
      {(data?.data.length ?? 0) > 1 && <button className="btn-quiet mt-4" onClick={() => act(() => api("/auth/sessions/revoke-others", { method: "POST" }))}>Sign out everywhere else</button>}
    </div>
  );
}

export default function AccountPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>("2fa");
  return (
    <>
      <PageHeader title="My account">{user.name}, {user.email}</PageHeader>
      <Tabs value={tab} onChange={setTab} items={[{ value: "2fa", label: "Two-step verification" }, { value: "password", label: "Password" }, { value: "sessions", label: "Signed-in browsers" }]} />
      {tab === "password" ? <PasswordTab /> : tab === "2fa" ? <TwoFactorTab /> : <SessionsTab />}
    </>
  );
}
