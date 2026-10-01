#!/usr/bin/env bash
# Tests for the local start scripts (start-brookrege.sh and, when PowerShell is installed, scripts/local/start.ps1)
# with a stand-in docker: another project's container on port 3000, a failing build, a different site on the port.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"; trap 'kill $(cat "$T"/srv.pid 2>/dev/null) 2>/dev/null; rm -rf "$T"' EXIT
pass=0; failn=0
check() { if grep -q -- "$2" "$T/out"; then pass=$((pass+1)); else failn=$((failn+1)); echo "FAIL [$1]: expected '$2'"; sed 's/^/    /' "$T/out" | tail -15; fi; }
WEB=3917
cat > "$T/docker" <<STUB
#!/usr/bin/env bash
echo "docker \$*" >> "$T/calls"
case "\$1" in
  info) exit 0 ;;
  ps) [ "\$3" = "publish=$WEB" ] && [ ! -f "$T/stopped" ] && [ -f "$T/rawasi" ] && echo rawasi-frontend; [ "\$3" = "publish=$WEB" ] && echo brookrege-web-1; exit 0 ;;
  stop) touch "$T/stopped"; echo "\$2" ;;
  compose)
    case "\$2" in
      up) [ -f "$T/buildfail" ] && { echo "build failed" >&2; exit 1; }
          mkdir -p "$T/site/ar"; if [ -f "$T/othersite" ]; then echo "<title>Rawasi</title>" > "$T/site/ar/index.html"; else echo "<title>Brookrege</title>" > "$T/site/ar/index.html"; fi
          (cd "$T/site" && exec python3 -m http.server $WEB >/dev/null 2>&1) & echo \$! > "$T/srv.pid"; sleep 1 ;;
      *) echo "compose \$2 output" ;;
    esac ;;
esac
STUB
chmod +x "$T/docker"
reset() { kill "$(cat "$T/srv.pid" 2>/dev/null)" 2>/dev/null; rm -f "$T"/{calls,stopped,rawasi,buildfail,othersite,srv.pid}; rm -f "$ROOT/brookrege-start-log.txt"; sleep 0.3; }
export BROOKREGE_DOCKER="$T/docker" BROOKREGE_NO_BROWSER=1 BROOKREGE_NO_PAUSE=1 BROOKREGE_WAIT_SECONDS=8 WEB_PORT=$WEB ADMIN_PORT=3918 API_PORT=3919 DB_PORT=3920

run_all() { # $1 = label, then command
  local label="$1"; shift
  reset; touch "$T/rawasi"
  BROOKREGE_YES=1 "$@" >"$T/out" 2>&1
  check "$label: other project on the port" "Port $WEB (Brookrege website) is being used by another project's container: rawasi-frontend"
  check "$label: stops it" "Stopped rawasi-frontend"
  check "$label: own container ignored" "Ports are free"
  check "$label: success" "Brookrege is running"
  check "$label: admin sign-in shown" "admin@brookrege.com"
  grep -q "stop brookrege-web-1" "$T/calls" && { failn=$((failn+1)); echo "FAIL [$label]: stopped its own container"; } || pass=$((pass+1))

  reset; touch "$T/rawasi"
  echo n | "$@" >"$T/out" 2>&1
  check "$label: declined" "Brookrege needs port $WEB"
  grep -q "compose up" "$T/calls" && { failn=$((failn+1)); echo "FAIL [$label]: started after decline"; } || pass=$((pass+1))

  reset; touch "$T/buildfail"
  "$@" >"$T/out" 2>&1
  check "$label: build failure" "could not start"
  [ -f "$ROOT/brookrege-start-log.txt" ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "FAIL [$label]: no log file"; }

  reset; touch "$T/othersite"
  "$@" >"$T/out" 2>&1
  check "$label: different site on the port" "different site"
}
run_all bash bash "$ROOT/start-brookrege.sh"

# A non-Docker program on the port (bash version; Windows uses Get-NetTCPConnection).
if command -v lsof >/dev/null; then
  reset; (cd "$T" && exec python3 -m http.server $WEB >/dev/null 2>&1) & echo $! > "$T/srv.pid"; sleep 1
  bash "$ROOT/start-brookrege.sh" >"$T/out" 2>&1
  check "bash: program on the port" "is used by the program python"
fi

PWSH="$(command -v pwsh || ls /opt/pwsh/pwsh 2>/dev/null || true)"
if [ -n "$PWSH" ]; then run_all powershell "$PWSH" -NoProfile -File "$ROOT/scripts/local/start.ps1"; else echo "(PowerShell not installed: skipped the Windows script)"; fi
reset
echo "local start scripts: $pass passed, $failn failed"
[ "$failn" = 0 ]
