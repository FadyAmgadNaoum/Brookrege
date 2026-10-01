#!/bin/sh
# Runs ONCE when a primary's data directory is first created (docker-entrypoint-initdb.d).
# Creates the replication login and a physical slot so the primary keeps WAL until the replica has it.
set -eu
: "${REPLICATION_PASSWORD:?REPLICATION_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v pw="$REPLICATION_PASSWORD" -v slot="${REPLICATION_SLOT:-replica_1}" <<'EOSQL'
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD :'pw';
SELECT pg_create_physical_replication_slot(:'slot');
CREATE SCHEMA IF NOT EXISTS ops; -- operational probes (replication-lag test); never used by the app
EOSQL
echo "[primary] replication role and slot '${REPLICATION_SLOT:-replica_1}' created"
