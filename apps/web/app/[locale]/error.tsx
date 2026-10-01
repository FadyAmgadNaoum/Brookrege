"use client";

import { useI18n } from "@/lib/i18n/client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page py-32 text-center">
      <h1 className="headline text-silt">{t.error.title}</h1>
      <p className="mt-3 text-lg text-silt-soft">{t.error.body}</p>
      <button onClick={reset} className="pill-primary mt-8">{t.error.retry}</button>
    </div>
  );
}
