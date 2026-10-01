/**
 * The home-page films, chapter by chapter. Two films, chosen by the shape of the screen:
 *   wide  landscape apartment walk-through — computers, laptops, tablets held sideways
 *   tall  portrait villa film — phones and tablets held upright
 * Times are seconds in the film (apps/web/public/journey/<version>/, made by scripts/brand/build_journey.py).
 * Positions are fractions of the FILM frame (0 = left/top, 1 = right/bottom), so hotspots stay on the right
 * object whatever the screen size.
 *   focusY  which horizontal band stays visible when the screen is wider than the film (0 top … 1 bottom)
 *   spot    the point the label points at
 * Texts for each chapter: lib/i18n › journey.films.<wide|tall>.chapters, same order.
 */
export const JOURNEY_VERSION = "v2";

export type FilmId = "wide" | "tall";
export interface JourneyChapter { start: number; focusY: number; spot: { x: number; y: number } }
export interface Film {
  id: FilmId;
  duration: number;
  /** Scroll length of the tour, in screen heights. */
  trackVh: number;
  /** File names in the version folder (without extension); `small` is used on phones. */
  file: string;
  small?: string;
  poster: string;
  chapters: JourneyChapter[];
}

export const FILMS: Record<FilmId, Film> = {
  wide: {
    id: "wide", duration: 10, trackVh: 560, file: "wide", poster: "poster-wide.webp",
    chapters: [
      { start: 0, focusY: 0.5, spot: { x: 0.33, y: 0.6 } },      // living room, floor-to-ceiling windows
      { start: 2.4, focusY: 0.5, spot: { x: 0.46, y: 0.62 } },   // dining
      { start: 4.3, focusY: 0.5, spot: { x: 0.34, y: 0.66 } },   // kitchen island
      { start: 6.0, focusY: 0.5, spot: { x: 0.47, y: 0.63 } },   // bedroom
      { start: 8.3, focusY: 0.5, spot: { x: 0.52, y: 0.5 } },    // balcony and the city at sunset
    ],
  },
  tall: {
    id: "tall", duration: 24.25, trackVh: 720, file: "tall", small: "tall-small", poster: "poster-tall.webp",
    chapters: [
      { start: 0, focusY: 0.6, spot: { x: 0.46, y: 0.6 } },      // arrival: the house from the street
      { start: 2.8, focusY: 0.52, spot: { x: 0.62, y: 0.55 } },  // entrance: the double-height door
      { start: 5.23, focusY: 0.58, spot: { x: 0.52, y: 0.62 } }, // living: atrium, stair, lounge
      { start: 10.4, focusY: 0.62, spot: { x: 0.28, y: 0.7 } },  // lounge: bar and billiards
      { start: 12.73, focusY: 0.64, spot: { x: 0.56, y: 0.63 } },// facade
      { start: 19.5, focusY: 0.68, spot: { x: 0.52, y: 0.76 } }, // garden and pool
    ],
  },
};

/** Portrait screens get the tall film. Same test as the CSS (`orientation: portrait`) that picks the texts. */
export const PORTRAIT_QUERY = "(orientation: portrait)";

/** Index of the chapter playing at film time t. */
export function chapterAt(film: Film, t: number): number {
  let i = 0;
  for (let k = 0; k < film.chapters.length; k++) if (t >= film.chapters[k]!.start) i = k;
  return i;
}

/**
 * Where a point of the film lands on screen when the film covers a stage of size (w, h) with the given
 * vertical focus (CSS object-fit: cover; object-position: 50% focusY). Returns null when it's cropped away.
 */
export function projectSpot(p: { x: number; y: number }, film: { w: number; h: number }, stage: { w: number; h: number }, focusY: number) {
  const s = Math.max(stage.w / film.w, stage.h / film.h);
  const rw = film.w * s, rh = film.h * s;
  const ox = (stage.w - rw) * 0.5, oy = (stage.h - rh) * focusY;
  const x = ox + p.x * rw, y = oy + p.y * rh;
  if (x < 24 || y < 80 || x > stage.w - 24 || y > stage.h - 120) return null;
  return { x, y };
}
