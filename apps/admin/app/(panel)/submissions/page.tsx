"use client";

import Link from "next/link";
import { useState } from "react";
import { PROPERTY_TYPE_LABELS, type PropertyType } from "@brookrege/domain";
import { Empty, ErrorNote, Loading, PageHeader, Pager, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDateTime } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

const STATUSES = ["NEW", "REVIEWED", "CONVERTED", "REJECTED"] as const;
type Status = (typeof STATUSES)[number];
const LABEL: Record<Status, string> = { NEW: "New", REVIEWED: "Contacted", CONVERTED: "Listed", REJECTED: "Not suitable" };

interface Submission { id: string; ownerName: string; phone: string; propertyType: PropertyType | null; transaction: "SALE" | "RENT" | null; location: string | null; details: string | null; status: Status; createdAt: string }

export default function SubmissionsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Status>("NEW");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const { data, error, loading, reload } = useFetch<{ data: Submission[]; meta: { pageCount: number } }>(`/submissions?status=${tab}&page=${page}`);

  async function setStatus(id: string, status: Status) {
    setErr(null);
    try {
      await api(`/submissions/${id}`, { method: "PATCH", json: { status } });
      await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <>
      <PageHeader title="Property submissions" actions={can("property:write") && <Link href="/properties/new" className="btn-primary">Add listing</Link>}>
        Owners who used &ldquo;Add your property&rdquo; on the website. Call them, then create the listing.
      </PageHeader>
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={STATUSES.map((s) => ({ value: s, label: LABEL[s] }))} />
      <ErrorNote message={err} />
      {loading ? <Loading /> : error ? <ErrorNote message={error} /> : !data?.data.length ? <Empty>Nothing here.</Empty> : (
        <ul className="space-y-3">
          {data.data.map((s) => (
            <li key={s.id} className="panel flex flex-wrap items-start justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{s.ownerName} <a href={`tel:${s.phone}`} className="ms-2 font-normal text-palm hover:underline">{s.phone}</a></p>
                <p className="text-xs text-silt-soft">
                  {fmtDateTime(s.createdAt)}
                  {s.transaction && `, wants to ${s.transaction === "SALE" ? "sell" : "rent out"}`}
                  {s.propertyType && ` ${PROPERTY_TYPE_LABELS[s.propertyType].toLowerCase()}`}
                  {s.location && ` in ${s.location}`}
                </p>
                {s.details && <p className="mt-2 max-w-prose whitespace-pre-line">{s.details}</p>}
              </div>
              <select aria-label="Submission status" value={s.status} disabled={!can("submission:write")} onChange={(e) => setStatus(s.id, e.target.value as Status)} className="field w-40">
                {STATUSES.map((x) => <option key={x} value={x}>{LABEL[x]}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} pageCount={data?.meta.pageCount ?? 1} onPage={setPage} />
    </>
  );
}
