"use client";

import { useState } from "react";
import { pickVariant, type Variants } from "@brookrege/domain";
import { DropZone } from "@/components/DropZone";
import { Empty, ErrorNote, Loading, PageHeader, Pager, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDate } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

interface Asset {
  id: string; kind: "IMAGE" | "VIDEO"; status: "PROCESSING" | "READY" | "FAILED"; url: string; variants: Variants | null; posterUrl: string | null;
  originalName: string; alt: string | null; bytes: number; width: number | null; height: number | null; durationSec: number | null; createdAt: string; deletedAt: string | null;
  _count: { usages: number }; usages: { property: { id: string; title: string } }[];
}
type View = "all" | "IMAGE" | "VIDEO" | "unused" | "deleted";
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

export default function MediaLibraryPage() {
  const { can } = useSession();
  const [view, setView] = useState<View>("all");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page) });
  if (view === "IMAGE" || view === "VIDEO") qs.set("kind", view);
  if (view === "unused") qs.set("unused", "true");
  if (view === "deleted") qs.set("deleted", "true");
  const { data, error, loading, reload } = useFetch<{ data: Asset[]; meta: { total: number; pageCount: number } }>(`/media?${qs}`);

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr(errorText(e)); }
  }
  const remove = (a: Asset) => {
    const force = a._count.usages > 0;
    if (!confirm(force ? `This file is used in ${a._count.usages} listing(s). Delete it everywhere?` : "Delete this file? You can restore it for 30 days.")) return;
    void act(() => api(`/media/${a.id}${force ? "?force=true" : ""}`, { method: "DELETE" }));
  };
  const editAlt = (a: Asset) => {
    const alt = prompt("Describe this photo for screen readers and search engines (e.g. \"Living room with balcony\")", a.alt ?? "");
    if (alt !== null) void act(() => api(`/media/${a.id}`, { method: "PATCH", json: { alt: alt.trim() || null } }));
  };

  return (
    <>
      <PageHeader title="Media library">Every photo and video uploaded to the site. Unused uploads are cleared after 7 days; deleted files can be restored for 30 days.</PageHeader>
      {can("media:write") && <div className="mb-6"><DropZone path="/media/upload" onDone={() => { setView("all"); setPage(1); void reload(); }} /></div>}
      <Tabs value={view} onChange={(v) => { setView(v); setPage(1); }} items={[
        { value: "all", label: "All" }, { value: "IMAGE", label: "Photos" }, { value: "VIDEO", label: "Videos" }, { value: "unused", label: "Not used" }, { value: "deleted", label: "Deleted" },
      ]} />
      <ErrorNote message={err} />
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data?.data.length ? <Empty>No files here.</Empty> : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data.data.map((a) => {
              const thumb = pickVariant(a.variants, 480);
              return (
                <li key={a.id} className="panel overflow-hidden">
                  <div className="relative aspect-[4/3] bg-limestone">
                    {thumb ? <img src={thumb} alt={a.alt ?? ""} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-silt-soft">{a.status === "PROCESSING" ? "Preparing video…" : a.status === "FAILED" ? "No preview" : ""}</div>}
                    {a.kind === "VIDEO" && <span className="absolute start-2 top-2 rounded bg-silt/80 px-1.5 py-0.5 text-[11px] text-white">Video{a.durationSec ? ` · ${Math.round(a.durationSec)}s` : ""}</span>}
                  </div>
                  <div className="space-y-1 p-2.5 text-xs">
                    <p className="truncate font-medium" title={a.originalName}>{a.originalName}</p>
                    <p className="text-silt-soft">{size(a.bytes)}{a.width ? ` · ${a.width}×${a.height}` : ""} · {fmtDate(a.createdAt)}</p>
                    <p className={a._count.usages ? "text-palm-dark" : "text-amber-700"}>{a._count.usages ? `In ${a._count.usages} listing${a._count.usages > 1 ? "s" : ""}` : "Not used"}</p>
                    {can("media:write") && (
                      <div className="flex gap-3 pt-1">
                        {a.deletedAt
                          ? <button onClick={() => act(() => api(`/media/${a.id}/restore`, { method: "POST" }))} className="text-palm hover:underline">Restore</button>
                          : <>
                              <button onClick={() => editAlt(a)} className="text-palm hover:underline">{a.alt ? "Edit description" : "Add description"}</button>
                              <button onClick={() => remove(a)} className="text-red-700 hover:underline">Delete</button>
                            </>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-silt-soft">{data.meta.total} files</p>
          <Pager page={page} pageCount={data.meta.pageCount} onPage={setPage} />
        </>
      )}
    </>
  );
}
