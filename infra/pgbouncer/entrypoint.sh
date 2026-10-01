#!/bin/sh
# Renders pgbouncer.ini, then runs pgBouncer as PID 1.
# Database targets come from /state/targets.env when present (written by the failover script and
# kept in a volume, so a promoted replica stays the target across restarts), otherwise from env.
set -eu
[ -f /state/targets.env ] && . /state/targets.env
: "${DB_NAME:?}" "${DB_USER:?}" "${DB_PASSWORD:?}" "${PRIMARY_HOST:?}"
export DB_NAME PRIMARY_HOST
export PRIMARY_PORT="${PRIMARY_PORT:-5432}"
export REPLICA_HOST="${REPLICA_HOST:-$PRIMARY_HOST}"
export REPLICA_PORT="${REPLICA_PORT:-$PRIMARY_PORT}"
export POOL_SIZE="${POOL_SIZE:-20}"
envsubst '${DB_NAME} ${PRIMARY_HOST} ${PRIMARY_PORT} ${REPLICA_HOST} ${REPLICA_PORT} ${POOL_SIZE}' \
  < /etc/pgbouncer/pgbouncer.ini.template > /run/pgbouncer/pgbouncer.ini
printf '"%s" "%s"\n' "$DB_USER" "$DB_PASSWORD" > /run/pgbouncer/userlist.txt
chmod 600 /run/pgbouncer/userlist.txt
echo "[pgbouncer] ${DB_NAME} -> ${PRIMARY_HOST}:${PRIMARY_PORT} | ${DB_NAME}_ro -> ${REPLICA_HOST}:${REPLICA_PORT}"
exec pgbouncer /run/pgbouncer/pgbouncer.ini
