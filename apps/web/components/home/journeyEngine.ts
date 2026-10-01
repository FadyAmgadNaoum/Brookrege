import { FILMS, PORTRAIT_QUERY, chapterAt, projectSpot, type Film } from "./journeyChapters";

/**
 * Drives the home-page film from the scroll position (no React re-renders while scrolling).
 * The section is tall; its stage sticks to the screen, and scroll progress 0 → 1 maps to film time.
 * Writes: --jp (0–1 progress), data-phase (intro | tour | outro), data-chapter, .is-active on the current
 * chapter's rail dot / timeline tick / name / label, and the hotspot position.
 *
 * Two films (journeyChapters.ts): the wide one on landscape screens, the tall one on portrait screens.
 * Turning a tablet switches film. The markup holds both chapter sets; CSS shows the one matching the screen.
 *
 * Why a <video> and not an image sequence: 290 stills would weigh ~16 MB; a film encoded with a keyframe
 * every 8 frames (scripts/brand/build_journey.py) is 2–6 MB and still seeks instantly.
 */
export function startJourney(section: HTMLElement): () => void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (reduce || conn?.saveData) {
    section.dataset.mode = "still";   // CSS shows the poster and the opening titles; no film download
    return () => {};
  }
  const portrait = window.matchMedia(PORTRAIT_QUERY);
  let stop = run(section, portrait.matches ? FILMS.tall : FILMS.wide);
  const onTurn = () => { stop(); stop = run(section, portrait.matches ? FILMS.tall : FILMS.wide); };
  portrait.addEventListener("change", onTurn);
  return () => { portrait.removeEventListener("change", onTurn); stop(); };
}

function run(section: HTMLElement, film: Film): () => void {
  const video = section.querySelector<HTMLVideoElement>("video")!;
  const stage = section.querySelector<HTMLElement>(".jr-stage")!;
  const set = section.querySelector<HTMLElement>(`.jr-set[data-set="${film.id}"]`)!;
  const spot = set.querySelector<HTMLElement>(".jr-spot");
  const tag = set.querySelector<HTMLElement>(".jr-spot-tag");
  const marked = Array.from(set.querySelectorAll<HTMLElement>("[data-i]"));
  section.dataset.film = "loading";
  section.dataset.set = film.id;

  // H.264 where the browser has it (hardware decoding), VP9 otherwise; phones get the lighter file.
  const small = film.small && window.matchMedia("(max-width: 767px)").matches;
  const h264 = video.canPlayType('video/mp4; codecs="avc1.640028"') !== "";
  const src = `${video.dataset.base}${small ? film.small : film.file}.${h264 ? "mp4" : "webm"}`;
  let ready = false;
  let target = 0, shown = 0, chapter = -1, frame = 0, alive = true, timer = 0;

  const load = () => {
    if (!alive) return;
    video.src = src;
    video.load();
    // iOS only decodes frames for a video that has "played" once; muted inline play is allowed.
    const p = video.play();
    if (p) p.then(() => video.pause()).catch(() => {});
  };
  const onData = () => { ready = true; section.dataset.film = "ready"; tick(); };
  // A seek that was still running when the glide finished: sync once more when it lands.
  const onSeeked = () => { if (Math.abs(video.currentTime - shown) > 1 / 30) onScroll(); };
  video.addEventListener("loadeddata", onData, { once: true });
  video.addEventListener("seeked", onSeeked);
  // Start downloading after the page itself has loaded, so the film never delays the first paint.
  const onLoad = () => { timer = window.setTimeout(load, 300); };
  if (document.readyState === "complete") onLoad();
  else window.addEventListener("load", onLoad, { once: true });

  const measure = () => {
    const r = section.getBoundingClientRect();
    const travel = r.height - window.innerHeight;
    return travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0;
  };

  function place(i: number, t: number) {
    const c = film.chapters[i]!;
    const next = film.chapters[i + 1];
    // Ease the visible band between chapters instead of jumping.
    const end = next ? next.start : film.duration;
    const k = Math.min(1, Math.max(0, (t - (end - 0.6)) / 0.6));
    const focus = next ? c.focusY + (next.focusY - c.focusY) * k : c.focusY;
    video.style.objectPosition = `50% ${(focus * 100).toFixed(1)}%`;
    if (!spot) return;
    const vw = video.videoWidth || (film.id === "wide" ? 1280 : 720), vh = video.videoHeight || (film.id === "wide" ? 720 : 1280);
    const pos = projectSpot(c.spot, { w: vw, h: vh }, { w: stage.clientWidth, h: stage.clientHeight }, focus);
    spot.style.setProperty("--x", pos ? `${pos.x}px` : "-999px");
    spot.style.setProperty("--y", pos ? `${pos.y}px` : "-999px");
    spot.classList.toggle("is-hidden", !pos);
    // Label on a side where it fits (dot → 72 px line → label), preferring the left.
    if (pos) {
      const need = (tag?.offsetWidth ?? 200) + 84, w = stage.clientWidth;
      spot.dataset.side = pos.x - need >= 12 ? "left" : w - pos.x - need >= 12 ? "right" : pos.x > w / 2 ? "left" : "right";
    }
  }

  function tick() {
    frame = 0;
    const p = measure();
    section.style.setProperty("--jp", p.toFixed(4));
    const phase = p < 0.06 ? "intro" : p > 0.92 ? "outro" : "tour";
    if (section.dataset.phase !== phase) section.dataset.phase = phase;
    target = p * (film.duration - 0.05);
    shown += (target - shown) * 0.22;                         // glide towards the scroll position
    if (Math.abs(target - shown) < 0.01) shown = target;
    if (ready && !video.seeking && Math.abs(video.currentTime - shown) > 1 / 30) video.currentTime = shown;
    const i = chapterAt(film, shown);
    if (i !== chapter) {
      chapter = i;
      section.dataset.chapter = String(i);
      for (const el of marked) el.classList.toggle("is-active", el.dataset.i === String(i));
    }
    place(i, shown);
    if (Math.abs(target - shown) > 0.001) frame = requestAnimationFrame(tick);
  }
  function onScroll() { if (!frame) frame = requestAnimationFrame(tick); }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  tick();

  return () => {
    alive = false;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener("load", onLoad);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    video.removeEventListener("loadeddata", onData);
    video.removeEventListener("seeked", onSeeked);
    video.removeAttribute("src");
    video.load();
  };
}

/** Scroll position (in px from the top of the page) where chapter i of the film on screen begins. */
export function chapterScrollY(section: HTMLElement, i: number): number {
  const film = FILMS[section.dataset.set === "tall" ? "tall" : "wide"];
  const top = section.getBoundingClientRect().top + window.scrollY;
  const travel = section.offsetHeight - window.innerHeight;
  const t = film.chapters[Math.min(i, film.chapters.length - 1)]!.start + 0.35;
  return top + (t / film.duration) * travel;
}

/** Number of chapters of the film on screen. */
export function chapterCount(section: HTMLElement): number {
  return FILMS[section.dataset.set === "tall" ? "tall" : "wide"].chapters.length;
}
