"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

type Mode = "system" | "light" | "dark";
const ORDER: Mode[] = ["system", "light", "dark"];

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.setAttribute("data-theme", mode);
}

const icons: Record<Mode, JSX.Element> = {
  light: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />,
  dark: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  system: <path d="M4 5h16v11H4zM9 20h6m-3-4v4" />,
};

/** Cycles: match device → light → dark. Choice persists; "match device" follows OS changes live. */
export function ThemeToggle() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    let saved: Mode = "system";
    try { saved = (localStorage.getItem("bk-theme") as Mode | null) ?? "system"; } catch { /* storage blocked (private mode, embedded views) */ }
    setMode(ORDER.includes(saved) ? saved : "system");
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function next() {
    const m = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    setMode(m);
    try { localStorage.setItem("bk-theme", m); } catch { /* private mode */ }
    apply(m);
  }

  const label = t.theme[mode];
  return (
    <button type="button" onClick={next} title={t.theme.change(label)} aria-label={t.theme.change(label)} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-silt-soft transition-colors hover:bg-silt/5 hover:text-silt">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icons[mode]}
      </svg>
    </button>
  );
}
