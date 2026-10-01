"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { PageHero } from "@/components/PageHero";

export default function NotFound() {
  const { locale, t } = useI18n();
  return (
    <PageHero eyebrow="404" title={t.notFound.title} still="view" sub={t.notFound.body}>
      <Link href={`/${locale}/properties`} className="btn-gold">{t.notFound.cta}</Link>
    </PageHero>
  );
}
