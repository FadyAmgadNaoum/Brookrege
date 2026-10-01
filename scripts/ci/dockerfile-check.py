#!/usr/bin/env python3
"""Fails when a Next.js app has a public/ folder but its Dockerfile doesn't copy it into the image
(the standalone build leaves it out, so icons, images and videos would 404 in production)."""
import pathlib, sys
root = pathlib.Path(__file__).resolve().parents[2]
bad = 0
for app in ("web", "admin"):
    d = root / "apps" / app
    if (d / "public").is_dir() and f"/repo/apps/{app}/public" not in (d / "Dockerfile").read_text():
        print(f"✗ apps/{app}/Dockerfile doesn't copy apps/{app}/public into the image"); bad = 1
    else:
        print(f"✓ apps/{app}: public/ is in the image")
sys.exit(bad)
