#!/usr/bin/env bash
# TEST 1 — Load balancer distribution.
# Sends N requests (sequential, then concurrent) through the load balancer and counts which
# app server answered (X-Instance header). Passes if both servers serve at least 25% each and nothing fails.
source "$(dirname "$0")/lib.sh"
N="${1:-60}"
URL="$LB_URL/api/health"

tally() { sort | uniq -c | sort -rn; }
check() {
  local label="$1" file="$2"
  local total errors servers
  total=$(wc -l < "$file")
  errors=$(grep -c '^ERR' "$file" || true)
  servers=$(grep -v '^ERR' "$file" | sort -u | wc -l)
  echo "  $label ($total requests):"; tally < "$file" | sed 's/^/     /'
  local min; min=$(grep -v '^ERR' "$file" | tally | awk 'NR==1{m=$1} {if($1<m)m=$1} END{print m+0}')
  if [ "$errors" -eq 0 ] && [ "$servers" -ge 2 ] && [ $((min * 4)) -ge "$total" ]; then ok "$label: evenly shared, 0 errors"; return 0; fi
  fail "$label: errors=$errors servers=$servers smallest share=$min/$total"; return 1
}

step "Load-balancer distribution — $URL"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
hit() { curl -s -o /dev/null -D - -m 5 "$URL" | awk -F': ' 'tolower($1)=="x-instance"{gsub("\r","",$2);print $2; f=1} END{if(!f)print "ERR"}'; }
export -f hit; export URL

for _ in $(seq "$N"); do hit; done > "$tmp/seq"
seq "$N" | xargs -P 10 -I{} bash -c hit > "$tmp/par"

rc=0
check "Sequential" "$tmp/seq" || rc=1
check "Concurrent (10 at a time)" "$tmp/par" || rc=1
exit $rc
