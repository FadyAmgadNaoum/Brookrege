#!/usr/bin/env bash
# Switches THIS server back to the release that ran before the current one (or to --tag <release>).
# No backup and no migrations: the database stays as it is (migrations are written so the previous release
# still works with them — docs/DEVELOPER-GUIDE.md › Migrations). Health-checked like a deploy.
#
#   sudo scripts/deploy/rollback.sh --target single|staging|vps1|vps2|vps3 [--tag <release>]
# Three servers: scripts/deploy/deploy-cluster.sh --rollback on VPS1 rolls back all of them.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${BROOKREGE_STATE_DIR:-/var/lib/brookrege/deploy}"
TARGET=""; TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "✗ unknown option: $1"; exit 64 ;;
  esac
done
[ -n "$TARGET" ] || { echo "✗ --target is required"; exit 64; }
if [ -z "$TAG" ]; then
  TAG="$(cat "$STATE_DIR/previous-$TARGET" 2>/dev/null || true)"
  [ -n "$TAG" ] || { echo "✗ no previous release recorded for $TARGET — pass --tag (see $STATE_DIR/history.log)"; exit 1; }
fi
echo "Rolling $TARGET back to $TAG (currently $(cat "$STATE_DIR/current-$TARGET" 2>/dev/null || echo unknown))"
exec "$HERE/deploy.sh" --target "$TARGET" --tag "$TAG" --skip-backup --no-migrate --no-rollback --mode rollback
