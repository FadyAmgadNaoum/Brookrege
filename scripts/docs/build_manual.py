#!/usr/bin/env python3
"""
Builds docs/training/admin-manual/Brookrege-Admin-Manual.pdf from manual.html with Chromium (Playwright).
  python3 scripts/docs/build_manual.py --fonts /path/to/ibm-plex-sans-arabic/fonts/complete/ttf
Fonts: IBM Plex Sans Arabic (github.com/IBM/plex releases). Needs Python Playwright or Node Playwright + Chromium.
The PDF is committed; rebuild after editing manual.html.
"""
import argparse, pathlib, subprocess, tempfile, json, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "docs/training/admin-manual/manual.html"
OUT = ROOT / "docs/training/admin-manual/Brookrege-Admin-Manual.pdf"

FOOTER = ('<div style="font-family:sans-serif;font-size:7.5pt;color:#56625D;width:100%;padding:0 17mm;display:flex;justify-content:space-between">'
          '<span>Brookrege Admin Manual</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", required=True, type=pathlib.Path)
    a = ap.parse_args()
    html = SRC.read_text().replace("__FONT_DIR__", a.fonts.resolve().as_uri())
    with tempfile.TemporaryDirectory() as d:
        page = pathlib.Path(d) / "manual.html"
        page.write_text(html)
        js = f"""
const {{ chromium }} = require('playwright');
(async () => {{
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto({json.dumps(page.as_uri())}, {{ waitUntil: 'load' }});
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({{ path: {json.dumps(str(OUT))}, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>', footerTemplate: {json.dumps(FOOTER)}, preferCSSPageSize: true }});
  await b.close();
}})().catch((e) => {{ console.error(e); process.exit(1); }});
"""
        r = subprocess.run(["node", "-e", js], cwd=d)
        if r.returncode: sys.exit(r.returncode)
    print(f"✓ {OUT.relative_to(ROOT)}")

main()
