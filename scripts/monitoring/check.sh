#!/usr/bin/env bash
# Validates the whole monitoring configuration (used by CI; runs locally too).
#   bash scripts/monitoring/check.sh
# Uses promtool / amtool / alloy from PATH if present, otherwise the official Docker images.
set -euo pipefail
cd "$(dirname "$0")/../.."
M=infra/monitoring
fail=0
step() { printf '\n▸ %s\n' "$*"; }

tool() { # tool NAME IMAGE ENTRYPOINT ARGS…  — run a binary, or its Docker image with the repo mounted
  local name="$1" image="$2" entry="$3"; shift 3
  if type -P "$name" >/dev/null 2>&1; then command "$name" "$@"
  else docker run --rm -v "$PWD:/w" -w /w --entrypoint "$entry" "$image" "$@"; fi
}
promtool() { tool promtool prom/prometheus:v3.5.0 /bin/promtool "$@"; }
amtool() { tool amtool prom/alertmanager:v0.28.1 /bin/amtool "$@"; }
alloy() { tool alloy grafana/alloy:v1.10.2 /bin/alloy "$@"; }

step "Dashboards are up to date with scripts/monitoring/build_dashboards.py"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp -r $M/grafana/dashboards "$tmp/before"; cp $M/grafana/dashboards.queries.json "$tmp/"
python3 scripts/monitoring/build_dashboards.py >/dev/null
if diff -rq "$tmp/before" $M/grafana/dashboards >/dev/null && diff -q "$tmp/dashboards.queries.json" $M/grafana/dashboards.queries.json >/dev/null; then echo "  ✓ generated JSON matches"
else echo "  ✗ dashboards changed — run build_dashboards.py and commit the result"; fail=1; fi
python3 - <<'PY' || fail=1
import json, pathlib
for f in pathlib.Path("infra/monitoring/grafana/dashboards").glob("*.json"):
    d = json.loads(f.read_text())
    assert d["uid"] and d["panels"], f
    ids = [p["id"] for p in d["panels"]]
    assert len(ids) == len(set(ids)), f"duplicate panel ids in {f}"
print("  ✓ dashboards parse, unique panel ids")
PY

step "Render configuration for both topologies (example settings)"
env=$(mktemp); cp .env.monitoring.example "$env"
for topo in single cluster; do
  python3 $M/configure.py --topology $topo --env "$env" --skip-secret-check --secrets-dir /nonexistent
  sed "s|/etc/prometheus/targets|$M/generated/targets|g; s|/etc/prometheus/rules|$M/prometheus/rules|g" $M/prometheus/prometheus.yml > "$tmp/prometheus-$topo.yml"
  promtool check config --syntax-only "$tmp/prometheus-$topo.yml" || fail=1
  amtool check-config $M/generated/alertmanager.yml || fail=1
done

step "Alert and recording rules"
promtool check rules $M/prometheus/rules/*.yml || fail=1
promtool test rules $M/prometheus/tests/alerts_test.yml || fail=1

step "Every alert links to an existing runbook section"
python3 - <<'PY' || fail=1
import re, pathlib
rules = pathlib.Path("infra/monitoring/prometheus/rules/alerts.yml").read_text()
book = pathlib.Path("docs/operations/RUNBOOKS.md").read_text()
anchors = {re.sub(r"[^a-z0-9]", "", h.lower()) for h in re.findall(r"^## (.+)$", book, re.M)}
missing = sorted({a for a in re.findall(r"RUNBOOKS\.md#([a-z0-9-]+)", rules) if a not in anchors})
if missing: raise SystemExit("  ✗ no runbook section for: " + ", ".join(missing))
print(f"  ✓ {len(set(re.findall(r'RUNBOOKS.md#([a-z0-9-]+)', rules)))} runbook links resolve")
PY

step "Alloy (log shipping) configuration"
alloy fmt $M/alloy/config.alloy >/dev/null && echo "  ✓ alloy config parses" || fail=1

[ "$fail" = 0 ] && printf '\n✓ Monitoring configuration is valid\n' || { printf '\n✗ Monitoring configuration has problems\n'; exit 1; }
