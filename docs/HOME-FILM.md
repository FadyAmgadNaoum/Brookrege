# The home-page film

The home page opens with a film that plays as you scroll, in the style of the laptop reference the client chose: full-screen footage, serif capitals,
a gold "Book a viewing" button, a chapter rail on the side, a timeline at the bottom, a boxed label pointing at
one feature per chapter, and a large chapter name at the bottom corner. It ends on "Live above the ordinary".

**Two films, chosen by the screen's shape:**
- **wide** (landscape screens: computers, laptops, tablets held sideways) — the apartment walk-through:
  living → dining → kitchen → bedroom → view. 10 s, 1.9 MB.
- **tall** (portrait screens: phones, tablets held upright) — the villa film: arrival → entrance → living →
  lounge → facade → garden. 24 s, 4 MB on phones, 6.2 MB on portrait tablets.
Turning a tablet switches film. Each film has its own chapters, labels and scroll length.

The inner pages open with a title banner in the same style, using stills from the two films
(`components/PageHero.tsx`, `public/journey/v2/stills`).

| Part | File |
|---|---|
| Component (markup) | `apps/web/components/home/Journey.tsx` |
| Scroll engine (no React re-renders while scrolling) | `apps/web/components/home/journeyEngine.ts` |
| Chapters: start times, visible band, hotspot positions | `apps/web/components/home/journeyChapters.ts` |
| Texts (Arabic / English) | `apps/web/lib/i18n/ar.ts`, `en.ts` › `journey` |
| Styles | `apps/web/app/globals.css` › "Home film" |
| Film files and stills | `apps/web/public/journey/v2/` (made by `scripts/brand/build_journey.py`) |

**How it behaves**
- The page shows the first frame instantly (20–90 KB image); the film downloads after the page has loaded
  (H.264; VP9 copies for browsers without H.264).
- Reduced motion or data-saver on: a still photo with the opening titles, no film download.
- No JavaScript: the photo and the opening titles.
- Keyboard: "Skip the tour" link; the rail numbers are buttons that jump to a chapter; the round gold button
  goes to the next chapter.
- The header is transparent over the film and turns solid after it.

**Replacing the films** (e.g. with footage of a real Brookrege project):
1. One landscape (16:9, at least 1920 px wide) and one portrait (9:16, at least 1080 px wide) film, 10–30 s,
   no text or logos burnt in, **footage Brookrege owns or has a licence for**.
2. `python3 scripts/brand/build_journey.py --wide apartment.mp4 --tall villa.mp4 --version v3`
3. Find the cuts: `ffmpeg -i film.mp4 -vf "select='gt(scene,0.2)',showinfo" -an -f null - 2>&1 | grep pts_time`
4. Update `journeyChapters.ts` (version, durations, chapter starts, `focusY`, `spot`) and the chapter names and
   features in `ar.ts` / `en.ts` › `journey.films`.
5. Delete the old version folder once the new one is live.

**Current footage.** The wide film supplied is 736×414 px; it is enlarged with sharpening to 1280×720, which
looks good on laptops but softer than true HD on large monitors — a 1920 px source would be sharper. The portrait
film is 720×1280 and fills phones at full quality. The on-screen caption says "Illustrative film" because neither
is a Brookrege listing. Both came from a Pinterest-style site: confirm the rights before launch or replace them.
