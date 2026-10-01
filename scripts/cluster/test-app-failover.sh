#!/usr/bin/env bash
# TEST 2 — App server failure ("kill VPS2").
# Stops every app container on VPS2, keeps sending traffic, and verifies that VPS3 answers every
# request with no errors. Then restores VPS2 and verifies it rejoins the pool.
source "$(dirname "$0")/lib.sh"
N="${1:-40}"
URL="$LB_URL/api/health"
PAGE="$LB_URL/ar"

restore() { compose vps2:api start >/dev/null 2>&1 || true; compose vps2:web start >/dev/null 2>&1 || true; compose vps2:admin start >/dev/null 2>&1 || true; }
trap restore EXIT

step "App-server failover — stopping VPS2 (api, web, admin)"
compose vps2:api stop >/dev/null; compose vps2:web stop >/dev/null; compose vps2:admin stop >/dev/null
ok "VPS2 app containers stopped"

codes=""; instances=""
for _ in $(seq "$N"); do
  out=$(curl -s -o /dev/null -D - -m 10 -w 'CODE:%{http_code}\n' "$URL" || echo "CODE:000")
  codes+="$(echo "$out" | sed -n 's/^CODE://p') "
  instances+="$(echo "$out" | awk -F': ' 'tolower($1)=="x-instance"{gsub("\r","",$2);print $2}') "
done
page_code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PAGE")
bad=$(tr ' ' '\n' <<<"$codes" | grep -v '^$' | grep -vc '^200$' || true)
served=$(tr ' ' '\n' <<<"$instances" | grep -v '^$' | sort | uniq -c)
echo "  answered by:"; echo "$served" | sed 's/^/     /'
rc=0
[ "$bad" -eq 0 ] && ok "$N/$N API requests succeeded while VPS2 was down" || { fail "$bad of $N API requests failed"; rc=1; }
[ "$page_code" = 200 ] && ok "Homepage still loads (HTTP 200)" || { fail "Homepage returned $page_code"; rc=1; }

step "Restoring VPS2"
restore; trap - EXIT
for i in $(seq 60); do
  sleep 2
  seen=$(for _ in $(seq 10); do curl -s -o /dev/null -D - -m 5 "$URL" | awk -F': ' 'tolower($1)=="x-instance"{gsub("\r","",$2);print $2}'; done | sort -u | wc -l)
  [ "$seen" -ge 2 ] && { ok "VPS2 is back in the pool after ~$((i * 2))s"; exit $rc; }
done
fail "VPS2 did not rejoin within 120s"; exit 1
