"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "@/components/PropertyForm";
import { api } from "@/lib/api";

export default function NewPropertyPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader title="Add listing">Save as a draft to add photos first, or publish right away. Published listings stay live for three months.</PageHeader>
      <PropertyForm
        submitLabel="Save as draft"
        showPublish
        onSubmit={async (values) => {
          const res = await api<{ data: { id: string } }>("/properties", { method: "POST", json: values });
          router.push(`/properties/${res.data.id}?created=1`);
        }}
      />
    </>
  );
}
