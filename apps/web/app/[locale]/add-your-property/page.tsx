import type { Metadata } from "next";
import { withAlternates } from "@/lib/site";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getDict } from "@/lib/i18n";
import { SubmissionForm } from "./SubmissionForm";
import { PageHero } from "@/components/PageHero";

type Props = { params: { locale: string } };
const loc = (l: string): Locale => (isLocale(l) ? l : "ar");

export function generateMetadata({ params }: Props): Metadata {
  const locale = loc(params.locale);
  return withAlternates(locale, "/add-your-property", { title: getDict(locale).add.title });
}

export default function AddYourPropertyPage({ params }: Props) {
  const t = getDict(loc(params.locale)).add;
  return (
    <>
    <PageHero eyebrow={getDict(loc(params.locale)).journey.eyebrow} title={t.title} still="entrance" sub={t.intro} />
    <div className="page grid gap-12 pt-14 lg:grid-cols-[1fr_30rem]">
      <div className="max-w-prose">
        <p className="kicker reveal">{t.title}</p>
        <p className="reveal mt-5 text-lg leading-relaxed text-silt-soft">{t.intro2}</p>
      </div>
      <div className="reveal rounded-card bg-surface p-6 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.35)] lg:-mt-40 lg:relative lg:z-10" style={{ ["--d" as string]: 1 }}>
        <SubmissionForm />
      </div>
    </div>
    </>
  );
}
