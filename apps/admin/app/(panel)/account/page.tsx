"use client";

import { useState } from "react";
import { ErrorNote, Loading, PageHeader, Tabs } from "@/components/ui";
import { PasswordForm } from "@/components/security/PasswordForm";
import { describeDevice } from "@/components/security/describeDevice";
import { api, errorText } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

type Tab = "password" | "sessions";

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

interface Sess { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }
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
              <p className="text-xs text-silt-soft" dir="ltr">{s.ip ?? "unknown address"}, signed in {fmtDateTime(s.createdAt)}, last active {fmtDateTime(s.lastSeenAt)}</p>
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
  const [tab, setTab] = useState<Tab>("password");
  return (
    <>
      <PageHeader title="My account">{user.name}, {user.email}</PageHeader>
      <Tabs value={tab} onChange={setTab} items={[{ value: "password", label: "Password" }, { value: "sessions", label: "Signed-in browsers" }]} />
      {tab === "password" ? <PasswordTab /> : <SessionsTab />}
    </>
  );
}
