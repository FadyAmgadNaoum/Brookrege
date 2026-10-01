#!/usr/bin/env bash
# Dry-run of scripts/install/install.sh: the settings file it writes must be complete, private and valid.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cp -r "$REPO/docker-compose.prod.yml" "$REPO/.env.production.example" "$REPO/scripts" "$REPO/infra" "$W/"
fails=0; check() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; fails=$((fails+1)); fi; }
( cd "$W" && DRY_RUN=1 DOMAIN="https://www.Example.org/" EMAIL=owner@example.org WHATSAPP="+20 100 123 4567" \
  BACKUP_PUBLIC_KEY=age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq bash scripts/install/install.sh </dev/null >"$W/out.log" 2>&1 )
export E="$W/.env.production"   # used inside the check strings
check "installer dry run succeeds" '[ -f "$E" ]'
check "settings file readable by its owner only" '[ "$(stat -c %a "$E")" = 600 ]'
check "domain cleaned (no scheme, no www, lower case)" 'grep -qx "PUBLIC_DOMAIN=example.org" "$E" && grep -qx "ADMIN_DOMAIN=admin.example.org" "$E"'
check "WhatsApp number digits only" 'grep -qx "WHATSAPP_NUMBER=201001234567" "$E"'
check "no example values left" '! grep -Eq "=(generate-|Choose-|age1replace)" "$E"'
for k in DB_PASSWORD:48 JWT_ACCESS_SECRET:96 SETTINGS_ENCRYPTION_KEY:64 REDIS_PASSWORD:48; do
  n=${k%%:*}; l=${k##*:}
  check "$n is $l random characters" '[ "$(grep "^$n=" "$E" | cut -d= -f2 | tr -d "\n" | wc -c)" = '"$l"' ]'
done
check "first admin password meets the basic policy" 'p=$(grep "^BOOTSTRAP_PASSWORD=" "$E" | cut -d= -f2); [ ${#p} -ge 12 ] && [[ $p =~ [a-z] && $p =~ [A-Z] && $p =~ [0-9] && $p =~ [^A-Za-z0-9] ]]'
check "photos stored on the server, images built locally" 'grep -qx "STORAGE_DRIVER=local" "$E" && grep -qx "IMAGE_TAG=local" "$E"'
check "a second run keeps the existing settings" '( cd "$W" && DRY_RUN=1 DOMAIN=other.org EMAIL=a@other.org WHATSAPP=201001234567 bash scripts/install/install.sh </dev/null >/dev/null 2>&1 ); grep -qx "PUBLIC_DOMAIN=example.org" "$E"'
check "rejects a bad domain" '! ( cd "$(mktemp -d)" && cp -r "$W/scripts" "$W/docker-compose.prod.yml" "$W/.env.production.example" . && DRY_RUN=1 DOMAIN="not a domain" EMAIL=a@b.org WHATSAPP=201001234567 bash scripts/install/install.sh </dev/null >/dev/null 2>&1 )'
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  check "compose file valid with the generated settings" 'docker compose -f "$W/docker-compose.prod.yml" --env-file "$E" config -q'
fi
[ "$fails" = 0 ] && echo "✓ installer: all checks pass" || { echo "✗ installer: $fails check(s) failed"; cat "$W/out.log"; exit 1; }
