#!/usr/bin/env bash
# Backup restore drill: proves a backup can actually be restored (run monthly, and before launch).
#   AGE_IDENTITY=~/brookrege-backup-key.txt  bash scripts/ops/restore-drill.sh backups/brookrege-2026-…dump.age
# Restores into a throw-away database on the given PostgreSQL (default: local), checks it, prints a
# report, and drops it. Never touches the live database. Needs: psql, pg_restore, age.
set -euo pipefail
FILE="${1:?usage: restore-drill.sh <backup.dump.age>}"
: "${AGE_IDENTITY:?set AGE_IDENTITY to the private key file (kept offline by the owner)}"
SCRATCH="brookrege_restore_drill_$(date +%s)"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-brookrege}"
start=$(date +%s)
cleanup() { dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true; rm -f "$DUMP"; }
DUMP="$(mktemp)"; trap cleanup EXIT

echo "▸ Decrypting $(basename "$FILE")"
age -d -i "$AGE_IDENTITY" -o "$DUMP" "$FILE"
pg_restore --list "$DUMP" > /dev/null && echo "  ✓ archive is readable ($(wc -c < "$DUMP") bytes)"

echo "▸ Restoring into scratch database $SCRATCH"
createdb "$SCRATCH"
pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH" "$DUMP"
echo "  ✓ restored"

echo "▸ Checking contents"
q() { psql -X -q -At -d "$SCRATCH" -c "$1"; }
tables=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "  tables: $tables"
for t in User Property Inquiry PropertySubmission AuditLog MediaAsset; do
  printf '  %-20s %s rows\n' "$t" "$(q "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo 'MISSING')"
done
if [ "$(q "SELECT to_regclass('_prisma_migrations') IS NOT NULL")" = t ]; then
  echo "  latest migration: $(q 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1')"
fi
trigger=$(q "SELECT count(*) FROM pg_trigger WHERE tgname='audit_log_append_only'")
[ "$trigger" = 1 ] && echo "  ✓ activity-log protection trigger present" || echo "  ✗ activity-log protection trigger MISSING"
users=$(q 'SELECT count(*) FROM "User"')
[ "$tables" -ge 17 ] && [ "$users" -ge 1 ] || { echo "✗ Restore looks incomplete"; exit 1; }
echo "✓ Restore drill passed in $(( $(date +%s) - start ))s. Record the date and time taken in docs/security/BACKUPS.md."
