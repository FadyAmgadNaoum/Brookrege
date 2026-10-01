"use client";

import Link from "next/link";
import { ErrorNote, Loading, PageHeader } from "@/components/ui";
import { useFetch } from "@/lib/useFetch";

interface Dash { listings: Record<string, number>; expiringSoon: number; newInquiries: number; newSubmissions: number }

function Stat({ label, value, href, note }: { label: string; value: number; href: string; note?: string }) {
  return (
    <Link href={href} className="panel block p-5 hover:border-palm">
      <p className="text-silt-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-silt-soft">{note}</p>}
    </Link>
  );
}

export default function Overview() {
  const { data, error, loading } = useFetch<{ data: Dash }>("/dashboard");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;
  const d = data.data;
  return (
    <>
      <PageHeader title="Overview" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Live listings" value={d.listings.ACTIVE ?? 0} href="/properties?status=ACTIVE" />
        <Stat label="Expiring in 14 days" value={d.expiringSoon} href="/properties?view=expiring" note="Renew to keep them online" />
        <Stat label="New inquiries" value={d.newInquiries} href="/inquiries" />
        <Stat label="New property submissions" value={d.newSubmissions} href="/submissions" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Drafts" value={d.listings.DRAFT ?? 0} href="/properties?status=DRAFT" />
        <Stat label="Expired" value={d.listings.EXPIRED ?? 0} href="/properties?status=EXPIRED" note="Hidden from the public site" />
        <Stat label="Sold" value={d.listings.SOLD ?? 0} href="/properties?status=SOLD" />
      </div>
    </>
  );
}
