"use client";

import { useI18n } from "@/lib/i18n/client";
import { ScrollScene } from "@/components/motion/ScrollScene";

/** Words light up one after another as you scroll — the page's one big "read this" moment. */
export function Statement() {
  const { t } = useI18n();
  const words = t.home.statement.split(/\s+/);
  return (
    <ScrollScene heightVh={220}>
      <div className="page flex h-full items-center">
        <p className="headline mx-auto max-w-4xl text-center text-silt" style={{ ["--n" as string]: words.length }}>
          {words.map((w, i) => (
            <span key={i} className="word" style={{ ["--i" as string]: i }}>{w}{i < words.length - 1 ? " " : ""}</span>
          ))}
        </p>
      </div>
    </ScrollScene>
  );
}
