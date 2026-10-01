"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n/client";
import { viewingHref } from "@/lib/contact";
import { FILMS, JOURNEY_VERSION, PORTRAIT_QUERY, type FilmId } from "./journeyChapters";
import { chapterCount, chapterScrollY, startJourney } from "./journeyEngine";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The home page opens with a film that plays as you scroll. Landscape screens get the apartment walk-through
 * (living → dining → kitchen → bedroom → view); portrait screens get the villa film (street → entrance →
 * living → lounge → facade → garden). A rail on the side and a timeline at the bottom show where you are;
 * each chapter points at one feature. Without JavaScript, or with reduced motion, it is a still photo with
 * the same titles.
 */
export function Journey() {
  const { locale, t } = useI18n();
  const j = t.journey;
  const ref = useRef<HTMLElement>(null);
  const base = `/journey/${JOURNEY_VERSION}`;

  useEffect(() => (ref.current ? startJourney(ref.current) : undefined), []);

  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    if (i >= chapterCount(el)) document.getElementById("after-journey")?.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo({ top: chapterScrollY(el, i), behavior: "smooth" });
  };

  const actions = (
    <div className="jr-actions">
      <Link href={`/${locale}/properties`} className="btn-gold">{j.explore}</Link>
      <a href={viewingHref(locale)} className="jr-textlink">{j.viewing}</a>
    </div>
  );

  /** The chapter-dependent parts, once per film; CSS shows the set matching the screen's shape. */
  const chapterSet = (id: FilmId) => {
    const film = FILMS[id];
    const names = j.films[id].chapters;
    return (
      <div key={id} className="jr-set" data-set={id}>
        {/* The feature this chapter points at */}
        <div className="jr-spot" data-side="left" aria-hidden="true">
          <span className="jr-spot-dot" />
          <span className="jr-spot-line" />
          <span className="jr-spot-tag">{names.map((c, i) => <span key={c.name} data-i={i} className={i === 0 ? "is-active" : ""}>{c.feature}</span>)}</span>
        </div>

        {/* Side rail: chapter numbers */}
        <nav className="jr-rail" aria-label={j.railLabel}>
          <span className="jr-rail-line" aria-hidden="true"><span className="jr-rail-fill" /></span>
          <ol>
            {names.map((c, i) => (
              <li key={c.name} style={{ ["--at" as string]: film.chapters[i]!.start / film.duration } as CSSProperties}>
                <button type="button" data-i={i} className={i === 0 ? "is-active" : ""} onClick={() => go(i)} aria-label={`${pad(i + 1)} ${c.name}`}>
                  <span className="jr-rail-num">{pad(i + 1)}</span><span className="jr-rail-dot" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          <span className="jr-rail-name" aria-hidden="true">{names.map((c, i) => <span key={c.name} data-i={i} className={i === 0 ? "is-active" : ""}>{c.name}</span>)}</span>
        </nav>

        {/* Bottom: caption, timeline, current chapter, next */}
        <div className="jr-bottom">
          <p className="jr-caption">{j.caption}</p>
          <div className="jr-timeline" aria-hidden="true">
            <span className="jr-timeline-fill" />
            {names.map((c, i) => (
              <span key={c.name} data-i={i} className={`jr-tick ${i === 0 ? "is-active" : ""}`} style={{ ["--at" as string]: film.chapters[i]!.start / film.duration } as CSSProperties}>
                <span className="jr-tick-label">{c.name}</span>
              </span>
            ))}
          </div>
          <div className="jr-level" aria-live="polite">
            <p className="jr-level-kicker">{j.chapterWord}</p>
            <p className="jr-level-name">
              {names.map((c, i) => (
                <span key={c.name} data-i={i} className={i === 0 ? "is-active" : ""}>
                  <span className="jr-level-num">{pad(i + 1)}</span> {c.name}
                </span>
              ))}
            </p>
          </div>
          <button type="button" className="jr-next" onClick={() => go(Number(ref.current?.dataset.chapter ?? 0) + 1)} aria-label={j.next}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 4v12m0 0-5-5m5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <section id="journey" ref={ref} className="jr" data-chapter="0" data-phase="intro" aria-label={j.aria}
        style={{ ["--jr-h-wide" as string]: `${FILMS.wide.trackVh}vh`, ["--jr-h-tall" as string]: `${FILMS.tall.trackVh}vh` } as CSSProperties}>
        <a href="#after-journey" className="jr-skip">{j.skip}</a>
        <div className="jr-stage">
          <picture className="jr-poster">
            <source media={PORTRAIT_QUERY} srcSet={`${base}/${FILMS.tall.poster}`} />
            <img src={`${base}/${FILMS.wide.poster}`} alt="" fetchPriority="high" decoding="async" />
          </picture>
          <video className="jr-film" muted playsInline preload="none" disablePictureInPicture aria-hidden="true" tabIndex={-1} data-base={`${base}/`} />
          <div className="jr-shade" aria-hidden="true" />

          {/* Opening titles */}
          <div className="jr-intro">
            <p className="jr-eyebrow">{j.eyebrow}</p>
            <h1 className="jr-title">{j.title.map((line) => <span key={line}>{line}</span>)}</h1>
            <p className="jr-sub">{j.sub}</p>
            {actions}
            <p className="jr-hint" aria-hidden="true"><span className="jr-hint-line" />{j.hint}</p>
          </div>

          {/* Closing titles */}
          <div className="jr-outro">
            <h2 className="jr-title">{j.outroTitle.map((line) => <span key={line}>{line}</span>)}</h2>
            <p className="jr-sub">{j.outroSub}</p>
            {actions}
          </div>

          {chapterSet("wide")}
          {chapterSet("tall")}
        </div>
      </section>
      <div id="after-journey" />
    </>
  );
}
