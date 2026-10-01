import type { ReactNode } from "react";
import { JOURNEY_VERSION } from "@/components/home/journeyChapters";

/** Photos from the home films, made by scripts/brand/build_journey.py (public/journey/<version>/stills). */
export type Still = "living" | "dining" | "kitchen" | "bedroom" | "view" | "facade" | "pool" | "entrance";

/**
 * Title banner for inner pages, in the style of the home film: a dark photograph, a gold eyebrow and a
 * serif title. It sits under the transparent header (data-hero), like the film does.
 */
export function PageHero({ eyebrow, title, sub, still, image, children, compact }: {
  eyebrow?: string; title: string; sub?: ReactNode; still?: Still; image?: string | null; children?: ReactNode; compact?: boolean;
}) {
  const src = image || (still ? `/journey/${JOURNEY_VERSION}/stills/${still}.webp` : null);
  return (
    <section className={`page-hero ${compact ? "page-hero-compact" : ""}`} data-hero="">
      {src && <img src={src} alt="" fetchPriority="high" decoding="async" className="page-hero-img" />}
      <div className="page-hero-shade" aria-hidden="true" />
      <div className="page-wide page-hero-body">
        {eyebrow && <p className="page-hero-eyebrow intro">{eyebrow}</p>}
        <h1 className="page-hero-title intro" style={{ ["--d" as string]: 1 }}>{title}</h1>
        {sub && <div className="page-hero-sub intro" style={{ ["--d" as string]: 2 }}>{sub}</div>}
        {children && <div className="intro mt-7" style={{ ["--d" as string]: 3 }}>{children}</div>}
      </div>
    </section>
  );
}
