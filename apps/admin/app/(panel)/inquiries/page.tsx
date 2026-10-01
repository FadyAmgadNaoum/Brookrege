"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Pager, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDateTime } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

const STATUSES = ["NEW", "CONTACTED", "VIEWING", "OFFERED", "CLOSED", "SPAM"] as const;
type Status = (typeof STATUSES)[number];
const LABEL: Record<Status, string> = { NEW: "New", CONTACTED: "Contacted", VIEWING: "Viewing booked", OFFERED: "Offer made", CLOSED: "Closed", SPAM: "Spam" };

interface Inquiry { id: string; name: string; phone: string; email: string | null; message: string | null; status: Status; staffNote: string | null; createdAt: string; property: { id: string; title: string } | null }

export default function InquiriesPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Status | "ALL">("NEW");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page) });
  if (tab !== "ALL") qs.set("status", tab);
  const { data, error, loading, reload } = useFetch<{ data: Inquiry[]; meta: { pageCount: number } }>(`/inquiries?${qs}`);

  async function update(id: string, patch: Partial<Pick<Inquiry, "status" | "staffNote">>) {
    setErr(null);
    try {
      await api(`/inquiries/${id}`, { method: "PATCH", json: patch });
      await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <>
      <PageHeader title="Inquiries">People who asked to be called about a listing. Move each one along as you follow up.</PageHeader>
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[...STATUSES.map((s) => ({ value: s, label: LABEL[s] })), { value: "ALL" as const, label: "All" }]} />
      <ErrorNote message={err} />
      {loading ? <Loading /> : error ? <ErrorNote message={error} /> : !data?.data.length ? <Empty>No inquiries in this list.</Empty> : (
        <ul className="space-y-3">
          {data.data.map((i) => (
            <li key={i.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{i.name} <a href={`tel:${i.phone}`} className="ms-2 font-normal text-palm hover:underline">{i.phone}</a></p>
                  <p className="text-xs text-silt-soft">
                    {fmtDateTime(i.createdAt)}{i.property && <>, about <Link href={`/properties/${i.property.id}`} className="text-palm hover:underline">{i.property.title}</Link></>}
                  </p>
                  {i.message && <p className="mt-2 max-w-prose whitespace-pre-line">{i.message}</p>}
                </div>
                <select aria-label="Inquiry status" value={i.status} disabled={!can("inquiry:write")} onChange={(e) => update(i.id, { status: e.target.value as Status })} className="field w-44">
                  {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                </select>
              </div>
              {can("inquiry:write") && (
                <textarea
                  aria-label="Staff note"
                  defaultValue={i.staffNote ?? ""}
                  placeholder="Add a note for the team (saved when you click away)"
                  rows={2}
                  onBlur={(e) => e.target.value !== (i.staffNote ?? "") && update(i.id, { staffNote: e.target.value || null })}
                  className="field mt-3 h-auto py-2"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} pageCount={data?.meta.pageCount ?? 1} onPage={setPage} />
    </>
  );
}
