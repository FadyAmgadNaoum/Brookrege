#!/usr/bin/env bash
# Locked out? Gives one staff account a new temporary password — for when the only super admin forgot theirs or
# is locked. Run on the server, in the project folder:
#
#   bash scripts/ops/reset-admin-access.sh owner@brookrege.com
#
# The account is unlocked and re-activated, all its browsers are signed out, and it must choose its own password at
# the next sign-in. Recorded in the activity log.
# Anyone who can run this already controls the server, so it adds no new way in.
set -euo pipefail
cd "$(dirname "$0")/../.."
EMAIL="${1:-}"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] || { echo "usage: $0 email@domain"; exit 64; }
EMAIL="${EMAIL,,}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
if [ -z "${PSQL:-}" ]; then
  PSQL="$COMPOSE exec -T postgres sh -c 'psql -X -q -t -A -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\"'"
fi
# Temporary password: meets the admin password policy (mixed case, digit, symbol, no sequences).
while :; do
  p="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 14)"; p="${p:0:7}-${p:7:7}!"
  [[ "$p" =~ [a-z] && "$p" =~ [A-Z] && "$p" =~ [0-9] ]] || continue
  grep -Eiq '(.)\1\1\1|0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|pass|admin|brook|sohag' <<<"$p" && continue
  break
done
# Only letters, digits, - and ! in the password and a checked email go into the SQL.
out=$(eval "$PSQL" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
BEGIN;
WITH u AS (
  UPDATE "User" SET "passwordHash" = crypt('$p', gen_salt('bf', 12)), "mustChangePassword" = true, "failedLoginCount" = 0,
         "lockedUntil" = NULL, status = 'ACTIVE', "updatedAt" = now()
  WHERE lower(email) = '${EMAIL//\'/}' RETURNING id
), s AS (
  UPDATE "AdminSession" SET "revokedAt" = now(), "revokedReason" = 'admin' WHERE "userId" IN (SELECT id FROM u) AND "revokedAt" IS NULL RETURNING 1
), r AS (
  UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "userId" IN (SELECT id FROM u) AND "revokedAt" IS NULL RETURNING 1
)
INSERT INTO "AuditLog" (id, action, "entityType", "entityId", after, "createdAt")
SELECT 'ops_' || md5(random()::text), 'security.reset_access_from_server', 'User', id,
       jsonb_build_object('sessionsEnded', (SELECT count(*) FROM s)), now()
FROM u RETURNING "entityId";
COMMIT;
SQL
)
[ -n "$(echo "$out" | tr -d '[:space:]')" ] || { echo "✗ No staff account with the email $EMAIL."; exit 1; }
cat <<DONE
✓ Access reset for $EMAIL
  Temporary password: $p
  Sign in at the admin address; you'll be asked to choose your own password.
DONE
