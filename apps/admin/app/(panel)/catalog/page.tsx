"use client";

import { useState, type FormEvent } from "react";
import { Empty, ErrorNote, PageHeader, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDate } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

interface Region { id: string; name: string; nameAr: string | null; isActive: boolean; _count: { properties: number; compounds: number } }
interface Compound { id: string; name: string; developerName: string | null; regionId: string; isPublished: boolean; region: { name: string }; _count: { properties: number } }
interface Project { id: string; kind: "PARTNERSHIP" | "COMPLETED"; name: string; partnerName: string | null; completedAt: string | null; isPublished: boolean }

type Tab = "regions" | "compounds" | "projects";

function useSubmit(path: string, reload: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>, build: (fd: FormData) => Record<string, unknown>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    try {
      await api(path, { method: "POST", json: build(new FormData(form)) });
      form.reset();
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return { error, onSubmit };
}

const s = (fd: FormData, k: string) => (String(fd.get(k) ?? "").trim() || null);

function Regions() {
  const { can } = useSession();
  const { data, reload, error } = useFetch<{ data: Region[] }>("/catalog/regions");
  const add = useSubmit("/catalog/regions", reload);
  return (
    <>
      <ErrorNote message={error ?? add.error} />
      {can("catalog:write") && (
        <form onSubmit={(e) => add.onSubmit(e, (fd) => ({ name: s(fd, "name"), nameAr: s(fd, "nameAr") }))} className="panel mb-4 flex flex-wrap items-end gap-3 p-4">
          <div><label className="label" htmlFor="r-name">Region name</label><input id="r-name" name="name" required className="field w-56" /></div>
          <div><label className="label" htmlFor="r-ar">Arabic name</label><input id="r-ar" name="nameAr" dir="rtl" className="field w-56" /></div>
          <button className="btn-primary">Add region</button>
        </form>
      )}
      {!data?.data.length ? <Empty>No regions yet. The final region list is still to be confirmed with the client.</Empty> : (
        <div className="panel overflow-x-auto"><table className="w-full">
          <thead><tr><th className="th">Region</th><th className="th">Arabic</th><th className="th">Compounds</th><th className="th">Listings</th></tr></thead>
          <tbody>{data.data.map((r) => <tr key={r.id}><td className="td font-medium">{r.name}</td><td className="td" dir="rtl">{r.nameAr}</td><td className="td">{r._count.compounds}</td><td className="td">{r._count.properties}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

function Compounds() {
  const { can } = useSession();
  const regions = useFetch<{ data: Region[] }>("/catalog/regions");
  const { data, reload, error } = useFetch<{ data: Compound[] }>("/catalog/compounds");
  const add = useSubmit("/catalog/compounds", reload);
  const [delError, setDelError] = useState<string | null>(null);
  async function remove(id: string) {
    if (!confirm("Delete this compound?")) return;
    setDelError(null);
    try { await api(`/catalog/compounds/${id}`, { method: "DELETE" }); await reload(); } catch (e) { setDelError(errorText(e)); }
  }
  return (
    <>
      <ErrorNote message={error ?? add.error ?? delError} />
      {can("catalog:write") && (
        <form onSubmit={(e) => add.onSubmit(e, (fd) => ({ name: s(fd, "name"), nameAr: s(fd, "nameAr"), developerName: s(fd, "developerName"), regionId: s(fd, "regionId"), description: s(fd, "description"), descriptionEn: s(fd, "descriptionEn") }))} className="panel mb-4 grid gap-3 p-4 md:grid-cols-4">
          <div><label className="label" htmlFor="c-name">Name in English</label><input id="c-name" name="name" required className="field" placeholder="Retaj" /></div>
          <div><label className="label" htmlFor="c-ar">Name in Arabic</label><input id="c-ar" name="nameAr" dir="rtl" className="field" placeholder="رتاج" /></div>
          <div><label className="label" htmlFor="c-dev">Developer</label><input id="c-dev" name="developerName" className="field" /></div>
          <div><label className="label" htmlFor="c-reg">Region</label>
            <select id="c-reg" name="regionId" required className="field"><option value="">Choose</option>{regions.data?.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </div>
          <div className="flex items-end"><button className="btn-primary w-full">Add compound</button></div>
          <div className="md:col-span-2"><label className="label" htmlFor="c-desc">Description in Arabic</label><textarea id="c-desc" name="description" dir="rtl" rows={2} className="field h-auto py-2" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="c-desc-en">Description in English (optional)</label><textarea id="c-desc-en" name="descriptionEn" rows={2} className="field h-auto py-2" /></div>
        </form>
      )}
      {!data?.data.length ? <Empty>No compounds yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="w-full">
          <thead><tr><th className="th">Compound</th><th className="th">Developer</th><th className="th">Region</th><th className="th">Listings</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.data.map((c) => (
            <tr key={c.id}>
              <td className="td font-medium">{c.name}</td><td className="td">{c.developerName ?? "—"}</td><td className="td">{c.region.name}</td><td className="td">{c._count.properties}</td>
              <td className="td text-end">{can("catalog:write") && <button onClick={() => remove(c.id)} className="text-red-700 hover:underline">Delete</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function Projects() {
  const { can } = useSession();
  const { data, reload, error } = useFetch<{ data: Project[] }>("/catalog/projects");
  const add = useSubmit("/catalog/projects", reload);
  return (
    <>
      <ErrorNote message={error ?? add.error} />
      {can("catalog:write") && (
        <form onSubmit={(e) => add.onSubmit(e, (fd) => ({ kind: s(fd, "kind"), name: s(fd, "name"), nameAr: s(fd, "nameAr"), partnerName: s(fd, "partnerName"), completedAt: s(fd, "completedAt"), description: s(fd, "description"), descriptionEn: s(fd, "descriptionEn") }))} className="panel mb-4 grid gap-3 p-4 md:grid-cols-4">
          <div><label className="label" htmlFor="p-kind">Section</label>
            <select id="p-kind" name="kind" className="field"><option value="PARTNERSHIP">Partnership / major project</option><option value="COMPLETED">Completed / sold</option></select>
          </div>
          <div><label className="label" htmlFor="p-name">Name in English</label><input id="p-name" name="name" required className="field" /></div>
          <div><label className="label" htmlFor="p-ar">Name in Arabic</label><input id="p-ar" name="nameAr" dir="rtl" className="field" /></div>
          <div><label className="label" htmlFor="p-partner">Partner (optional)</label><input id="p-partner" name="partnerName" className="field" /></div>
          <div><label className="label" htmlFor="p-date">Completed on (optional)</label><input id="p-date" name="completedAt" type="date" className="field" /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="p-desc">Description in Arabic</label><textarea id="p-desc" name="description" dir="rtl" rows={2} className="field h-auto py-2" /></div>
          <div><label className="label" htmlFor="p-desc-en">Description in English (optional)</label><textarea id="p-desc-en" name="descriptionEn" rows={2} className="field h-auto py-2" /></div>
          <div className="flex items-end"><button className="btn-primary w-full">Add project</button></div>
        </form>
      )}
      {!data?.data.length ? <Empty>No projects yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="w-full">
          <thead><tr><th className="th">Project</th><th className="th">Section</th><th className="th">Partner</th><th className="th">Completed</th></tr></thead>
          <tbody>{data.data.map((p) => <tr key={p.id}><td className="td font-medium">{p.name}</td><td className="td">{p.kind === "PARTNERSHIP" ? "Partnership" : "Completed"}</td><td className="td">{p.partnerName ?? "—"}</td><td className="td">{fmtDate(p.completedAt)}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("compounds");
  return (
    <>
      <PageHeader title="Regions, compounds & projects" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "compounds", label: "Compounds" }, { value: "regions", label: "Regions" }, { value: "projects", label: "Projects" }]} />
      {tab === "regions" ? <Regions /> : tab === "compounds" ? <Compounds /> : <Projects />}
    </>
  );
}
