#!/usr/bin/env bash
# Database failover: promote the VPS2 replica to primary and point pgBouncer at it.
#
#   failover-db.sh             EMERGENCY — the primary is down. Refuses to run if the primary is healthy.
#   failover-db.sh --planned   SWITCHOVER — primary is healthy (maintenance, drills). Stops it cleanly
#                              first, confirms the replica has every write, then promotes: zero data loss.
#   add --yes to skip the confirmation prompt.
#
# Split-brain protection: the old primary is always stopped ("fenced") before the replica is promoted
# when it can be reached. If it cannot be reached it must NOT be restarted as a primary — see the
# printed next steps (reinit-replica.sh turns it into the new replica).
source "$(dirname "$0")/lib.sh"

PLANNED=0; YES=0
for a in "$@"; do case "$a" in --planned) PLANNED=1 ;; --yes) YES=1 ;; *) echo "Unknown option $a"; exit 2 ;; esac; done
NEW_PRIMARY_HOST="${NEW_PRIMARY_HOST:-$([ "$MODE" = local ] && echo pg-replica || echo 10.0.0.2)}"
T0=$(now_ms)

step "1/6 Checking the replica (VPS2)"
in_rec=$(sql vps2:postgres "SELECT pg_is_in_recovery()" 2>/dev/null || echo unreachable)
case "$in_rec" in
  t) ok "Replica is up and in standby mode" ;;
  f) fail "VPS2 is already a primary — nothing to promote."; exit 1 ;;
  *) fail "Cannot reach the replica on VPS2 — failover impossible. Restore from backup instead."; exit 1 ;;
esac

step "2/6 Checking the primary (VPS1)"
primary_up=0
sql vps1:postgres "SELECT 1" >/dev/null 2>&1 && primary_up=1
if [ $primary_up = 1 ] && [ $PLANNED = 0 ]; then
  fail "The primary is healthy. For maintenance or a drill run:  $0 --planned"; exit 1
fi
[ $primary_up = 1 ] && ok "Primary is healthy — planned switchover" || ok "Primary is down — emergency failover"

if [ $YES = 0 ]; then
  read -r -p "Promote VPS2 to primary and switch all traffic to it? Type 'promote': " answer
  [ "$answer" = promote ] || { echo "Cancelled."; exit 1; }
fi

step "3/6 Fencing the old primary"
if [ $primary_up = 1 ]; then
  target_lsn=$(sql vps1:postgres "SELECT pg_current_wal_lsn()")
  # docker stop sends SIGINT to the postgres image = fast shutdown: clients disconnected,
  # final WAL (incl. shutdown checkpoint) streamed to the replica before exit.
  compose vps1:postgres stop -t 60 >/dev/null
  ok "Old primary stopped cleanly (last position $target_lsn)"
  for _ in $(seq 30); do
    caught=$(sql vps2:postgres "SELECT pg_last_wal_receive_lsn() >= '$target_lsn'::pg_lsn")
    [ "$caught" = t ] && break; sleep 1
  done
  [ "$caught" = t ] && ok "Replica has received every write — no data loss" || { fail "Replica is behind; restart the primary and retry later: compose start postgres"; exit 1; }
else
  if compose vps1:postgres stop -t 10 >/dev/null 2>&1; then ok "Old primary container stopped"
  else fail "Could not reach VPS1 to stop Postgres. Do NOT start it again as primary (see next steps)."; fi
fi

step "4/6 Promoting VPS2"
promoted=$(sql vps2:postgres "SELECT pg_promote(true, 60)")
[ "$promoted" = t ] && [ "$(sql vps2:postgres 'SELECT pg_is_in_recovery()')" = f ] \
  && ok "VPS2 is now the primary (read-write)" || { fail "Promotion failed"; exit 1; }

step "5/6 Pointing pgBouncer at the new primary"
if run vps1:pgbouncer sh -c "printf 'PRIMARY_HOST=%s\nREPLICA_HOST=%s\n' '$NEW_PRIMARY_HOST' '$NEW_PRIMARY_HOST' > /state/targets.env" \
   && compose vps1:pgbouncer restart >/dev/null; then
  ok "pgBouncer now routes reads and writes to $NEW_PRIMARY_HOST"
else
  fail "pgBouncer on VPS1 unreachable. If VPS1 is lost entirely, follow docs/PHASE2-WEEK5.md → 'VPS1 lost'."; exit 1
fi

step "6/6 Verifying writes through pgBouncer"
for _ in $(seq 30); do
  res=$(run vps1:pgbouncer psql -X -q -t -A "host=127.0.0.1 port=6432 dbname=$DB_NAME user=$DB_USER" -c \
    "CREATE SCHEMA IF NOT EXISTS ops; CREATE TABLE IF NOT EXISTS ops.failover_probe (at timestamptz); INSERT INTO ops.failover_probe VALUES (now()); SELECT pg_is_in_recovery();" 2>/dev/null || true)
  [ "$(echo "$res" | tail -n1)" = f ] && break; sleep 1
done
[ "$(echo "$res" | tail -n1)" = f ] && ok "Write succeeded through pgBouncer" || { fail "Writes through pgBouncer are failing"; exit 1; }

printf '\n\033[32mFailover complete in %s s.\033[0m App servers reconnect automatically.\n' "$(( ($(now_ms) - T0) / 1000 ))"
cat <<NEXT

Next steps
  • The old primary is stopped. Never start it as a primary again (that would split the data in two).
  • Rebuild it as the new replica when VPS1 is healthy:   scripts/cluster/reinit-replica.sh
  • Until then the site runs without a replica (reads fall back to the primary automatically).
NEXT
