"use client";

import { useState } from "react";
import { pickVariant, type Variants } from "@brookrege/domain";
import { api, errorText } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { ErrorNote, Loading } from "./ui";

interface Asset { id: string; kind: "IMAGE" | "VIDEO"; variants: Variants | null; originalName: string; _count: { usages: number } }

/** Choose existing library files and add them to a listing (reuse a compound's shared photos, etc.). */
export function LibraryPicker({ propertyId, onAdded }: { propertyId: string; onAdded: () => void }) {
  const { data, error, loading } = useFetch<{ data: Asset[] }>("/media?pageSize=60");
  const [chosen, setChosen] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function add() {
    try {
      await api(`/properties/${propertyId}/media/attach`, { method: "POST", json: { assetIds: chosen } });
      onAdded();
    } catch (e) { setErr(errorText(e)); }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  return (
    <div className="rounded-tile border border-reed bg-limestone p-3">
      <ErrorNote message={err} />
      <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6">
        {data?.data.map((a) => {
          const on = chosen.includes(a.id);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => toggle(a.id)} aria-pressed={on} title={a.originalName}
                className={`relative block aspect-[4/3] w-full overflow-hidden rounded-md border-2 ${on ? "border-palm" : "border-transparent"}`}>
                {pickVariant(a.variants, 480) ? <img src={pickVariant(a.variants, 480)} alt="" className="h-full w-full object-cover" /> : <span className="text-xs">{a.originalName}</span>}
                {on && <span className="absolute end-1 top-1 rounded-full bg-palm px-1.5 text-xs text-white">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex justify-end"><button disabled={!chosen.length} onClick={add} className="btn-primary">Add {chosen.length || ""} to listing</button></div>
    </div>
  );
}
