#!/bin/sh
# One entrypoint for both database roles, selected with PG_ROLE:
#   primary  — normal PostgreSQL (official image entrypoint; init scripts create the replication user + slot)
#   replica  — on first start, clones the primary with pg_basebackup and follows it (streaming replication)
# After a failover the promoted replica keeps using this entrypoint: its data dir exists and standby.signal
# was removed by the promotion, so it simply starts as the new primary.
set -eu
set -f  # no glob expansion (listen_addresses=*)

FLAGS="-c listen_addresses=* -c hba_file=/etc/postgresql/pg_hba.conf -c password_encryption=scram-sha-256
 -c wal_level=replica -c max_wal_senders=10 -c max_replication_slots=10
 -c wal_keep_size=512MB -c max_slot_wal_keep_size=4GB
 -c hot_standby=on -c hot_standby_feedback=on -c wal_log_hints=on
 -c max_connections=${PG_MAX_CONNECTIONS:-200} -c shared_buffers=${PG_SHARED_BUFFERS:-256MB}
 -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top
 -c log_min_duration_statement=${PG_SLOW_QUERY_MS:-500} -c track_io_timing=on"

if [ "${PG_ROLE:-primary}" = "replica" ]; then
  : "${PRIMARY_HOST:?PRIMARY_HOST is required for a replica}"
  : "${REPLICATION_PASSWORD:?REPLICATION_PASSWORD is required for a replica}"
  PGDATA="${PGDATA:-/var/lib/postgresql/data}"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "[replica] waiting for primary ${PRIMARY_HOST}:${PRIMARY_PORT:-5432}"
    until pg_isready -q -h "$PRIMARY_HOST" -p "${PRIMARY_PORT:-5432}"; do sleep 2; done
    echo "[replica] cloning primary (slot ${REPLICATION_SLOT:-replica_1})"
    mkdir -p "$PGDATA" && chown -R postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
    su-exec postgres env PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
      -h "$PRIMARY_HOST" -p "${PRIMARY_PORT:-5432}" -U replicator -D "$PGDATA" \
      -X stream -R -S "${REPLICATION_SLOT:-replica_1}" --checkpoint=fast
    echo "[replica] clone complete — starting as hot standby"
  fi
  # shellcheck disable=SC2086
  exec su-exec postgres postgres $FLAGS
fi

# shellcheck disable=SC2086
exec docker-entrypoint.sh postgres $FLAGS
