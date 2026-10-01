#!/bin/sh
# Encrypted PostgreSQL backup.
#   pg_dump (custom format) → age (public-key encryption) → /backups/brookrege-YYYY-MM-DDTHHMM.dump.age
# The server holds only the PUBLIC key (BACKUP_AGE_RECIPIENT). The private key lives offline with the
# owner, so a stolen server or a leaked backup file can't be decrypted.
# Optional off-site copy: set BACKUP_REMOTE (an rclone remote such as "r2:brookrege-backups").
set -eu

: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}" "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age public key, age1…) is required}"
DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"   # every backup of the last N days
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}" # plus the first backup of each of the last N months
STAMP="$(date -u +%Y-%m-%dT%H%M)"
OUT="$DIR/brookrege-$STAMP.dump.age"
TMP="$OUT.partial"

mkdir -p "$DIR"
umask 077
start=$(date +%s)

# Monitoring (Phase 4): results go to node_exporter's textfile directory if it is mounted, so Prometheus
# alerts when backups stop or fail (BackupTooOld / BackupFailed in infra/monitoring/prometheus/rules).
METRICS_DIR="${BACKUP_METRICS_DIR:-/metrics}"
OFFSITE_OK=""
write_metric() { # write_metric NAME VALUE [HELP] — one file per metric keeps partial updates harmless
  [ -d "$METRICS_DIR" ] || return 0
  f="$METRICS_DIR/brookrege_backup_$1.prom"
  { echo "# HELP brookrege_backup_$1 ${3:-Backup metric.}"; echo "# TYPE brookrege_backup_$1 gauge"; echo "brookrege_backup_$1 $2"; } > "$f.tmp" && chmod 644 "$f.tmp" && mv "$f.tmp" "$f"
}
on_exit() {
  rc=$?
  now=$(date +%s)
  if [ "$rc" -eq 0 ]; then
    write_metric last_success_timestamp_seconds "$now" "Unix time of the last successful encrypted backup."
    write_metric last_size_bytes "${size:-0}" "Size of the last backup file."
    write_metric last_duration_seconds "$(( now - start ))" "Time the last backup took."
    [ -n "$OFFSITE_OK" ] && write_metric offsite_last_success_timestamp_seconds "$now" "Unix time of the last successful off-site copy."
  else
    write_metric last_failure_timestamp_seconds "$now" "Unix time of the last failed backup attempt."
  fi
}
trap on_exit EXIT

# 1. Dump and encrypt in one stream (no unencrypted copy ever touches the disk).
#    pipefail isn't in POSIX sh, so pg_dump's exit status is captured through a file.
( pg_dump -Fc --no-owner --no-privileges "$PGDATABASE" || echo $? > "$TMP.rc" ) | age -r "$BACKUP_AGE_RECIPIENT" -o "$TMP"
if [ -s "$TMP.rc" ]; then echo "[backup] pg_dump failed (exit $(cat "$TMP.rc"))" >&2; rm -f "$TMP" "$TMP.rc"; exit 1; fi
rm -f "$TMP.rc"

# 2. Sanity: a real dump is never tiny. (Integrity is checked by the restore drill, which has the private key.)
size=$(wc -c < "$TMP")
if [ "$size" -lt 1024 ]; then echo "[backup] output suspiciously small ($size bytes) — keeping previous backups untouched" >&2; rm -f "$TMP"; exit 1; fi
mv "$TMP" "$OUT"
echo "[backup] wrote $OUT ($size bytes) in $(( $(date +%s) - start ))s"

# 3. Optional off-site copy (encrypted files only).
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if rclone copy --no-traverse "$OUT" "$BACKUP_REMOTE/"; then OFFSITE_OK=1; echo "[backup] copied off-site to $BACKUP_REMOTE"
  else echo "[backup] off-site copy FAILED (local backup is fine)" >&2; fi
fi

# 4. Retention: keep the last KEEP_DAILY days, and the first backup of each of the last KEEP_MONTHLY months.
# BusyBox (Alpine) date understands "-d @EPOCH" but not "-1 month", so months are computed arithmetically.
cutoff=$(date -u -d "@$(( $(date +%s) - KEEP_DAILY * 86400 ))" +%Y-%m-%d)
y=$(date -u +%Y); m=$(date -u +%m); m=${m#0}
keep_months=""
i=0
while [ $i -lt "$KEEP_MONTHLY" ]; do
  first=$(ls "$DIR"/brookrege-"$(printf '%04d-%02d' "$y" "$m")"-*.dump.age 2>/dev/null | sort | head -n1 || true)
  [ -n "$first" ] && keep_months="$keep_months $first"
  m=$((m - 1)); if [ "$m" -eq 0 ]; then m=12; y=$((y - 1)); fi
  i=$((i + 1))
done
for f in "$DIR"/brookrege-*.dump.age; do
  [ -e "$f" ] || continue
  day=$(basename "$f" | sed -E 's/^brookrege-([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/')
  case " $keep_months " in *" $f "*) continue ;; esac
  # Compare YYYYMMDD as numbers: POSIX `[` has no string "<" (BusyBox and dash differ).
  case "$day" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) continue ;; esac
  if [ "$(echo "$day" | tr -d -)" -lt "$(echo "$cutoff" | tr -d -)" ]; then rm -f "$f"; echo "[backup] removed old $f"; fi
done
