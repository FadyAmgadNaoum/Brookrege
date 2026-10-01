#!/usr/bin/env python3
"""
Runs every dashboard query against a live Prometheus and Loki, and checks every alert/recording rule
is evaluating without errors. Use it after installing monitoring, or after changing dashboards:

    ssh -L 9090:127.0.0.1:9090 -L 3100:10.0.0.1:3100 deploy@<vps1>        # in another terminal
    python3 scripts/monitoring/verify-dashboards.py --prometheus http://127.0.0.1:9090 --loki http://127.0.0.1:3100

Exit 1 if any query is invalid or any rule fails. Queries that return no data are listed separately
(normal for things that haven't happened yet, e.g. no deadlocks, or components not installed).
"""
import argparse, json, pathlib, sys, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SUBST = {"$__rate_interval": "1m", "$__interval": "1m", "$__auto": "1m", "$server": ".*"}


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)


def run(base, path, params):
    try:
        return get(f"{base}{path}?{urllib.parse.urlencode(params)}"), None
    except urllib.error.HTTPError as e:
        try:
            return None, json.load(e).get("error", str(e))
        except Exception:
            return None, str(e)
    except Exception as e:  # connection problems
        return None, str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prometheus", default="http://127.0.0.1:9090")
    ap.add_argument("--loki", default="http://127.0.0.1:3100")
    ap.add_argument("--quiet", action="store_true", help="only print problems")
    a = ap.parse_args()

    queries = json.loads((ROOT / "infra/monitoring/grafana/dashboards.queries.json").read_text())
    errors, empty, ok = [], [], 0
    for q in queries:
        expr = q["expr"]
        for k, v in SUBST.items():
            expr = expr.replace(k, v)
        if q["datasource"] == "loki":
            is_logs = not expr.lstrip().startswith(("sum", "count", "rate", "topk"))
            data, err = run(a.loki, "/loki/api/v1/query_range", {"query": expr, "limit": 5, "since": "1h"} if is_logs else {"query": expr, "since": "1h", "step": "60"})
        else:
            data, err = run(a.prometheus, "/api/v1/query", {"query": expr})
        where = f'{q["dashboard"]} › {q["panel"]}'
        if err:
            errors.append(f"{where}: {err}\n      {expr}")
        elif not data["data"]["result"]:
            empty.append(f"{where}: {expr[:110]}")
        else:
            ok += 1

    rules, err = run(a.prometheus, "/api/v1/rules", {})
    bad_rules = []
    if err:
        errors.append(f"rules API: {err}")
    else:
        for g in rules["data"]["groups"]:
            for r in g["rules"]:
                if r.get("health") not in ("ok", "unknown"):
                    bad_rules.append(f'{g["name"]} › {r["name"]}: {r.get("lastError")}')
        n_rules = sum(len(g["rules"]) for g in rules["data"]["groups"])

    print(f"Dashboard queries: {ok} returned data, {len(empty)} empty, {len(errors)} invalid (of {len(queries)})")
    if not err:
        print(f"Rules: {n_rules - len(bad_rules)} evaluating fine, {len(bad_rules)} failing")
    for e in errors:
        print("  ✗ " + e)
    for r in bad_rules:
        print("  ✗ rule " + r)
    if empty and not a.quiet:
        print("  No data yet (fine if that component isn't installed or nothing has happened):")
        for e in empty:
            print("    · " + e)
    sys.exit(1 if errors or bad_rules else 0)


if __name__ == "__main__":
    main()
