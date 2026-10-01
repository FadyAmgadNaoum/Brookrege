"use client";

import { useState, type FormEvent } from "react";
import { passwordProblems, passwordStrength, PASSWORD_MIN } from "@brookrege/domain";
import { api, errorText } from "@/lib/api";

const LEVELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const COLORS = ["bg-red-500", "bg-red-400", "bg-amber-400", "bg-palm/70", "bg-palm"];

/** Change password with live policy feedback (the same rules the server enforces). */
export function PasswordForm({ user, onDone, submitLabel = "Change password" }: { user: { email: string; name: string }; onDone: (r: { otherSessionsEnded: number }) => void; submitLabel?: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = next ? passwordProblems(next, user) : [];
  const strength = passwordStrength(next, user);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problems.length || next !== confirm) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ data: { otherSessionsEnded: number } }>("/auth/password", { method: "POST", json: { currentPassword: current, newPassword: next } });
      onDone(r.data);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4" noValidate>
      <div><label className="label" htmlFor="pw-cur">Current password</label><input id="pw-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="field" /></div>
      <div>
        <label className="label" htmlFor="pw-new">New password</label>
        <input id="pw-new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className="field" aria-describedby="pw-help" />
        {next && (
          <div className="mt-2" aria-live="polite">
            <div className="flex gap-1" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 flex-1 rounded ${i < strength ? COLORS[strength] : "bg-reed"}`} />)}</div>
            <p className="mt-1 text-xs text-silt-soft">{LEVELS[strength]}</p>
          </div>
        )}
        <ul id="pw-help" className="mt-2 space-y-0.5 text-xs text-silt-soft">
          {next ? problems.map((p) => <li key={p} className="text-red-700">{p}</li>) : <li>At least {PASSWORD_MIN} characters with upper and lower case, a number and a symbol. A short sentence works well, e.g. “Nile-Garden-Balcony-7”.</li>}
        </ul>
      </div>
      <div>
        <label className="label" htmlFor="pw-conf">Type the new password again</label>
        <input id="pw-conf" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" />
        {confirm && confirm !== next && <p className="mt-1 text-xs text-red-700">The two passwords don't match.</p>}
      </div>
      {err && <p role="alert" className="text-red-700">{err}</p>}
      <button className="btn-primary" disabled={busy || !current || !next || problems.length > 0 || next !== confirm}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
