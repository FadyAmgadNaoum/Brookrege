import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import { apiGet, type Project } from "@/lib/api";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { descOf, nameOf } from "@/lib/i18n/format";
import { PageHero } from "@/components/PageHero";

type Props = { params: { locale: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

export function generateMetadata({ params }: Props): Metadata {
  const locale = loc(params.locale);
  return withAlternates(locale, "/projects", { title: getDict(locale).projects.title });
}

export const dynamic = "force-dynamic";

function ProjectList({ items, locale }: { items: Project[]; locale: Locale }) {
  const t = getDict(locale).projects;
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {items.map((p, i) => {
        const description = descOf(p, locale);
        const meta = [p.partnerName && t.with(p.partnerName), p.region && nameOf(p.region, locale), p.completedAt && t.completedIn(new Date(p.completedAt).getFullYear())].filter(Boolean);
        return (
          <li key={p.id} className="reveal overflow-hidden rounded-card bg-surface" style={{ ["--d" as string]: i % 2 }}>
            {p.coverImageUrl && <img src={p.coverImageUrl} alt="" loading={i < 2 ? "eager" : "lazy"} decoding="async" className="aspect-[16/9] w-full object-cover" />}
            <div className="p-8">
              <h3 className="serif text-3xl">{nameOf(p, locale)}</h3>
              {meta.length > 0 && <p className="mt-1 text-sm text-silt-soft">{meta.join(locale === "ar" ? "، " : ", ")}</p>}
              {description && <p className="mt-4 text-silt">{description}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function ProjectsPage({ params }: Props) {
  const locale = loc(params.locale);
  const t = getDict(locale).projects;
  const { data } = await apiGet<{ data: Project[] }>("/projects", 120);
  const partnerships = data.filter((p) => p.kind === "PARTNERSHIP");
  const completed = data.filter((p) => p.kind === "COMPLETED");
  return (
    <>
    <PageHero eyebrow={getDict(locale).journey.eyebrow} title={t.title} still="view" />
    <div className="page pt-16">
      <section aria-labelledby="p-h" className="mb-16">
        <h2 id="p-h" className="reveal kicker mb-8">{t.partnerships}</h2>
        {partnerships.length ? <ProjectList items={partnerships} locale={locale} /> : <p className="text-silt-soft">{t.emptyPartnerships}</p>}
      </section>
      <section aria-labelledby="c-h">
        <h2 id="c-h" className="reveal kicker mb-8">{t.completed}</h2>
        {completed.length ? <ProjectList items={completed} locale={locale} /> : <p className="text-silt-soft">{t.emptyCompleted}</p>}
      </section>
    </div>
    </>
  );
}
