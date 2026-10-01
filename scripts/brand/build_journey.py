#!/usr/bin/env python3
"""
Prepares the home-page films (the scroll-driven walk through a home) and the still photos the inner pages use.

  python3 scripts/brand/build_journey.py --wide apartment.mp4 --tall villa.mp4 [--version v2]

Two films, chosen by the shape of the screen (components/home/journeyChapters.ts):
  wide  landscape film for computers, laptops and tablets held sideways
  tall  portrait (9:16) film for phones and tablets held upright
Writes apps/web/public/journey/<version>/:
  wide.mp4 / wide.webm                 1280×720, sharpened when the source is smaller
  tall.mp4 / tall.webm                 720 px wide (portrait tablets)
  tall-small.mp4 / tall-small.webm     540 px wide (phones, ~40% smaller)
  poster-wide.webp, poster-tall.webp   first frames, shown instantly and when motion is reduced
  stills/*.webp                        photos for the inner pages' title banners (STILLS below)
Every film: H.264 (+ VP9 copy for browsers without H.264), 24 fps, no sound, a keyframe every 8 frames so
scrolling can jump to any moment instantly.

Footage: at least 1920 px on the long side looks best; only use footage Brookrege owns or has a licence for.
Changing a film? Use a new --version (files are cached for a year), then update journeyChapters.ts and the
chapter texts in lib/i18n.
"""
import argparse, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# name → (film, second, crop) — crop "band" takes a landscape band from a portrait film.
STILLS = {
    "living": ("wide", 0.6, None), "dining": ("wide", 3.0, None), "kitchen": ("wide", 5.2, None),
    "bedroom": ("wide", 7.2, None), "view": ("wide", 9.4, None),
    "facade": ("tall", 16.4, "band"), "pool": ("tall", 23.6, "band"), "entrance": ("tall", 8.4, "band"),
}

def run(*a):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *a])
    if r.returncode: sys.exit(r.returncode)

H264 = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-g", "8", "-keyint_min", "8", "-sc_threshold", "0",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart"]
VP9 = ["-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "45", "-g", "8", "-row-mt", "1", "-deadline", "good",
       "-cpu-used", "2", "-pix_fmt", "yuv420p"]

def film(src, vf, out, extra=0):
    """extra: raise the quality numbers (smaller files) for long portrait films."""
    h = [x if x != "27" else str(27 + extra) for x in H264]
    v = [x if x != "45" else str(45 + extra) for x in VP9]
    run("-i", str(src), "-vf", vf, *h, str(out.with_suffix(".mp4")))
    run("-i", str(src), "-vf", vf, *v, str(out.with_suffix(".webm")))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wide", required=True, type=pathlib.Path)
    ap.add_argument("--tall", required=True, type=pathlib.Path)
    ap.add_argument("--version", default="v2")
    a = ap.parse_args()
    out = ROOT / "apps/web/public/journey" / a.version
    (out / "stills").mkdir(parents=True, exist_ok=True)
    # Lanczos + light sharpening reads crisper than the browser's own enlargement of a small source.
    wide_vf = "fps=24,scale=1280:720:flags=lanczos,unsharp=5:5:0.5"
    film(a.wide, wide_vf, out / "wide")
    film(a.tall, "fps=24,scale=720:-2:flags=lanczos", out / "tall", extra=2)
    film(a.tall, "fps=24,scale=540:-2:flags=lanczos", out / "tall-small", extra=2)
    run("-i", str(a.wide), "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos,unsharp=5:5:0.5", "-c:v", "libwebp", "-quality", "74", str(out / "poster-wide.webp"))
    run("-i", str(a.tall), "-frames:v", "1", "-vf", "scale=720:-2", "-c:v", "libwebp", "-quality", "74", str(out / "poster-tall.webp"))
    for name, (which, t, crop) in STILLS.items():
        src = a.wide if which == "wide" else a.tall
        vf = "scale=1600:-2:flags=lanczos,unsharp=5:5:0.4" if crop is None else "crop=iw:iw*9/16:0:ih*0.45,scale=1600:-2:flags=lanczos,unsharp=5:5:0.4"
        run("-ss", str(t), "-i", str(src), "-frames:v", "1", "-vf", vf, "-c:v", "libwebp", "-quality", "70", str(out / "stills" / f"{name}.webp"))
    for f in sorted(out.rglob("*")):
        if f.is_file(): print(f"✓ {f.relative_to(ROOT)}  {f.stat().st_size / 1e6:.2f} MB")

main()
