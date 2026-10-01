"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * A tall section whose inner content is pinned while you scroll through it.
 * Writes scroll progress (0 → 1) to the CSS variable --p, which the CSS in
 * globals.css uses to drive transforms. No React re-renders during scroll.
 */
export function ScrollScene({ children, heightVh = 200, className = "", style }: { children: ReactNode; heightVh?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section ref={ref} className={`relative ${className}`} style={{ height: `${heightVh}vh`, ...style }}>
      <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col overflow-hidden">{children}</div>
    </section>
  );
}
