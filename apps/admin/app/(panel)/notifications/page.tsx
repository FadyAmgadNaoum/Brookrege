"use client";

import { useState, type FormEvent } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Pager, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDateTime } from "@/lib/labels";
import { useFetch } from "@/lib/useFetch";

type Tab = "email" | "sms" | "templates" | "logs" | "queue";

function Notice({ ok, err }: { ok: string | null; err: string | null }) {
  return <>{ok && <p role="status" className="mb-4 rounded-md border border-palm/30 bg-palm-tint px-4 py-3 text-palm-dark">{ok}</p>}<ErrorNote message={err} /></>;
}

function TestSend({ channel }: { channel: "EMAIL" | "SMS" }) {
  const [to, setTo] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-6 border-t border-reed pt-4">
      <p className="mb-2 font-medium">Send a test {channel === "EMAIL" ? "email" : "SMS"}</p>
      <div className="flex max-w-lg gap-2">
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === "EMAIL" ? "you@example.com" : "01012345678"} dir="ltr" className="field" aria-label="Test recipient" />
        <button className="btn-quiet" onClick={async () => { try { await api("/notifications/test", { method: "POST", json: { channel, to } }); setMsg("Queued. Check the Logs tab in a few seconds."); } catch (e) { setMsg(errorText(e)); } }}>Send test</button>
      </div>
      {msg && <p className="mt-2 text-silt-soft">{msg}</p>}
    </div>
  );
}

function EmailSettings() {
  const { data, loading, reload } = useFetch<{ data: { enabled: boolean; provider: string; fromEmail: string; fromName: string; staffRecipients: string[]; apiKeySet: boolean; apiKeyHint: string | null } }>("/email-config");
  const [ok, setOk] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  if (loading || !data) return <Loading />;
  const c = data.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); setOk(null); setErr(null);
    try {
      await api("/email-config", { method: "POST", json: {
        enabled: fd.get("enabled") === "on", provider: fd.get("provider"), fromEmail: fd.get("fromEmail"), fromName: fd.get("fromName"),
        staffRecipients: String(fd.get("staff")).split(/[,\s]+/).filter(Boolean), ...(fd.get("apiKey") ? { apiKey: fd.get("apiKey") } : {}),
      } });
      setOk("Email settings saved."); await reload();
    } catch (x) { setErr(errorText(x)); }
  }
  return (
    <form onSubmit={save} className="panel max-w-2xl space-y-4 p-5">
      <Notice ok={ok} err={err} />
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Send emails</label>
      <div><label className="label" htmlFor="e-p">Provider</label><select id="e-p" name="provider" defaultValue={c.provider} className="field"><option value="sendgrid">SendGrid</option><option value="log">Don't send — write to server log (testing)</option></select></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="e-f">From address (verified in SendGrid)</label><input id="e-f" name="fromEmail" type="email" required defaultValue={c.fromEmail} dir="ltr" className="field" /></div>
        <div><label className="label" htmlFor="e-n">From name</label><input id="e-n" name="fromName" required defaultValue={c.fromName} className="field" /></div>
      </div>
      <div><label className="label" htmlFor="e-s">Staff who receive new inquiries and submissions</label><input id="e-s" name="staff" defaultValue={c.staffRecipients.join(", ")} dir="ltr" placeholder="sales@brookrege.com, owner@brookrege.com" className="field" /></div>
      <div><label className="label" htmlFor="e-k">SendGrid API key {c.apiKeySet && <span className="text-silt-soft">— saved ({c.apiKeyHint}); leave empty to keep it</span>}</label><input id="e-k" name="apiKey" type="password" autoComplete="off" dir="ltr" className="field" /></div>
      <button className="btn-primary">Save email settings</button>
      <TestSend channel="EMAIL" />
    </form>
  );
}

function SmsSettings() {
  const { data, loading, reload } = useFetch<{ data: { enabled: boolean; provider: string; accountSid?: string; fromNumber?: string; messagingServiceSid?: string; customerAcknowledgements: boolean; authTokenSet: boolean; authTokenHint: string | null } }>("/sms-config");
  const [ok, setOk] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  if (loading || !data) return <Loading />;
  const c = data.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); setOk(null); setErr(null);
    try {
      await api("/sms-config", { method: "POST", json: {
        enabled: fd.get("enabled") === "on", provider: fd.get("provider"), customerAcknowledgements: fd.get("ack") === "on",
        accountSid: fd.get("sid"), fromNumber: fd.get("from"), messagingServiceSid: fd.get("mg"), ...(fd.get("token") ? { authToken: fd.get("token") } : {}),
      } });
      setOk("SMS settings saved."); await reload();
    } catch (x) { setErr(errorText(x)); }
  }
  return (
    <form onSubmit={save} className="panel max-w-2xl space-y-4 p-5">
      <Notice ok={ok} err={err} />
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Send SMS</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="ack" defaultChecked={c.customerAcknowledgements} /> Text customers to confirm we received their inquiry or property details</label>
      <div><label className="label" htmlFor="s-p">Provider</label><select id="s-p" name="provider" defaultValue={c.provider} className="field"><option value="twilio">Twilio</option><option value="log">Don't send — write to server log (testing)</option></select></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="s-sid">Account SID</label><input id="s-sid" name="sid" defaultValue={c.accountSid ?? ""} dir="ltr" className="field" placeholder="AC…" /></div>
        <div><label className="label" htmlFor="s-t">Auth token {c.authTokenSet && <span className="text-silt-soft">— saved ({c.authTokenHint})</span>}</label><input id="s-t" name="token" type="password" autoComplete="off" dir="ltr" className="field" /></div>
        <div><label className="label" htmlFor="s-f">Sender (number or approved sender ID)</label><input id="s-f" name="from" defaultValue={c.fromNumber ?? ""} dir="ltr" className="field" placeholder="Brookrege" /></div>
        <div><label className="label" htmlFor="s-mg">Messaging Service SID (optional, preferred)</label><input id="s-mg" name="mg" defaultValue={c.messagingServiceSid ?? ""} dir="ltr" className="field" placeholder="MG…" /></div>
      </div>
      <p className="text-xs text-silt-soft">Egypt requires a registered alphanumeric sender ID for delivery to local networks — register it in Twilio before going live. Arabic messages use 70 characters per SMS segment.</p>
      <button className="btn-primary">Save SMS settings</button>
      <TestSend channel="SMS" />
    </form>
  );
}

interface Template { id: string; key: string; channel: "EMAIL" | "SMS"; locale: string; subject: string | null; body: string; isActive: boolean; variables: string[] }
function Templates() {
  const { data, loading, reload } = useFetch<{ data: Template[] }>("/notifications/templates");
  const [editing, setEditing] = useState<Template | null>(null);
  const [preview, setPreview] = useState<{ subject: string | null; body: string; missing: string[]; sms: { segments: number; encoding: string } | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (loading || !data) return <Loading />;
  const sample = (vars: string[]) => Object.fromEntries(vars.map((v) => [v, v === "name" || v === "ownerName" ? "أحمد" : v === "propertyTitle" ? "شقة ٣ غرف في رتاج" : `[${v}]`]));
  async function doPreview(t: Template) {
    const r = await api<{ data: typeof preview }>("/notifications/templates/preview", { method: "POST", json: { subject: t.subject ?? undefined, body: t.body, channel: t.channel, vars: sample(t.variables) } });
    setPreview(r.data);
  }
  async function save() {
    if (!editing) return; setErr(null);
    try { await api(`/notifications/templates/${editing.id}`, { method: "PUT", json: { subject: editing.subject, body: editing.body, isActive: editing.isActive } }); setEditing(null); setPreview(null); await reload(); }
    catch (e) { setErr(errorText(e)); }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <ul className="panel divide-y divide-reed">
        {data.data.map((t) => (
          <li key={t.id}><button onClick={() => { setEditing({ ...t }); void doPreview(t); }} className={`w-full px-4 py-3 text-start hover:bg-limestone ${editing?.id === t.id ? "bg-palm-tint" : ""}`}>
            <span className="font-medium">{t.key.replace(/_/g, " ")}</span>
            <span className="block text-xs text-silt-soft">{t.channel} · {t.locale === "ar" ? "Arabic" : "English"}{t.isActive ? "" : " · off"}</span>
          </button></li>
        ))}
      </ul>
      {editing ? (
        <div className="panel space-y-4 p-5">
          <ErrorNote message={err} />
          <p className="text-xs text-silt-soft">Placeholders: {editing.variables.map((v) => `{{${v}}}`).join(" ") || "none"}</p>
          {editing.channel === "EMAIL" && <div><label className="label" htmlFor="t-s">Subject</label><input id="t-s" dir={editing.locale === "ar" ? "rtl" : "ltr"} value={editing.subject ?? ""} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} className="field" /></div>}
          <div><label className="label" htmlFor="t-b">Message</label><textarea id="t-b" dir={editing.locale === "ar" ? "rtl" : "ltr"} rows={8} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} onBlur={() => void doPreview(editing)} className="field h-auto py-2" /></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Send this message</label>
          {preview && (
            <div className="rounded-md bg-limestone p-3 text-sm" dir={editing.locale === "ar" ? "rtl" : "ltr"}>
              <p className="mb-1 text-xs text-silt-soft" dir="ltr">Preview with sample data{preview.sms ? ` · ${preview.sms.segments} SMS segment(s), ${preview.sms.encoding}` : ""}{preview.missing.length ? ` · unknown: ${preview.missing.join(", ")}` : ""}</p>
              {preview.subject && <p className="font-medium">{preview.subject}</p>}
              <p className="whitespace-pre-line">{preview.body}</p>
            </div>
          )}
          <button onClick={save} className="btn-primary">Save template</button>
        </div>
      ) : <Empty>Choose a message to edit.</Empty>}
    </div>
  );
}

interface Log { id: string; channel: string; recipient: string; templateKey: string | null; subject: string | null; status: "SENT" | "FAILED" | "SKIPPED"; provider: string; error: string | null; createdAt: string }
function Logs() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("");
  const { data, loading, error } = useFetch<{ data: Log[]; meta: { pageCount: number } }>(`/notifications/logs?page=${page}${status ? `&status=${status}` : ""}`);
  const tone = { SENT: "text-palm-dark", FAILED: "text-red-700", SKIPPED: "text-silt-soft" };
  return (
    <>
      <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="field mb-4 w-48" aria-label="Filter by status"><option value="">All</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="SKIPPED">Skipped</option></select>
      {loading ? <Loading /> : error ? <ErrorNote message={error} /> : !data?.data.length ? <Empty>No messages yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="w-full min-w-[720px]">
          <thead><tr><th className="th">When</th><th className="th">To</th><th className="th">Message</th><th className="th">Result</th></tr></thead>
          <tbody>{data.data.map((l) => (
            <tr key={l.id}><td className="td whitespace-nowrap">{fmtDateTime(l.createdAt)}</td><td className="td" dir="ltr">{l.channel === "SMS" ? "SMS " : ""}{l.recipient}</td>
              <td className="td">{l.subject ?? l.templateKey}</td>
              <td className={`td ${tone[l.status]}`}>{l.status.toLowerCase()} <span className="text-xs text-silt-soft">via {l.provider}</span>{l.error && <p className="text-xs">{l.error.slice(0, 160)}</p>}</td></tr>
          ))}</tbody></table></div>
      )}
      <Pager page={page} pageCount={data?.meta.pageCount ?? 1} onPage={setPage} />
    </>
  );
}

function Queue() {
  const { data, loading, reload } = useFetch<{ data: { counts: Record<string, number>; failed: { id: string; type: string; attempts: number; lastError: string | null; finishedAt: string }[] } }>("/jobs");
  if (loading || !data) return <Loading />;
  const c = data.data.counts;
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-4">{["QUEUED", "RUNNING", "DONE", "FAILED"].map((s) => <div key={s} className="panel p-4"><p className="text-silt-soft">{s.toLowerCase()}</p><p className="text-2xl font-semibold">{c[s] ?? 0}</p></div>)}</div>
      {data.data.failed.length ? (
        <div className="panel overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Failed job</th><th className="th">Error</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.data.failed.map((j) => <tr key={j.id}><td className="td">{j.type.replace(/_/g, " ")}<p className="text-xs text-silt-soft">{fmtDateTime(j.finishedAt)} · {j.attempts} attempts</p></td><td className="td text-xs">{j.lastError}</td>
            <td className="td text-end"><button onClick={async () => { await api(`/jobs/${j.id}/retry`, { method: "POST" }); await reload(); }} className="text-palm hover:underline">Retry</button></td></tr>)}</tbody></table></div>
      ) : <Empty>No failed jobs.</Empty>}
    </>
  );
}

export default function NotificationsPage() {
  const [tab, setTab] = useState<Tab>("email");
  return (
    <>
      <PageHeader title="Notifications">Emails and text messages sent automatically. Messages are sent in the background and retried if a provider is briefly unavailable.</PageHeader>
      <Tabs value={tab} onChange={setTab} items={[{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }, { value: "templates", label: "Messages" }, { value: "logs", label: "Delivery log" }, { value: "queue", label: "Background jobs" }]} />
      {tab === "email" ? <EmailSettings /> : tab === "sms" ? <SmsSettings /> : tab === "templates" ? <Templates /> : tab === "logs" ? <Logs /> : <Queue />}
    </>
  );
}
