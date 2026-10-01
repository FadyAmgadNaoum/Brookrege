"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { daysUntilExpiry, pickVariant, type ListingStatus, type Variants } from "@brookrege/domain";
import { DropZone } from "@/components/DropZone";
import { LibraryPicker } from "@/components/LibraryPicker";
import { ErrorNote, Loading, PageHeader } from "@/components/ui";
import { PropertyForm, type PropertyValues } from "@/components/PropertyForm";
import { api, errorText } from "@/lib/api";
import { fmtDate, STATUS_LABEL, STATUS_STYLE } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

interface Media { id: string; url: string; isCover: boolean; asset: { kind: "IMAGE" | "VIDEO"; status: string; variants: Variants | null; posterUrl: string | null } | null }
interface Detail extends PropertyValues {
  id: string; status: ListingStatus; listedAt: string | null; expiresAt: string | null; viewCount: number;
  media: Media[]; createdBy: { name: string } | null; updatedBy: { name: string } | null; updatedAt: string;
}

type Action = "publish" | "renew" | "expire" | "mark_sold" | "archive" | "unpublish";
const ACTIONS: Record<ListingStatus, { action: Action; label: string; tone?: "primary" | "danger" }[]> = {
  DRAFT: [{ action: "publish", label: "Publish for 3 months", tone: "primary" }],
  ACTIVE: [{ action: "renew", label: "Renew for 3 months" }, { action: "mark_sold", label: "Mark as sold" }, { action: "expire", label: "Take offline now", tone: "danger" }],
  EXPIRED: [{ action: "renew", label: "Renew for 3 months", tone: "primary" }, { action: "archive", label: "Archive" }],
  SOLD: [{ action: "archive", label: "Archive" }],
  ARCHIVED: [{ action: "unpublish", label: "Move back to drafts" }],
};

export default function EditPropertyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data, error, loading, reload } = useFetch<{ data: Detail }>(`/properties/${id}`);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Listing not found."} />;
  const p = data.data;
  const days = p.status === "ACTIVE" && p.expiresAt ? daysUntilExpiry(new Date(p.expiresAt)) : null;

  async function run(action: Action) {
    if (action === "expire" && !confirm("Take this listing offline now? It will be hidden from the public site.")) return;
    setActionError(null);
    try {
      await api(`/properties/${id}/lifecycle`, { method: "POST", json: { action } });
      setNotice(action === "renew" || action === "publish" ? "Listing is live for the next 3 months." : "Status updated.");
      await reload();
    } catch (e) {
      setActionError(errorText(e));
    }
  }

  async function mediaAction(mediaId: string, kind: "cover" | "delete") {
    if (kind === "delete" && !confirm("Remove this from the listing? It stays in the media library.")) return;
    try {
      await api(`/properties/${id}/media/${mediaId}${kind === "cover" ? "/cover" : ""}`, { method: kind === "cover" ? "POST" : "DELETE" });
      await reload();
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  async function remove() {
    if (!confirm("Delete this listing? It will be removed from the site and the admin list. The activity log keeps a record.")) return;
    try {
      await api(`/properties/${id}`, { method: "DELETE" });
      router.replace("/properties");
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  return (
    <>
      <Link href="/properties" className="text-silt-soft hover:text-silt">Listings</Link>
      <PageHeader title={p.title}>
        <span className={`me-2 rounded px-2 py-0.5 text-xs ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
        {p.status === "ACTIVE" && <>Live until {fmtDate(p.expiresAt)}{days != null && ` (${days} days left)`}. </>}
        {p.viewCount} views. Last edited by {p.updatedBy?.name ?? "system"} on {fmtDate(p.updatedAt)}.
      </PageHeader>

      {notice && <p role="status" className="mb-4 rounded-md border border-palm/30 bg-palm-tint px-4 py-3 text-palm-dark">{notice}</p>}
      <ErrorNote message={actionError} />

      {can("property:lifecycle") && (
        <section className="panel mb-6 flex flex-wrap items-center gap-2 p-4">
          <span className="me-2 font-medium">Status</span>
          {ACTIONS[p.status].map((a) => (
            <button key={a.action} onClick={() => run(a.action)} className={a.tone === "primary" ? "btn-primary" : a.tone === "danger" ? "btn-danger" : "btn-quiet"}>{a.label}</button>
          ))}
        </section>
      )}

      <section className="panel mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Photos and video</h2>
          {can("property:write") && <button onClick={() => setPicking((x) => !x)} className="btn-quiet">{picking ? "Close library" : "Add from media library"}</button>}
        </div>
        {can("property:write") && (
          <div className="mb-4 space-y-4">
            <DropZone compact path={`/properties/${id}/media`} onDone={() => void reload()} />
            {picking && <LibraryPicker propertyId={id} onAdded={() => { setPicking(false); void reload(); }} />}
          </div>
        )}
        {p.media.length === 0 ? (
          <p className="text-silt-soft">No photos yet. Listings with photos get far more inquiries.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {p.media.map((m) => {
              const thumb = pickVariant(m.asset?.variants, 480) ?? (m.asset?.kind === "VIDEO" ? undefined : m.url);
              return (
                <li key={m.id} className="overflow-hidden rounded-md border border-reed">
                  <div className="relative aspect-[4/3] bg-limestone">
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-silt-soft">Preparing video…</div>}
                    {m.asset?.kind === "VIDEO" && <span className="absolute start-1.5 top-1.5 rounded bg-silt/80 px-1.5 py-0.5 text-[11px] text-white">Video</span>}
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                    {m.isCover ? <span className="font-medium text-palm-dark">Cover photo</span> : can("property:write") && m.asset?.kind !== "VIDEO" ? <button onClick={() => mediaAction(m.id, "cover")} className="text-palm hover:underline">Make cover</button> : <span />}
                    {can("property:write") && <button onClick={() => mediaAction(m.id, "delete")} className="text-red-700 hover:underline">Remove</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {can("property:write") ? (
        <PropertyForm
          initial={p}
          submitLabel="Save changes"
          onSubmit={async ({ publish: _p, ...values }) => {
            await api(`/properties/${id}`, { method: "PATCH", json: values });
            setNotice("Changes saved.");
            await reload();
          }}
        />
      ) : (
        <p className="text-silt-soft">You can view this listing but not edit its details.</p>
      )}

      {can("property:delete") && (
        <div className="mt-10 border-t border-reed pt-6">
          <button onClick={remove} className="btn-danger">Delete listing</button>
        </div>
      )}
    </>
  );
}
