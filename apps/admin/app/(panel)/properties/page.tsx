"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PROPERTY_TYPE_LABELS, daysUntilExpiry, formatEGP, type ListingStatus, type PropertyType } from "@brookrege/domain";
import { Empty, ErrorNote, Loading, PageHeader, Pager, Tabs } from "@/components/ui";
import { fmtDate, STATUS_LABEL, STATUS_STYLE } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

interface Row {
  id: string; title: string; type: PropertyType; transaction: "SALE" | "RENT"; status: ListingStatus; price: number;
  expiresAt: string | null; updatedAt: string; region: { name: string }; compound: { name: string } | null;
  _count: { inquiries: number; media: number };
}

type View = "all" | "ACTIVE" | "expiring" | "DRAFT" | "EXPIRED" | "SOLD";
const views: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Live" },
  { value: "expiring", label: "Expiring soon" },
  { value: "DRAFT", label: "Drafts" },
  { value: "EXPIRED", label: "Expired" },
  { value: "SOLD", label: "Sold" },
];

function ListingsTable() {
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useSession();
  const initial = (sp.get("view") ?? sp.get("status") ?? "all") as View;
  const [view, setView] = useState<View>(views.some((v) => v.value === initial) ? initial : "all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const qs = new URLSearchParams({ page: String(page) });
  if (view === "expiring") qs.set("expiringInDays", "14");
  else if (view !== "all") qs.set("status", view);
  if (search) qs.set("q", search);
  const { data, error, loading } = useFetch<{ data: Row[]; meta: { total: number; pageCount: number } }>(`/properties?${qs}`);

  function changeView(v: View) {
    setView(v);
    setPage(1);
    router.replace(v === "all" ? "/properties" : `/properties?view=${v}`);
  }

  return (
    <>
      <PageHeader title="Listings" actions={can("property:write") && <Link href="/properties/new" className="btn-primary">Add listing</Link>}>
        Expired listings are hidden from the public site but stay here so you can renew them.
      </PageHeader>
      <Tabs value={view} onChange={changeView} items={views} />
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); }} className="mb-4 flex max-w-md gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or address" className="field" aria-label="Search listings" />
        <button className="btn-quiet">Search</button>
      </form>
      {loading ? <Loading /> : error ? <ErrorNote message={error} /> : !data?.data.length ? (
        <Empty>No listings here yet.</Empty>
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr><th className="th">Listing</th><th className="th">Price</th><th className="th">Status</th><th className="th">Expires</th><th className="th">Leads</th></tr></thead>
              <tbody>
                {data.data.map((r) => {
                  const days = r.status === "ACTIVE" ? daysUntilExpiry(r.expiresAt ? new Date(r.expiresAt) : null) : null;
                  return (
                    <tr key={r.id} className="hover:bg-limestone/50">
                      <td className="td">
                        <Link href={`/properties/${r.id}`} className="font-medium hover:text-palm">{r.title}</Link>
                        <p className="text-xs text-silt-soft">
                          {PROPERTY_TYPE_LABELS[r.type]}, {r.transaction === "RENT" ? "rent" : "sale"}, {r.compound ? `${r.compound.name}, ` : ""}{r.region.name}
                          {r._count.media === 0 && <span className="text-amber-700"> — no photos</span>}
                        </p>
                      </td>
                      <td className="td whitespace-nowrap">{formatEGP(r.price)}</td>
                      <td className="td"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td className="td whitespace-nowrap">
                        {fmtDate(r.expiresAt)}
                        {days != null && days <= 14 && <p className="text-xs text-amber-700">in {days} {days === 1 ? "day" : "days"}</p>}
                      </td>
                      <td className="td">{r._count.inquiries}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-silt-soft">{data.meta.total} listings</p>
          <Pager page={page} pageCount={data.meta.pageCount} onPage={setPage} />
        </>
      )}
    </>
  );
}

export default function PropertiesPage() {
  return <Suspense><ListingsTable /></Suspense>;
}
