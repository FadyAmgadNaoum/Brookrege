"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  NON_RESIDENTIAL_TYPES,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  RENTABLE_TYPES,
  validateListing,
  type PropertyType,
  type SellerType,
  type TransactionType,
} from "@brookrege/domain";
import { ApiError, errorText } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

export interface PropertyValues {
  title: string; titleEn: string | null; description: string | null; descriptionEn: string | null; type: PropertyType; transaction: TransactionType; sellerType: SellerType | null;
  price: number; areaSqm: number; bedrooms: number | null; bathrooms: number | null; regionId: string; compoundId: string | null;
  address: string | null; latitude: number | null; longitude: number | null; isFeatured: boolean;
}

interface Region { id: string; name: string }
interface Compound { id: string; name: string; regionId: string }

const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));
const str = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : String(v).trim());

/**
 * Create/edit form. Runs the SAME business rules as the API (from @brookrege/domain)
 * for instant feedback; the API remains the authority.
 */
export function PropertyForm({ initial, submitLabel, onSubmit, showPublish }: {
  initial?: Partial<PropertyValues>;
  submitLabel: string;
  showPublish?: boolean;
  onSubmit: (values: PropertyValues & { publish?: boolean }) => Promise<void>;
}) {
  const regions = useFetch<{ data: Region[] }>("/catalog/regions");
  const compounds = useFetch<{ data: Compound[] }>("/catalog/compounds");
  const [transaction, setTransaction] = useState<TransactionType>(initial?.transaction ?? "SALE");
  const [type, setType] = useState<PropertyType>(initial?.type ?? "APARTMENT");
  const [regionId, setRegionId] = useState(initial?.regionId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allowedTypes = transaction === "RENT" ? RENTABLE_TYPES : PROPERTY_TYPES;
  const residential = !NON_RESIDENTIAL_TYPES.includes(type);
  const regionCompounds = useMemo(() => compounds.data?.data.filter((c) => c.regionId === regionId) ?? [], [compounds.data, regionId]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget);
    const values: PropertyValues = {
      title: String(fd.get("title") ?? "").trim(),
      titleEn: str(fd.get("titleEn")),
      description: str(fd.get("description")),
      descriptionEn: str(fd.get("descriptionEn")),
      type,
      transaction,
      sellerType: transaction === "SALE" ? ((str(fd.get("sellerType")) as SellerType | null) ?? null) : null,
      price: Number(fd.get("price")),
      areaSqm: Number(fd.get("areaSqm")),
      bedrooms: residential ? num(fd.get("bedrooms")) : null,
      bathrooms: type === "LAND" ? null : num(fd.get("bathrooms")),
      regionId,
      compoundId: str(fd.get("compoundId")),
      address: str(fd.get("address")),
      latitude: num(fd.get("latitude")),
      longitude: num(fd.get("longitude")),
      isFeatured: fd.get("isFeatured") === "on",
    };
    const local: Record<string, string> = {};
    if (values.title.length < 5) local.title = "Use at least 5 characters.";
    if (!values.regionId) local.regionId = "Choose a region.";
    for (const v of validateListing(values)) local[v.field] ??= v.message;
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await onSubmit({ ...values, publish: submitter?.value === "publish" });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0] ?? ""])));
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const E = ({ name }: { name: string }) => (errors[name] ? <p className="mt-1 text-xs text-red-700">{errors[name]}</p> : null);

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <section className="panel grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Listing</h2>
        <div className="md:col-span-2">
          <label htmlFor="title" className="label">Title in Arabic (shown on the Arabic site)</label>
          <input id="title" name="title" dir="rtl" lang="ar" defaultValue={initial?.title} className="field" placeholder="شقة ٣ غرف في كمبوند رتاج" />
          <E name="title" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="titleEn" className="label">Title in English (optional — the English site shows the Arabic title if empty)</label>
          <input id="titleEn" name="titleEn" dir="ltr" defaultValue={initial?.titleEn ?? ""} className="field" placeholder="3-bedroom apartment in Retaj" />
        </div>
        <div>
          <label htmlFor="transaction" className="label">Listed for</label>
          <select id="transaction" value={transaction} onChange={(e) => {
            const t = e.target.value as TransactionType;
            setTransaction(t);
            if (t === "RENT" && !RENTABLE_TYPES.includes(type)) setType("APARTMENT");
          }} className="field">
            <option value="SALE">Sale</option>
            <option value="RENT">Rent (apartments and shops only)</option>
          </select>
        </div>
        <div>
          <label htmlFor="type" className="label">Property type</label>
          <select id="type" value={type} onChange={(e) => setType(e.target.value as PropertyType)} className="field">
            {allowedTypes.map((t) => <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>)}
          </select>
          <E name="type" />
        </div>
        {transaction === "SALE" && (
          <div>
            <label htmlFor="sellerType" className="label">Seller</label>
            <select id="sellerType" name="sellerType" defaultValue={initial?.sellerType ?? ""} className="field">
              <option value="">Choose</option>
              <option value="DEVELOPER">Developer</option>
              <option value="RESALE">Resale</option>
            </select>
            <E name="sellerType" />
          </div>
        )}
        <div>
          <label htmlFor="price" className="label">{transaction === "RENT" ? "Monthly rent (EGP)" : "Price (EGP)"}</label>
          <input id="price" name="price" type="number" min={1} step={1} inputMode="numeric" defaultValue={initial?.price} className="field" />
          <E name="price" />
        </div>
        <div>
          <label htmlFor="areaSqm" className="label">Area (m²)</label>
          <input id="areaSqm" name="areaSqm" type="number" min={1} step={1} inputMode="numeric" defaultValue={initial?.areaSqm} className="field" />
          <E name="areaSqm" />
        </div>
        {residential && (
          <div>
            <label htmlFor="bedrooms" className="label">Bedrooms</label>
            <input id="bedrooms" name="bedrooms" type="number" min={0} max={50} defaultValue={initial?.bedrooms ?? ""} className="field" />
            <E name="bedrooms" />
          </div>
        )}
        {type !== "LAND" && (
          <div>
            <label htmlFor="bathrooms" className="label">Bathrooms</label>
            <input id="bathrooms" name="bathrooms" type="number" min={0} max={50} defaultValue={initial?.bathrooms ?? ""} className="field" />
          </div>
        )}
        <div className="md:col-span-2">
          <label htmlFor="description" className="label">Description in Arabic</label>
          <textarea id="description" name="description" dir="rtl" lang="ar" rows={5} defaultValue={initial?.description ?? ""} className="field h-auto py-2" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="descriptionEn" className="label">Description in English (optional)</label>
          <textarea id="descriptionEn" name="descriptionEn" dir="ltr" rows={4} defaultValue={initial?.descriptionEn ?? ""} className="field h-auto py-2" />
        </div>
        <label className="flex items-center gap-2 md:col-span-2">
          <input type="checkbox" name="isFeatured" defaultChecked={initial?.isFeatured} /> Feature this listing at the top of results
        </label>
      </section>

      <section className="panel grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Location</h2>
        <div>
          <label htmlFor="regionId" className="label">Region</label>
          <select id="regionId" value={regionId} onChange={(e) => setRegionId(e.target.value)} className="field">
            <option value="">Choose</option>
            {regions.data?.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <E name="regionId" />
        </div>
        <div>
          <label htmlFor="compoundId" className="label">Compound</label>
          <select key={regionId} id="compoundId" name="compoundId" defaultValue={initial?.regionId === regionId ? initial?.compoundId ?? "" : ""} className="field" disabled={!regionId}>
            <option value="">Not in a compound</option>
            {regionCompounds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <E name="compoundId" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="address" className="label">Address or landmark</label>
          <input id="address" name="address" defaultValue={initial?.address ?? ""} className="field" />
        </div>
        <div>
          <label htmlFor="latitude" className="label">Latitude (for the map)</label>
          <input id="latitude" name="latitude" type="number" step="any" defaultValue={initial?.latitude ?? ""} className="field" placeholder="26.5569" />
        </div>
        <div>
          <label htmlFor="longitude" className="label">Longitude (for the map)</label>
          <input id="longitude" name="longitude" type="number" step="any" defaultValue={initial?.longitude ?? ""} className="field" placeholder="31.6948" />
        </div>
        <p className="text-xs text-silt-soft md:col-span-2">Tip: in Google Maps, right-click the location and click the coordinates to copy them.</p>
      </section>

      {formError && <p role="alert" className="text-red-700">{formError}</p>}
      <div className="flex flex-wrap gap-2">
        {showPublish && <button name="intent" value="publish" className="btn-primary" disabled={busy}>Save and publish</button>}
        <button name="intent" value="save" className={showPublish ? "btn-quiet" : "btn-primary"} disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
