#!/usr/bin/env bash
# Brookrege - start the whole site on this computer (Mac / Linux). Windows: double-click start-brookrege.bat.
#   ./start-brookrege.sh
# Checks Docker, frees Brookrege's ports from other projects (asks first), builds and starts everything,
# waits until the real Brookrege site answers, then opens it.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
DOCKER="${BROOKREGE_DOCKER:-docker}"
LOG="brookrege-start-log.txt"
fail() { printf '\n\033[31mX  %s\033[0m\n\n' "$1"; exit 1; }
ok() { printf '\033[32mOK  %s\033[0m\n' "$1"; }
setting() { # value from the environment, else from .env, else the default
  local v="${!1:-}"
  [ -z "$v" ] && [ -f .env ] && v="$(grep -E "^\s*$1\s*=" .env | tail -1 | cut -d= -f2- | tr -d ' "'"'"'\r')"
  echo "${v:-$2}"
}

echo; echo "Brookrege - starting the website on this computer"; echo "--------------------------------------------------"
command -v "$DOCKER" >/dev/null || fail "Docker is not installed. Install Docker Desktop (Mac) or Docker Engine (Linux), then run this again."
if ! "$DOCKER" info >/dev/null 2>&1; then
  [ "$(uname)" = Darwin ] && open -a Docker 2>/dev/null && echo "Starting Docker Desktop..."
  echo "Waiting for Docker to be ready (up to 3 minutes)..."
  for _ in $(seq 90); do sleep 2; "$DOCKER" info >/dev/null 2>&1 && break; done
  "$DOCKER" info >/dev/null 2>&1 || fail "Docker is not running. Open Docker Desktop, wait until it is running, then run this again."
fi
ok "Docker is running"

WEB=$(setting WEB_PORT 3000); ADMIN=$(setting ADMIN_PORT 3001); API=$(setting API_PORT 4000); DB=$(setting DB_PORT 5434)
for pair in "website:$WEB" "admin:$ADMIN" "API:$API" "database:$DB"; do
  what="${pair%%:*}"; port="${pair##*:}"
  names=$("$DOCKER" ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null | grep -Ev '^brookrege[-_]' | paste -sd, - | sed 's/,/, /g')
  if [ -n "$names" ]; then
    echo; echo "!  Port $port (Brookrege $what) is being used by another project's container: $names"
    echo "   That is why http://localhost:$port showed a different site."
    if [ "${BROOKREGE_YES:-}" = 1 ]; then a=y; else read -r -p "   Stop it so Brookrege can use the port? Nothing is deleted - start it again from Docker Desktop. [Y/n] " a; fi
    [[ "$a" =~ ^([nN]|[nN][oO])$ ]] && fail "Brookrege needs port $port. Stop '$names' in Docker Desktop, or set another port in a file named .env (see README)."
    for n in ${names//,/ }; do "$DOCKER" stop "$n" >/dev/null && ok "Stopped $n"; done
    sleep 2
  fi
  if command -v lsof >/dev/null; then
    prog=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1" (process "$2")"}' | grep -Eiv '^(com\.docke|docker|vpnkit|rootlessk)' | head -1)
    [ -n "$prog" ] && fail "Port $port (Brookrege $what) is used by the program $prog. Close it, then run this again."
  fi
done
ok "Ports are free for Brookrege: website $WEB, admin $ADMIN, API $API"

echo; echo "Building and starting (the first time takes 5-15 minutes; later starts take seconds)..."
if ! "$DOCKER" compose up -d --build; then
  { "$DOCKER" compose ps -a; "$DOCKER" compose logs --tail 80; } >"$LOG" 2>&1
  fail "Brookrege could not start. The details are saved in $LOG - send that file for help."
fi

echo "Waiting for the site to answer..."
ready=0; other=0; end=$(( $(date +%s) + ${BROOKREGE_WAIT_SECONDS:-600} ))
while [ "$(date +%s)" -lt "$end" ]; do
  if body=$(curl -fsSL --max-time 5 "http://localhost:$WEB/ar" 2>/dev/null); then
    grep -q Brookrege <<<"$body" && { ready=1; break; }
    other=1
  fi
  sleep 3
done
if [ "$ready" != 1 ]; then
  { "$DOCKER" compose ps -a; "$DOCKER" compose logs --tail 80; } >"$LOG" 2>&1
  [ "$other" = 1 ] && fail "http://localhost:$WEB answers with a different site - another program is using port $WEB. Close it and run again."
  fail "The site did not answer in time. The details are saved in $LOG - send that file for help."
fi

echo; ok "Brookrege is running"
echo "  Website          http://localhost:$WEB            (Arabic; English in the header)"
echo "  Admin dashboard  http://localhost:$ADMIN          admin@brookrege.com / Brookrege-Demo-2026!"
echo "  API health       http://localhost:$API/health"
echo; echo "Stop it with: docker compose down   (your data is kept)"
if [ "${BROOKREGE_NO_BROWSER:-}" != 1 ]; then
  if command -v open >/dev/null; then open "http://localhost:$WEB"; elif command -v xdg-open >/dev/null; then xdg-open "http://localhost:$WEB" >/dev/null 2>&1 & fi
fi
