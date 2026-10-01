"use client";

import { useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PROPERTY_TYPE_LABELS, formatEGP, type PropertyType } from "@brookrege/domain";
import { ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api, download, errorText } from "@/lib/api";
import { fmtDate } from "@/lib/labels";
import { useFetch } from "@/lib/useFetch";

interface Kpi { value: number | null; previous: number | null; change: number | null }
interface Dash {
  range: { from: string; to: string; days: number };
  kpis: Record<"liveListings" | "views" | "inquiries" | "conversionRate" | "newListings" | "soldListings" | "submissions" | "medianResponseHours", Kpi>;
  series: { views: { day: string; value: number }[]; inquiries: { day: string; value: number }[] };
  byType: { type: PropertyType; live: number; inquiries: number }[];
  topListings: { id: string; title: string; views: number; inquiries: number; price: number }[];
}
interface Schedule { id: string; report: string; frequency: "WEEKLY" | "MONTHLY"; format: string; recipients: string[]; nextRunAt: string; lastRunAt: string | null }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }, { label: "12 months", days: 365 }];
const REPORTS = [{ v: "overview", l: "Overview" }, { v: "properties", l: "Listings" }, { v: "inquiries", l: "Inquiries" }, { v: "team", l: "Team activity" }];
// Chart colours = the brand tokens (palm, sandstone).
const PALM = "#41594F", SAND = "#A8875A";

function KpiCard({ label, k, fmt = (n: number) => n.toLocaleString("en-US"), invert = false, hint }: { label: string; k: Kpi; fmt?: (n: number) => string; invert?: boolean; hint?: string }) {
  const good = k.change == null ? null : invert ? k.change < 0 : k.change > 0;
  return (
    <div className="panel p-4">
      <p className="text-silt-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{k.value == null ? "—" : fmt(k.value)}</p>
      {k.change != null && k.change !== 0 && (
        <p className={`text-xs ${good ? "text-palm-dark" : "text-red-700"}`}>{k.change > 0 ? "▲" : "▼"} {Math.abs(k.change)}% vs previous period</p>
      )}
      {k.change === 0 && <p className="text-xs text-silt-soft">No change vs previous period</p>}
      {hint && <p className="mt-1 text-xs text-silt-soft">{hint}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(iso(today));
  const [exporting, setExporting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data, error, loading } = useFetch<{ data: Dash }>(`/analytics/dashboard?from=${from}&to=${to}`);
  const schedules = useFetch<{ data: Schedule[] }>("/reports/schedules");

  const preset = (days: number) => { setTo(iso(today)); setFrom(iso(new Date(today.getTime() - (days - 1) * 86_400_000))); };
  async function exportReport(report: string, format: "csv" | "xlsx") {
    setErr(null); setExporting(`${report}-${format}`);
    try { await download("/reports/generate", { report, format, from, to }, `brookrege-${report}-${from}_${to}.${format}`); }
    catch (e) { setErr(errorText(e)); } finally { setExporting(null); }
  }
  async function addSchedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form); setErr(null);
    try {
      await api("/reports/schedules", { method: "POST", json: { report: fd.get("report"), frequency: fd.get("frequency"), format: fd.get("format"), recipients: String(fd.get("recipients")).split(/[,\s]+/).filter(Boolean) } });
      form.reset(); await schedules.reload();
    } catch (x) { setErr(errorText(x)); }
  }

  const d = data?.data;
  const series = d?.series.views.map((v, i) => ({ day: v.day.slice(5), views: v.value, inquiries: d.series.inquiries[i]?.value ?? 0 })) ?? [];

  return (
    <div className="analytics">
      <PageHeader title="Analytics" actions={<button onClick={() => window.print()} className="btn-quiet print:hidden">Print / save as PDF</button>}>
        {d ? `${fmtDate(d.range.from)} – ${fmtDate(d.range.to)} (${d.range.days} days), compared with the ${d.range.days} days before.` : "Listing performance and team activity."}
      </PageHeader>

      <div className="panel mb-6 flex flex-wrap items-end gap-3 p-4 print:hidden">
        {PRESETS.map((p) => <button key={p.days} onClick={() => preset(p.days)} className="btn-quiet">{p.label}</button>)}
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="field" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" value={to} min={from} max={iso(today)} onChange={(e) => setTo(e.target.value)} className="field" /></div>
      </div>

      <ErrorNote message={err} />
      {loading && !d ? <Loading /> : error ? <ErrorNote message={error} /> : d && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Listing views" k={d.kpis.views} />
            <KpiCard label="Inquiries" k={d.kpis.inquiries} />
            <KpiCard label="Inquiries per 100 views" k={d.kpis.conversionRate} fmt={(n) => n.toFixed(1)} />
            <KpiCard label="Median time to first response" k={d.kpis.medianResponseHours} fmt={(n) => `${n} h`} invert hint="From inquiry to first status change" />
            <KpiCard label="Live listings now" k={d.kpis.liveListings} />
            <KpiCard label="New listings published" k={d.kpis.newListings} />
            <KpiCard label="Marked sold" k={d.kpis.soldListings} />
            <KpiCard label="'Add your property' requests" k={d.kpis.submissions} />
          </div>

          <section className="panel mt-6 p-4">
            <h2 className="mb-3 font-semibold">Views and inquiries per day</h2>
            <div className="h-72" role="img" aria-label="Line chart of daily listing views and inquiries">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="#E4E7E1" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="v" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="i" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="v" type="monotone" dataKey="views" name="Views" stroke={PALM} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="i" type="monotone" dataKey="inquiries" name="Inquiries" stroke={SAND} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="panel p-4">
              <h2 className="mb-3 font-semibold">By property type</h2>
              <div className="h-64" role="img" aria-label="Bar chart of live listings and inquiries by property type">
                <ResponsiveContainer>
                  <BarChart data={d.byType.map((t) => ({ ...t, name: PROPERTY_TYPE_LABELS[t.type] ?? t.type }))} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                    <CartesianGrid stroke="#E4E7E1" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip /><Legend />
                    <Bar dataKey="live" name="Live listings" fill={PALM} isAnimationActive={false} />
                    <Bar dataKey="inquiries" name="Inquiries" fill={SAND} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel overflow-x-auto p-4">
              <h2 className="mb-3 font-semibold">Most viewed listings</h2>
              <table className="w-full"><thead><tr><th className="th">Listing</th><th className="th">Views</th><th className="th">Inquiries</th></tr></thead>
                <tbody>{d.topListings.map((t) => <tr key={t.id}><td className="td"><a href={`/properties/${t.id}`} className="hover:text-palm">{t.title}</a><p className="text-xs text-silt-soft">{formatEGP(t.price)}</p></td><td className="td">{t.views}</td><td className="td">{t.inquiries}</td></tr>)}</tbody>
              </table>
            </section>
          </div>
        </>
      )}

      <section className="panel mt-6 p-4 print:hidden">
        <h2 className="mb-1 font-semibold">Export</h2>
        <p className="mb-3 text-silt-soft">For the dates selected above. Excel includes every table; for a PDF use “Print / save as PDF”.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {REPORTS.map((r) => (
            <div key={r.v} className="rounded-md border border-reed p-3">
              <p className="mb-2 font-medium">{r.l}</p>
              <div className="flex gap-2">
                <button onClick={() => exportReport(r.v, "xlsx")} disabled={!!exporting} className="btn-quiet">{exporting === `${r.v}-xlsx` ? "…" : "Excel"}</button>
                <button onClick={() => exportReport(r.v, "csv")} disabled={!!exporting} className="btn-quiet">{exporting === `${r.v}-csv` ? "…" : "CSV"}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel mt-6 p-4 print:hidden">
        <h2 className="mb-1 font-semibold">Scheduled reports</h2>
        <p className="mb-3 text-silt-soft">Emailed automatically: weekly on Sundays or monthly on the 1st, covering the period just ended. Needs email to be set up in Notifications.</p>
        <form onSubmit={addSchedule} className="mb-4 grid gap-3 md:grid-cols-5">
          <select name="report" className="field" aria-label="Report">{REPORTS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
          <select name="frequency" className="field" aria-label="Frequency"><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select>
          <select name="format" className="field" aria-label="Format"><option value="xlsx">Excel</option><option value="csv">CSV</option></select>
          <input name="recipients" required placeholder="owner@example.com, ops@example.com" className="field" aria-label="Recipients" />
          <button className="btn-primary">Add schedule</button>
        </form>
        {schedules.data?.data.length ? (
          <table className="w-full"><thead><tr><th className="th">Report</th><th className="th">Every</th><th className="th">To</th><th className="th">Next</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{schedules.data.data.map((s) => (
              <tr key={s.id}><td className="td">{REPORTS.find((r) => r.v === s.report)?.l} ({s.format})</td><td className="td">{s.frequency === "WEEKLY" ? "Week" : "Month"}</td><td className="td">{s.recipients.join(", ")}</td><td className="td">{fmtDate(s.nextRunAt)}</td>
                <td className="td text-end"><button onClick={async () => { await api(`/reports/schedules/${s.id}`, { method: "DELETE" }); await schedules.reload(); }} className="text-red-700 hover:underline">Stop</button></td></tr>
            ))}</tbody></table>
        ) : <p className="text-silt-soft">No scheduled reports.</p>}
      </section>
    </div>
  );
}
