#!/usr/bin/env python3
"""
Lists every HTTP route of the API by reading the Express routers (no need to run the server), and — with
--check — verifies docs/api/openapi.yaml documents exactly those routes. Used by CI so the API reference
can't silently fall behind the code.

    python3 scripts/api/routes.py            # print the routes
    python3 scripts/api/routes.py --check    # compare with docs/api/openapi.yaml (exit 1 on differences)
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "apps/api/src"

def routes():
    files = list(SRC.rglob("*.ts"))
    text = {f: f.read_text() for f in files}
    # where each router is mounted: parent.use("/prefix", child) or parent.use(["/a", "/b"], child)
    mounts = {}
    for f, t in text.items():
        for parent, prefix, child in re.findall(r'(\w+)\.use\(\s*"([^"]*)"\s*,\s*(\w+Router)\s*\)', t):
            mounts[child] = (parent, prefix)
    def full(router):
        parts = []
        while router in mounts:
            parent, prefix = mounts[router]
            parts.insert(0, prefix.rstrip("/"))
            router = parent
        base = {"app": ""}.get(router, "")
        return base + "".join(parts)
    out = set()
    for f, t in text.items():
        for router, method, path in re.findall(r'(\w+)\.(get|post|put|patch|delete)\(\s*"(/[^"]*)"', t):
            if router == "app":
                prefix = ""
            elif router.endswith("Router"):
                prefix = full(router)
            else:
                continue
            p = (prefix + ("" if path == "/" and prefix else path)) or "/"
            p = re.sub(r":(\w+)", r"{\1}", p)  # Express :id → OpenAPI {id}
            out.add((method.upper(), p))
    return sorted(out, key=lambda r: (r[1], r[0]))

def documented():
    import yaml
    spec = yaml.safe_load((ROOT / "docs/api/openapi.yaml").read_text())
    return sorted({(m.upper(), p) for p, ops in spec["paths"].items() for m in ops if m in ("get", "post", "put", "patch", "delete")}, key=lambda r: (r[1], r[0]))

if __name__ == "__main__":
    code = routes()
    if "--check" not in sys.argv:
        for m, p in code:
            print(f"{m:7} {p}")
        print(f"{len(code)} routes")
        sys.exit(0)
    docs = documented()
    missing = [r for r in code if r not in docs]
    extra = [r for r in docs if r not in code]
    for m, p in missing:
        print(f"✗ not documented: {m} {p}")
    for m, p in extra:
        print(f"✗ documented but not in the code: {m} {p}")
    print(f"{'✓' if not missing and not extra else '✗'} {len(code)} routes in the code, {len(docs)} in docs/api/openapi.yaml")
    sys.exit(1 if missing or extra else 0)
