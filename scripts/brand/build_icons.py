#!/usr/bin/env python3
"""
Builds the site icons and the social-sharing image from one brand mark (Phase 4 · Week 16).

  apps/web/app/icon.svg          browser tab (modern browsers)
  apps/web/app/favicon.ico       browser tab (16/32/48 px, older browsers and bookmarks)
  apps/web/app/apple-icon.png    iPhone/iPad home screen (180 px)
  apps/web/public/icon-192.png, icon-512.png   Android home screen (web manifest)
  apps/web/public/og.png         link previews on WhatsApp/Facebook/X (1200×630)
  apps/admin/app/icon.svg, favicon.ico         the admin gets the mark on a dark tile, so the two tabs differ

The mark: a roof line over a sandstone ground line, limestone on date-palm green (the site's colours).
Needs Pillow with libraqm (Arabic shaping) and IBM Plex Sans Arabic (github.com/IBM/plex releases):
  python3 scripts/brand/build_icons.py --fonts /path/to/ibm-plex-sans-arabic/fonts/complete/ttf
The generated files are committed; run this only when the brand changes.
"""
import argparse, pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
PALM, PALM_DARK, LIME, SAND, SILT, SOFT, LINE = "#41594F", "#1C2622", "#F2F3EF", "#A8875A", "#22302C", "#56625D", "#D9DDD5"

def svg(tile: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f'<rect width="64" height="64" rx="14" fill="{tile}"/>'
            f'<path d="M15 35 32 20l17 15" fill="none" stroke="{LIME}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M21 45h22" stroke="{SAND}" stroke-width="5.5" stroke-linecap="round"/></svg>\n')

def mark(size: int, tile: str, rounded=True) -> Image.Image:
    """Draw the same mark as the SVG at 8× and scale down (anti-aliasing)."""
    k = size * 8 / 64
    im = Image.new("RGBA", (size * 8, size * 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded: d.rounded_rectangle([0, 0, size * 8 - 1, size * 8 - 1], radius=int(14 * k), fill=tile)
    else: d.rectangle([0, 0, size * 8, size * 8], fill=tile)
    w = int(5.5 * k)
    def line(pts, color):
        pts = [(x * k, y * k) for x, y in pts]
        d.line(pts, fill=color, width=w, joint="curve")
        for x, y in (pts[0], pts[-1]): d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)
    line([(15, 35), (32, 20), (49, 35)], LIME)
    line([(21, 45), (43, 45)], SAND)
    return im.resize((size, size), Image.LANCZOS)

def og(fonts: pathlib.Path) -> Image.Image:
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), LIME)
    d = ImageDraw.Draw(im)
    f = lambda w, s: ImageFont.truetype(str(fonts / f"IBMPlexSansArabic-{w}.ttf"), s, layout_engine=ImageFont.Layout.RAQM)
    # Arabic-first, right-aligned like the site; the mark sits at the right edge.
    right = W - 96
    im.paste(mark(132, PALM), (right - 132, 96), mark(132, PALM))
    def text_r(y, s, font, color, rtl=True):
        kw = {"direction": "rtl", "language": "ar"} if rtl else {}
        w = d.textlength(s, font=font, **kw)
        d.text((right - w, y), s, font=font, fill=color, **kw)
    text_r(262, "عقارات في سوهاج", f("SemiBold", 84), SILT)
    text_r(380, "شقق · فيلات · محلات · أراضي — للبيع والإيجار", f("Regular", 40), SOFT)
    d.rounded_rectangle([right - 180, 470, right, 476], radius=3, fill=SAND)
    d.text((96, 500), "Brookrege", font=f("SemiBold", 44), fill=PALM)
    d.text((96, 556), "Real estate in Sohag, Egypt", font=f("Regular", 26), fill=SOFT)
    d.line([(0, H - 1), (W, H - 1)], fill=LINE, width=2)
    return im

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", required=True, type=pathlib.Path, help="folder with IBMPlexSansArabic-*.ttf")
    a = ap.parse_args()
    web, admin = ROOT / "apps/web", ROOT / "apps/admin"
    (web / "public").mkdir(exist_ok=True)
    (web / "app/icon.svg").write_text(svg(PALM))
    (admin / "app/icon.svg").write_text(svg(PALM_DARK))
    for app, tile in ((web, PALM), (admin, PALM_DARK)):
        mark(48, tile).save(app / "app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    # Home-screen icons are square: iOS and Android round the corners themselves.
    mark(180, PALM, rounded=False).convert("RGB").save(web / "app/apple-icon.png", optimize=True)
    for s in (192, 512): mark(s, PALM, rounded=False).convert("RGB").save(web / f"public/icon-{s}.png", optimize=True)
    og(a.fonts).save(web / "public/og.png", optimize=True)
    print("✓ icons and og.png written")

main()
