"use client";

import { useState } from "react";
import type { Role } from "@brookrege/domain";
import { Empty, ErrorNote, Loading, PageHeader, Tabs } from "@/components/ui";
import { describeDevice } from "@/components/security/describeDevice";
import { api, errorText } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

interface Staff { id: string; name: string; email: string; role: Role; status: string; twoFactorEnabled: boolean; twoFactorRequired: boolean; lockedUntil: string | null; lastLoginAt: string | null; mustChangePassword: boolean; activeSessions: number; backupCodesLeft: number }
interface Overview {
  counts: { staff: number; with2fa: number; required2faMissing: number; locked: number; activeSessions: number; failedSignIns24h: number; failedSignIns7d: number };
  policy: { require2faForAll: boolean; sessionIdleMinutes: number; sessionMaxHours: number };
  ipAllowlist: { enabled: boolean; count: number };
  staff: Staff[];
  checks: { id: string; label: string; ok: boolean; detail: string }[];
  events: { id: string; action: string; entityId: string | null; ip: string | null; after: Record<string, unknown> | null; createdAt: string; actor: { name: string } | null }[];
}
type Tab = "overview" | "staff" | "sessions" | "network" | "events";

const EVENT_TEXT: Record<string, string> = {
  "auth.login": "Signed in", "auth.login_failed": "Wrong password", "auth.mfa_failed": "Wrong 2FA code", "auth.password_check_failed": "Wrong current password", "auth.locked": "Account locked",
  "auth.password_changed": "Changed password", "auth.2fa_enabled": "Turned on 2FA", "auth.2fa_disabled": "Turned off 2FA",
  "auth.backup_code_used": "Signed in with a backup code", "auth.backup_codes_regenerated": "Created new backup codes", "auth.session_revoked": "Signed out a browser",
  "security.ip_blocked": "Blocked: address not allowed", "security.ip_allowlist_update": "Changed allowed addresses", "security.policy_update": "Changed security policy",
  "security.session_revoked": "Ended someone's session", "security.revoke_all_sessions": "Signed out all staff (emergency)", "team.2fa_reset": "Reset someone's 2FA", "team.unlock": "Unlocked an account", "team.sign_out": "Signed someone out everywhere",
  "privacy.export": "Exported a person's data", "privacy.erase": "Erased a person's data", "privacy.retention": "Nightly personal-data clean-up",
  "privacy.retention_manual": "Ran the personal-data clean-up", "privacy.policy_update": "Changed data retention",
  "team.create": "Added a team member", "team.update": "Changed a team member", "team.update_with_password": "Set a temporary password",
};

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return <div className="panel p-4"><p className="text-silt-soft">{label}</p><p className={`mt-1 text-2xl font-semibold ${warn ? "text-red-700" : ""}`}>{value}</p></div>;
}

function OverviewTab({ o, reload }: { o: Overview; reload: () => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null);
  const toggle = async () => { setErr(null); try { await api("/security/policy", { method: "PUT", json: { require2faForAll: !o.policy.require2faForAll } }); await reload(); } catch (e) { setErr(errorText(e)); } };
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Staff using two-step verification" value={`${o.counts.with2fa} of ${o.counts.staff}`} />
        <Stat label="Required but not set up" value={o.counts.required2faMissing} warn={o.counts.required2faMissing > 0} />
        <Stat label="Failed sign-ins (24 h / 7 days)" value={`${o.counts.failedSignIns24h} / ${o.counts.failedSignIns7d}`} warn={o.counts.failedSignIns24h >= 20} />
        <Stat label="Locked accounts" value={o.counts.locked} warn={o.counts.locked > 0} />
      </div>
      <section className="panel mt-6 p-5">
        <h2 className="mb-3 font-semibold">Policy</h2>
        <ErrorNote message={err} />
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={o.policy.require2faForAll} onChange={toggle} />
          <span><span className="font-medium">Require two-step verification for everyone</span><span className="block text-sm text-silt-soft">Super admins always need it. When on, content admins and moderators must set it up at their next sign-in.</span></span>
        </label>
        <p className="mt-4 text-sm text-silt-soft">Sessions end after {o.policy.sessionIdleMinutes} minutes without activity and after {o.policy.sessionMaxHours} hours in any case. After 5 wrong passwords or codes an account locks for 15 minutes (then 30, 60 …).</p>
      </section>
      <section className="panel mt-6 p-5">
        <h2 className="mb-3 font-semibold">Server configuration</h2>
        <ul className="space-y-2">
          {o.checks.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span aria-hidden="true" className={c.ok ? "text-palm-dark" : "text-red-700"}>{c.ok ? "✓" : "✗"}</span>
              <span><span className="font-medium">{c.label}</span><span className="block text-sm text-silt-soft">{c.detail}</span></span>
              <span className="sr-only">{c.ok ? "OK" : "Needs attention"}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function StaffTab({ o, reload }: { o: Overview; reload: () => Promise<void> }) {
  const { user: me } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const act = async (question: string, fn: () => Promise<unknown>) => { if (!confirm(question)) return; setErr(null); try { await fn(); await reload(); } catch (e) { setErr(errorText(e)); } };
  return (
    <div className="panel overflow-x-auto">
      <ErrorNote message={err} />
      <table className="w-full min-w-[820px]">
        <thead><tr><th className="th">Person</th><th className="th">Two-step verification</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{o.staff.map((s) => {
          const locked = s.lockedUntil && new Date(s.lockedUntil) > new Date();
          return (
            <tr key={s.id}>
              <td className="td"><p className="font-medium">{s.name}{s.id === me.id && <span className="text-silt-soft"> (you)</span>}</p><p className="text-xs text-silt-soft">{s.email}, {s.role.replace("_", " ").toLowerCase()}</p></td>
              <td className="td">{s.twoFactorEnabled ? <span className="text-palm-dark">On{s.backupCodesLeft <= 3 ? `, ${s.backupCodesLeft} backup codes left` : ""}</span> : s.twoFactorRequired ? <span className="text-red-700">Required, not set up</span> : <span className="text-silt-soft">Off</span>}</td>
              <td className="td">{fmtDate(s.lastLoginAt)}<p className="text-xs text-silt-soft">{s.activeSessions} active session{s.activeSessions === 1 ? "" : "s"}</p></td>
              <td className="td">{s.status === "SUSPENDED" ? "Suspended" : locked ? <span className="text-red-700">Locked until {fmtDateTime(s.lockedUntil!)}</span> : s.mustChangePassword ? "Must choose a password" : "Active"}</td>
              <td className="td space-x-3 whitespace-nowrap text-end">
                {locked && <button className="text-palm hover:underline" onClick={() => act(`Unlock ${s.name}'s account?`, () => api(`/team/${s.id}/unlock`, { method: "POST" }))}>Unlock</button>}
                {s.twoFactorEnabled && s.id !== me.id && <button className="text-palm hover:underline" onClick={() => act(`Reset ${s.name}'s two-step verification? Use this when they lose their phone. They'll set it up again at next sign-in.`, () => api(`/team/${s.id}/reset-2fa`, { method: "POST" }))}>Reset 2FA</button>}
                {s.activeSessions > 0 && s.id !== me.id && <button className="text-red-700 hover:underline" onClick={() => act(`Sign ${s.name} out on every browser?`, () => api(`/team/${s.id}/sign-out`, { method: "POST" }))}>Sign out everywhere</button>}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

interface Sess { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; mfaVerified: boolean; current: boolean; user: { id: string; name: string; role: Role } }
function SessionsTab() {
  const { data, loading, reload } = useFetch<{ data: Sess[] }>("/security/sessions");
  if (loading && !data) return <Loading />;
  if (!data?.data.length) return <Empty>No one is signed in.</Empty>;
  return (
    <div className="panel overflow-x-auto"><table className="w-full min-w-[720px]">
      <thead><tr><th className="th">Person</th><th className="th">Browser</th><th className="th">Last active</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{data.data.map((s) => (
        <tr key={s.id}>
          <td className="td">{s.user.name}{s.current && <span className="text-silt-soft"> (this browser)</span>}</td>
          <td className="td">{describeDevice(s.userAgent)}<p className="text-xs text-silt-soft" dir="ltr">{s.ip}{s.mfaVerified ? ", with 2FA" : ""}</p></td>
          <td className="td">{fmtDateTime(s.lastSeenAt)}<p className="text-xs text-silt-soft">since {fmtDateTime(s.createdAt)}</p></td>
          <td className="td text-end">{!s.current && <button className="text-red-700 hover:underline" onClick={async () => { await api(`/security/sessions/${s.id}`, { method: "DELETE" }); await reload(); }}>End session</button>}</td>
        </tr>
      ))}</tbody></table></div>
  );
}

interface Allow { enabled: boolean; entries: { value: string; label?: string | null }[]; yourIp: string; bypassActive: boolean }
function NetworkTab() {
  const { data, loading, reload } = useFetch<{ data: Allow }>("/security/ip-allowlist");
  const [draft, setDraft] = useState<Allow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote message="Couldn't load the allowed networks. Reload the page." />;
  const d = draft ?? data.data;
  const update = (patch: Partial<Allow>) => setDraft({ ...d, ...patch });
  async function save() {
    setErr(null); setOk(null);
    try { await api("/security/ip-allowlist", { method: "PUT", json: { enabled: d.enabled, entries: d.entries.filter((e) => e.value.trim()) } }); setDraft(null); await reload(); setOk("Saved. It applies on all servers within 15 seconds."); }
    catch (e) { setErr(errorText(e)); }
  }
  return (
    <div className="panel max-w-3xl space-y-4 p-5">
      <p className="text-silt-soft">Limit the admin to your office or home connections. Anyone elsewhere can't even reach the sign-in page's server. Your address right now: <strong dir="ltr">{d.yourIp}</strong>.</p>
      <p className="text-sm text-amber-800">Most Egyptian home and mobile internet connections change address often. Only turn this on if the office has a fixed IP address from its provider.</p>
      {d.bypassActive && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">The emergency bypass is on (ADMIN_IP_ALLOWLIST_BYPASS). The list below is not being enforced.</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={d.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Only allow the addresses below</label>
      <ul className="space-y-2">
        {d.entries.map((e, i) => (
          <li key={i} className="flex gap-2">
            <input value={e.value} onChange={(ev) => update({ entries: d.entries.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)) })} placeholder="41.33.10.5 or 41.33.10.0/24" dir="ltr" className="field w-56" aria-label="Address or range" />
            <input value={e.label ?? ""} onChange={(ev) => update({ entries: d.entries.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })} placeholder="Office" className="field" aria-label="Label" />
            <button type="button" className="text-red-700 hover:underline" onClick={() => update({ entries: d.entries.filter((_, j) => j !== i) })}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-quiet" onClick={() => update({ entries: [...d.entries, { value: "", label: "" }] })}>Add address</button>
        {!d.entries.some((e) => e.value === d.yourIp) && <button type="button" className="btn-quiet" onClick={() => update({ entries: [...d.entries, { value: d.yourIp, label: "Added from here" }] })}>Add my current address</button>}
      </div>
      <ErrorNote message={err} />
      {ok && <p role="status" className="text-palm-dark">{ok}</p>}
      <button className="btn-primary" onClick={save} disabled={!draft}>Save</button>
    </div>
  );
}

function EventsTab({ o }: { o: Overview }) {
  if (!o.events.length) return <Empty>No security events yet.</Empty>;
  return (
    <div className="panel overflow-x-auto"><table className="w-full min-w-[640px]">
      <thead><tr><th className="th">When</th><th className="th">What</th><th className="th">Who</th><th className="th">From</th></tr></thead>
      <tbody>{o.events.map((e) => (
        <tr key={e.id}><td className="td whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
          <td className={`td ${/failed|locked|blocked/.test(e.action) ? "text-red-700" : ""}`}>{EVENT_TEXT[e.action] ?? e.action}{e.action === "auth.login_failed" && typeof e.after?.email === "string" ? ` (${e.after.email})` : ""}</td>
          <td className="td">{e.actor?.name ?? "—"}</td><td className="td" dir="ltr">{e.ip ?? "—"}</td></tr>
      ))}</tbody></table></div>
  );
}

export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const { data, loading, error, reload } = useFetch<{ data: Overview }>("/security/overview");
  return (
    <>
      <PageHeader title="Security">Who can get in, how, and what happened recently.</PageHeader>
      <Tabs value={tab} onChange={setTab} items={[{ value: "overview", label: "Overview" }, { value: "staff", label: "Staff accounts" }, { value: "sessions", label: "Signed in now" }, { value: "network", label: "Allowed networks" }, { value: "events", label: "Recent events" }]} />
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : data && (
        tab === "overview" ? <OverviewTab o={data.data} reload={reload} /> :
        tab === "staff" ? <StaffTab o={data.data} reload={reload} /> :
        tab === "sessions" ? <SessionsTab /> :
        tab === "network" ? <NetworkTab /> : <EventsTab o={data.data} />
      )}
    </>
  );
}
