#!/usr/bin/env bash
# EMERGENCY: sign every staff member out of the admin, immediately (suspected account compromise).
# Ends all server-side sessions and refresh tokens; the next admin request of every browser gets 401.
# Everyone signs in again with their password. Nothing else changes. Recorded in the activity log.
#
#   bash scripts/ops/revoke-all-sessions.sh                                        # single server (docker-compose.prod.yml)
#   COMPOSE="docker compose -f infra/servers/vps1/docker-compose.yml --env-file .env.cluster" bash scripts/ops/revoke-all-sessions.sh
#   PSQL="psql postgresql://…" bash scripts/ops/revoke-all-sessions.sh             # any direct connection to the PRIMARY
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
REASON="${REASON:-incident}"
if [ -z "${PSQL:-}" ]; then
  PSQL="$COMPOSE exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\"'"
fi
[ "${YES:-}" = 1 ] || { read -r -p "Sign out ALL staff now? Type yes: " a; [ "$a" = yes ] || { echo "Cancelled."; exit 1; }; }
eval "$PSQL" <<SQL
BEGIN;
WITH s AS (
  UPDATE "AdminSession" SET "revokedAt" = now(), "revokedReason" = 'admin'
  WHERE "revokedAt" IS NULL RETURNING 1
), t AS (
  UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL RETURNING 1
)
INSERT INTO "AuditLog" (id, action, "entityType", after, "createdAt")
SELECT 'ops_' || md5(random()::text), 'security.revoke_all_sessions', 'AdminSession',
       jsonb_build_object('sessions', (SELECT count(*) FROM s), 'refreshTokens', (SELECT count(*) FROM t), 'reason', '${REASON//\'/}'), now();
SELECT action, after FROM "AuditLog" WHERE action = 'security.revoke_all_sessions' ORDER BY "createdAt" DESC LIMIT 1;
COMMIT;
SQL
echo "✓ All staff sessions ended. Next: rotate secrets if needed (docs/security/KEY-ROTATION.md)."
