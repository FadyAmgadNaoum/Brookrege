"use client";

import { useState, type FormEvent } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDateTime } from "@/lib/labels";
import { useFetch } from "@/lib/useFetch";

interface Policy { leadRetentionMonths: number; logRetentionMonths: number }
interface Run { at: string; inquiries: number; submissions: number; notificationLogs: number; auditEntries: number; trigger: string }
interface Overview {
  policy: Policy;
  limits: { leadRetentionMonths: [number, number]; logRetentionMonths: [number, number] };
  lastRun: Run | null;
  counts: { inquiries: number; submissions: number; anonymizedInquiries: number; anonymizedSubmissions: number };
}
interface Found {
  inquiries: { id: string; name: string; phone: string; email: string | null; message: string | null; status: string; createdAt: string; property: { title: string } | null }[];
  submissions: { id: string; ownerName: string; phone: string; location: string | null; details: string | null; status: string; createdAt: string }[];
  notifications: { id: string; channel: string; recipient: string; templateKey: string | null; status: string; createdAt: string }[];
}
type Tab = "requests" | "retention";

function RequestsTab() {
  const [subject, setSubject] = useState<{ phone: string; email: string }>({ phone: "", email: "" });
  const [found, setFound] = useState<Found | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); setDone(null); try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };

  const lookup = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    setFound((await api<{ data: Found }>("/privacy/lookup", { method: "POST", json: subject })).data); setConfirm("");
  }); };

  const download = () => void run(async () => {
    const data = await api<unknown>("/privacy/export", { method: "POST", json: subject });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `brookrege-personal-data-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(url);
    setDone("Export downloaded. Send it to the person through the channel they contacted you from, not to a different address.");
  });

  const erase = () => void run(async () => {
    const r = await api<{ data: Record<string, number> }>("/privacy/erase", { method: "POST", json: { ...subject, confirm } });
    setDone(`Erased: ${r.data.inquiries} inquiries, ${r.data.submissions} property requests, ${r.data.notifications} message records, ${r.data.pendingMessages} unsent messages. Status history is kept without the personal details.`);
    setFound(null); setConfirm("");
  });

  const total = found ? found.inquiries.length + found.submissions.length + found.notifications.length : 0;
  return (
    <>
      <section className="panel p-5">
        <h2 className="font-semibold">Find a person's data</h2>
        <p className="mt-1 text-sm text-silt-soft">When someone asks what we hold about them, for a copy, or to be removed. Check it is really them first — for example, call back the number they gave.</p>
        <form onSubmit={lookup} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor="pp">Phone (any format)</label><input id="pp" dir="ltr" className="field" value={subject.phone} onChange={(e) => setSubject({ ...subject, phone: e.target.value })} placeholder="01012345678" /></div>
          <div><label className="label" htmlFor="pe">Email</label><input id="pe" dir="ltr" type="email" className="field" value={subject.email} onChange={(e) => setSubject({ ...subject, email: e.target.value })} /></div>
          <button className="btn-primary" disabled={busy || (!subject.phone.trim() && !subject.email.trim())}>Search</button>
        </form>
        <div className="mt-3"><ErrorNote message={err} /></div>
        {done && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{done}</p>}
      </section>

      {found && (
        <section className="panel mt-6 p-5">
          <h2 className="font-semibold">Found {total} record{total === 1 ? "" : "s"}</h2>
          {total === 0 ? <Empty>Nothing stored for this phone number or email.</Empty> : (
            <>
              <ul className="mt-3 space-y-2 text-sm">
                {found.inquiries.map((i) => <li key={i.id} className="rounded-md border border-reed p-3"><b>Inquiry</b> · {fmtDateTime(i.createdAt)} · {i.status}{i.property ? ` · ${i.property.title}` : ""}<br />{i.name} · <span dir="ltr">{i.phone}</span>{i.email ? ` · ${i.email}` : ""}{i.message ? <><br /><span className="text-silt-soft">{i.message}</span></> : null}</li>)}
                {found.submissions.map((s) => <li key={s.id} className="rounded-md border border-reed p-3"><b>Property request</b> · {fmtDateTime(s.createdAt)} · {s.status}<br />{s.ownerName} · <span dir="ltr">{s.phone}</span>{s.location ? ` · ${s.location}` : ""}</li>)}
                {found.notifications.map((n) => <li key={n.id} className="rounded-md border border-reed p-3"><b>{n.channel === "SMS" ? "Text message" : "Email"} record</b> · {fmtDateTime(n.createdAt)} · {n.templateKey ?? "—"} · {n.status}</li>)}
              </ul>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" className="btn-quiet" onClick={download} disabled={busy}>Download a copy (JSON)</button>
              </div>
              <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
                <h3 className="font-semibold text-red-800">Erase this person's details</h3>
                <p className="mt-1 text-sm text-red-900">Names, phone numbers, emails, messages and staff notes are removed from every record above, and unsent messages to them are cancelled. The records stay (without personal details) so reports still add up. This can't be undone.</p>
                <label className="mt-3 block text-sm" htmlFor="pc">Type <b>ERASE</b> to confirm</label>
                <div className="mt-1 flex gap-3">
                  <input id="pc" dir="ltr" className="field max-w-40" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                  <button type="button" className="btn-danger" disabled={busy || confirm !== "ERASE"} onClick={erase}>Erase</button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

function RetentionTab({ o, reload }: { o: Overview; reload: () => Promise<void> }) {
  const [p, setP] = useState<Policy>(o.policy);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string>) => { setBusy(true); setErr(null); setMsg(null); try { setMsg(await fn()); await reload(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const save = (e: FormEvent) => { e.preventDefault(); void act(async () => { await api("/privacy/policy", { method: "PUT", json: p }); return "Saved. The next nightly run (04:10) uses the new periods."; }); };
  const runNow = () => void act(async () => {
    const r = (await api<{ data: Run }>("/privacy/retention/run", { method: "POST" })).data;
    return `Done: ${r.inquiries} inquiries and ${r.submissions} property requests anonymized, ${r.notificationLogs} message records deleted, ${r.auditEntries} activity entries cleaned.`;
  });
  const [lMin, lMax] = o.limits.leadRetentionMonths, [gMin, gMax] = o.limits.logRetentionMonths;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel p-4"><p className="text-silt-soft">Inquiries (anonymized)</p><p className="mt-1 text-2xl font-semibold">{o.counts.inquiries} <span className="text-base font-normal text-silt-soft">({o.counts.anonymizedInquiries})</span></p></div>
        <div className="panel p-4"><p className="text-silt-soft">Property requests (anonymized)</p><p className="mt-1 text-2xl font-semibold">{o.counts.submissions} <span className="text-base font-normal text-silt-soft">({o.counts.anonymizedSubmissions})</span></p></div>
      </div>
      <form onSubmit={save} className="panel mt-6 space-y-4 p-5">
        <h2 className="font-semibold">How long we keep personal details</h2>
        <ErrorNote message={err} />
        {msg && <p role="status" className="text-sm text-emerald-800">{msg}</p>}
        <div>
          <label className="label" htmlFor="lr">Leads — remove contact details after this many months without any update</label>
          <input id="lr" type="number" min={lMin} max={lMax} className="field max-w-32" value={p.leadRetentionMonths} onChange={(e) => setP({ ...p, leadRetentionMonths: Number(e.target.value) })} />
          <p className="mt-1 text-sm text-silt-soft">Between {lMin} and {lMax}. Counts and statuses stay, so reports keep working.</p>
        </div>
        <div>
          <label className="label" htmlFor="gr">Message logs and sign-in addresses — delete / blank after (months)</label>
          <input id="gr" type="number" min={gMin} max={gMax} className="field max-w-32" value={p.logRetentionMonths} onChange={(e) => setP({ ...p, logRetentionMonths: Number(e.target.value) })} />
          <p className="mt-1 text-sm text-silt-soft">Between {gMin} and {gMax}. Activity entries stay; only the IP address and browser are removed.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" disabled={busy}>Save</button>
          <button type="button" className="btn-quiet" disabled={busy} onClick={runNow}>Run the clean-up now</button>
        </div>
        <p className="text-sm text-silt-soft">
          {o.lastRun ? <>Last run {fmtDateTime(o.lastRun.at)} ({o.lastRun.trigger === "manual" ? "by hand" : "nightly"}): {o.lastRun.inquiries + o.lastRun.submissions} leads anonymized, {o.lastRun.notificationLogs} message records deleted, {o.lastRun.auditEntries} activity entries cleaned.</> : "The clean-up hasn't run yet. It runs every night at 04:10."}
        </p>
      </form>
    </>
  );
}

export default function PrivacyPage() {
  const [tab, setTab] = useState<Tab>("requests");
  const { data, error, loading, reload } = useFetch<{ data: Overview }>("/privacy/overview");
  return (
    <>
      <PageHeader title="Privacy">Requests from people about their data, and how long personal details are kept.</PageHeader>
      <Tabs value={tab} onChange={setTab} items={[{ value: "requests", label: "Requests" }, { value: "retention", label: "Retention" }]} />
      <div className="mt-6">
        <ErrorNote message={error} />
        {tab === "requests" ? <RequestsTab /> : loading && !data ? <Loading /> : data ? <RetentionTab key={data.data.lastRun?.at ?? "none"} o={data.data} reload={reload} /> : null}
      </div>
    </>
  );
}
