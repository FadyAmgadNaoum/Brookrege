#!/usr/bin/env bash
# Runs every Week 5 test against the local 3-server simulation, including a real database failover.
#   docker compose -f docker-compose.cluster.yml up --build -d
#   bash scripts/cluster/run-local-drill.sh
# Afterwards the simulation runs on the promoted replica. Reset: docker compose -f docker-compose.cluster.yml down -v
source "$(dirname "$0")/lib.sh"
DIR="$(dirname "$0")"
NAMES=(); RESULTS=()   # plain arrays: works with macOS bash 3.2 too

step "Waiting for the cluster (first build can take several minutes)"
for i in $(seq 150); do
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$LB_URL/api/health" || true)
  [ "$code" = 200 ] && { ok "Load balancer is serving (after ~$((i * 2))s)"; break; }
  sleep 2
done
[ "$code" = 200 ] || { fail "Cluster not ready. Check: docker compose -f docker-compose.cluster.yml ps"; exit 1; }
sleep 5  # let both app servers finish warming up

record() { NAMES+=("$1"); RESULTS+=("$2"); }
run_test() { local name="$1"; shift; if "$@"; then record "$name" PASS; else record "$name" FAIL; fi; }
run_test "1. Load balancer distribution" bash "$DIR/test-lb-distribution.sh" 60
run_test "2. App server failure (kill VPS2)" bash "$DIR/test-app-failover.sh" 40
run_test "3. Replication lag < 1 s" bash "$DIR/test-replication-lag.sh" 10
run_test "4. Database failover (switchover)" bash "$DIR/failover-db.sh" --planned --yes

step "5. Site works after the database failover"
post_ok=1
for i in $(seq 30); do
  h=$(curl -s -m 5 "$LB_URL/api/health" || true)
  echo "$h" | grep -q '"primary":"ok"' && break; sleep 1
done
echo "$h" | grep -q '"primary":"ok"' && ok "API healthy on the new primary" || { fail "API not healthy: $h"; post_ok=0; }
list=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$LB_URL/api/properties?transaction=SALE")
[ "$list" = 200 ] && ok "Listings load (reads)" || { fail "Listings returned $list"; post_ok=0; }
sub=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"ownerName":"Failover Drill","phone":"01012345678","propertyType":"APARTMENT","transaction":"SALE"}' "$LB_URL/api/submissions")
[ "$sub" = 201 ] && ok "'Add your property' form saves (writes)" || { fail "Form submit returned $sub"; post_ok=0; }
record "5. Reads + writes after failover" "$([ $post_ok = 1 ] && echo PASS || echo FAIL)"

step "Summary"
rc=0
for i in "${!NAMES[@]}"; do
  if [ "${RESULTS[$i]}" = PASS ]; then ok "${NAMES[$i]}"; else fail "${NAMES[$i]}"; rc=1; fi
done
echo; echo "Reset the simulation: docker compose -f docker-compose.cluster.yml down -v"
exit $rc
