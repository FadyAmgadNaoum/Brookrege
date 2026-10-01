"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { viewingHref } from "@/lib/contact";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Global header. Over the home-page film it is transparent with light text; everywhere else (and once you
 * scroll past the film) it is a solid, blurred bar. Wordmark, links, "Book a viewing" in gold, and a menu
 * button that opens a full-screen menu on every screen size.
 */
export function SiteHeader() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const base = `/${locale}`;

  const nav = [
    { href: `${base}/properties?transaction=SALE`, label: t.nav.buy },
    { href: `${base}/properties?transaction=RENT`, label: t.nav.rent },
    { href: `${base}/compounds`, label: t.nav.compounds },
    { href: `${base}/projects`, label: t.nav.projects },
    { href: `${base}/map`, label: t.nav.map },
  ];

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open]);

  // Transparent while the home film or a page's title banner is under the header.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const hero = document.querySelector("#journey, [data-hero]");
      setOver(!!hero && hero.getBoundingClientRect().bottom > 72);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [pathname]);

  return (
    <header className="site-header" data-over={over && !open ? "true" : undefined} style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <div className="site-header-bar">
        <div className="page-wide flex h-16 items-center gap-8">
          <Link href={base} className="brand" aria-label={t.brand}>
            <span className="brand-word">{t.brand}</span>
            <span className="brand-sub">{t.brandSub}</span>
          </Link>
          <nav aria-label={t.nav.main} className="hidden items-center gap-7 lg:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="header-link">{n.label}</Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <Suspense><LocaleSwitch className="hidden sm:inline-flex" /></Suspense>
            <ThemeToggle />
            <a href={viewingHref(locale)} className="btn-gold btn-gold-sm ms-2 hidden sm:inline-flex">{t.nav.viewing}</a>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? t.nav.close : t.nav.menu}
              className="ms-1 inline-flex h-10 w-10 items-center justify-center text-silt"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="overflow-visible">
                <path d="M3 7h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="origin-center transition-transform duration-500 ease-apple" style={{ transform: open ? "translateY(3px) rotate(45deg)" : "none" }} />
                <path d="M3 13h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="origin-center transition-transform duration-500 ease-apple" style={{ transform: open ? "translateY(-3px) rotate(-45deg)" : "none" }} />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div id="site-menu" hidden={!open} className="menu-panel fixed inset-x-0 bottom-0 top-16 bg-limestone/95 backdrop-blur-xl">
        <nav aria-label={t.nav.main} className="page-wide flex flex-col gap-1 pt-8">
          {nav.map((n, i) => (
            <Link key={n.href} href={n.href} className="menu-link intro" style={{ ["--d" as string]: i * 0.4 }}>{n.label}</Link>
          ))}
          <Link href={`${base}/add-your-property`} className="menu-link intro text-sandstone-dark" style={{ ["--d" as string]: nav.length * 0.4 }}>{t.nav.add}</Link>
          <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-reed pt-6">
            <a href={viewingHref(locale)} className="btn-gold">{t.nav.viewing}</a>
            <Suspense><LocaleSwitch className="px-0 text-base" /></Suspense>
          </div>
        </nav>
      </div>
    </header>
  );
}
