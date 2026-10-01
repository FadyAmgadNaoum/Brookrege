#!/usr/bin/env bash
# TEST 3 — Replication lag < 1 second.
# Writes on the primary, then reads PostgreSQL's own measurement of how long the replica took to
# apply it (pg_stat_replication.replay_lag). Also confirms the replica actually contains the write.
source "$(dirname "$0")/lib.sh"
SAMPLES="${1:-10}"
LIMIT_MS="${2:-1000}"

step "Replication status"
status=$(sql vps1:postgres "SELECT application_name||' state='||state||' sync='||sync_state FROM pg_stat_replication")
[ -n "$status" ] && ok "Replica connected: $status" || { fail "No replica connected to the primary"; exit 1; }
[ "$(sql vps2:postgres 'SELECT pg_is_in_recovery()')" = t ] && ok "VPS2 is a read-only hot standby" || { fail "VPS2 is not in recovery mode"; exit 1; }

sql vps1:postgres "CREATE SCHEMA IF NOT EXISTS ops; CREATE TABLE IF NOT EXISTS ops.lag_probe (id int PRIMARY KEY, token text, at timestamptz)" >/dev/null

step "Measuring lag over $SAMPLES writes (limit ${LIMIT_MS} ms)"
worst=0; total=0
for i in $(seq "$SAMPLES"); do
  token="t$(now_ms)$RANDOM"
  sql vps1:postgres "INSERT INTO ops.lag_probe VALUES (1,'$token',now()) ON CONFLICT (id) DO UPDATE SET token=EXCLUDED.token, at=EXCLUDED.at" >/dev/null
  # PostgreSQL measures replay lag itself (no network/tooling overhead in the number).
  lag_ms=""
  for _ in $(seq 20); do
    lag_ms=$(sql vps1:postgres "SELECT COALESCE(ROUND(EXTRACT(EPOCH FROM replay_lag)*1000)::int, -1) FROM pg_stat_replication LIMIT 1")
    [ "$lag_ms" != "-1" ] && [ -n "$lag_ms" ] && break; sleep 0.1
  done
  [ "$lag_ms" = "-1" ] && lag_ms=0   # NULL = replica already fully caught up
  seen=$(sql vps2:postgres "SELECT token FROM ops.lag_probe WHERE id=1")
  [ "$seen" = "$token" ] || { sleep 1; seen=$(sql vps2:postgres "SELECT token FROM ops.lag_probe WHERE id=1"); }
  [ "$seen" = "$token" ] || { fail "sample $i: write not visible on replica after 1s"; exit 1; }
  total=$((total + lag_ms)); [ "$lag_ms" -gt "$worst" ] && worst=$lag_ms
  printf '     sample %2d: %4d ms\n' "$i" "$lag_ms"
  sleep 0.3
done
avg=$((total / SAMPLES))
if [ "$worst" -lt "$LIMIT_MS" ]; then ok "Replication lag: average ${avg} ms, worst ${worst} ms (< ${LIMIT_MS} ms)"; else fail "Worst lag ${worst} ms exceeds ${LIMIT_MS} ms"; exit 1; fi
