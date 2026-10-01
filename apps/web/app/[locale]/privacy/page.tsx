import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { PageHero } from "@/components/PageHero";

type Props = { params: { locale: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

export function generateMetadata({ params }: Props): Metadata {
  const locale = loc(params.locale);
  return withAlternates(locale, "/privacy", { title: getDict(locale).privacy.title });
}

/** Public privacy notice (docs/security/PRIVACY.md explains how each promise is implemented). */
export default function PrivacyPage({ params }: Props) {
  const t = getDict(loc(params.locale)).privacy;
  return (
    <>
    <PageHero compact eyebrow={t.updated} title={t.title} />
    <article className="page max-w-prose pt-12">
      <p className="text-lg leading-relaxed text-silt-soft">{t.intro}</p>
      {t.sections.map((s) => (
        <section key={s.h} className="mt-10">
          <h2 className="serif text-2xl text-silt">{s.h}</h2>
          {s.p.map((para) => <p key={para} className="mt-3 leading-relaxed text-silt-soft">{para}</p>)}
        </section>
      ))}
    </article>
    </>
  );
}
