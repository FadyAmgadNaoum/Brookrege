#!/usr/bin/env bash
# After failover-db.sh: turn VPS1's old (stopped) primary into a replica of the new primary on VPS2,
# so the cluster has redundancy again. Production only (CLUSTER_MODE=ssh).
# The local simulation is simply reset:  docker compose -f docker-compose.cluster.yml down -v
source "$(dirname "$0")/lib.sh"
[ "$MODE" = ssh ] || { echo "Local mode: reset the simulation with 'docker compose -f docker-compose.cluster.yml down -v'."; exit 0; }

step "Checking VPS2 is the primary"
[ "$(sql vps2:postgres 'SELECT pg_is_in_recovery()')" = f ] || { fail "VPS2 is not a primary — run failover-db.sh first."; exit 1; }
ok "VPS2 is primary"

read -r -p "This ERASES the old database copy on VPS1 and re-clones it from VPS2. Type 'reinit': " a
[ "$a" = reinit ] || { echo "Cancelled."; exit 1; }

step "Creating replication slot 'vps1' on VPS2"
sql vps2:postgres "SELECT pg_create_physical_replication_slot('vps1') WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='vps1')" >/dev/null
ok "Slot ready"

step "Re-cloning VPS1 as a replica"
# shellcheck disable=SC2087  # $REMOTE_DIR is meant to expand here, before the script is sent
ssh "$(ssh_dest vps1)" bash -s <<REMOTE
set -euo pipefail
cd $REMOTE_DIR/infra/servers/vps1
docker compose --env-file ../../../.env.cluster stop postgres
docker compose --env-file ../../../.env.cluster rm -f postgres
docker volume rm brookrege-vps1_pgdata
cd $REMOTE_DIR
sed -i '/^VPS1_PG_ROLE=/d; /^VPS1_PG_PRIMARY_HOST=/d; /^VPS1_REPLICATION_SLOT=/d' .env.cluster
printf 'VPS1_PG_ROLE=replica\nVPS1_PG_PRIMARY_HOST=10.0.0.2\nVPS1_REPLICATION_SLOT=vps1\n' >> .env.cluster
cd infra/servers/vps1 && docker compose --env-file ../../../.env.cluster up -d postgres
REMOTE
for _ in $(seq 120); do [ "$(sql vps1:postgres 'SELECT pg_is_in_recovery()' 2>/dev/null)" = t ] && break; sleep 5; done
[ "$(sql vps1:postgres 'SELECT pg_is_in_recovery()')" = t ] && ok "VPS1 is streaming from VPS2" || { fail "VPS1 replica did not come up"; exit 1; }

step "Sending public reads to the VPS1 replica"
run vps1:pgbouncer sh -c "printf 'PRIMARY_HOST=10.0.0.2\nREPLICA_HOST=postgres\n' > /state/targets.env" && compose vps1:pgbouncer restart >/dev/null
ok "pgBouncer: writes → VPS2, public reads → VPS1"
echo "Redundancy restored. Roles are now swapped; there is no need to switch back."
