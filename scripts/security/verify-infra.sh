#!/usr/bin/env bash
# Checks the LIVE site and servers from the outside — what an attacker would see.
# Run from your laptop or CI (not from the servers themselves):
#
#   PUBLIC_DOMAIN=brookrege.com ADMIN_DOMAIN=admin.brookrege.com \
#   ORIGIN_IP=203.0.113.10  SERVER_IPS="203.0.113.10 203.0.113.11 203.0.113.12" \
#     bash scripts/security/verify-infra.sh [--expect-tls13-only] [--expect-cloudflare-only] [--rate-limits] [--server deploy@203.0.113.10 …]
#
#   ORIGIN_IP            public IP of the web server (VPS1 / the single server) — for the "can't go around Cloudflare" checks
#   SERVER_IPS           every server's public IP — port scan + SSH checks
#   --expect-tls13-only  the origin should refuse TLS 1.2 (TLS_PROTOCOLS=TLSv1.3)
#   --expect-cloudflare-only  the origin must not answer anyone but Cloudflare (30-firewall.sh --cloudflare-only)
#   --rate-limits        also fire bursts of requests to confirm 429s (sends ~60 requests; your IP may be slowed briefly)
#   --server USER@HOST   also run read-only checks ON that server over SSH (sshd, ufw, fail2ban, Docker firewall)
#
# Exit code 0 = no failures. WARN lines are worth reading but don't fail the run.
set -uo pipefail

: "${PUBLIC_DOMAIN:?set PUBLIC_DOMAIN}" "${ADMIN_DOMAIN:?set ADMIN_DOMAIN}"
ORIGIN_IP="${ORIGIN_IP:-}"; SERVER_IPS="${SERVER_IPS:-}"
TLS13_ONLY=0; CF_ONLY=0; RATE=0; SERVERS=()
while [ $# -gt 0 ]; do case "$1" in
  --expect-tls13-only) TLS13_ONLY=1; shift ;;
  --expect-cloudflare-only) CF_ONLY=1; shift ;;
  --rate-limits) RATE=1; shift ;;
  --server) SERVERS+=("$2"); shift 2 ;;
  *) echo "Unknown option $1"; exit 2 ;;
esac; done

PASS=0; FAIL=0; WARN=0
pass() { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
warn() { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m %s\n' "$*"; }
section() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
C=(curl -sS -o /dev/null --max-time 15)
status() { local s; s=$("${C[@]}" -w '%{http_code}' "$@" 2>/dev/null) || true; echo "${s:-000}"; }
headers() { curl -sS -D - -o /dev/null --max-time 15 "$@" 2>/dev/null | tr -d '\r'; }

# tls_ok HOST VERSION_FLAG [CONNECT_TO] → 0 if the handshake succeeds
tls_ok() {
  local host="$1" flag="$2" connect="${3:-$1}"
  echo | timeout 10 openssl s_client -connect "$connect:443" -servername "$host" "$flag" -cipher 'DEFAULT:@SECLEVEL=0' 2>/dev/null \
    | grep -qE '^\s*(Protocol|New, TLS).*TLS'
}
client_supports() { openssl s_client -help 2>&1 | grep -q -- "$1"; }

# ───────────────────────── TLS ─────────────────────────
section "TLS (public and admin)"
for host in "$PUBLIC_DOMAIN" "$ADMIN_DOMAIN"; do
  for v in -tls1 -tls1_1; do
    if ! client_supports "$v"; then warn "$host: this openssl can't even try ${v#-} (fine — it's obsolete)"; continue; fi
    if tls_ok "$host" "$v"; then fail "$host accepts ${v#-} (must be refused)"; else pass "$host refuses ${v#-}"; fi
  done
  if tls_ok "$host" -tls1_3; then pass "$host speaks TLS 1.3"; else fail "$host does not speak TLS 1.3"; fi
  if tls_ok "$host" -tls1_2; then pass "$host accepts TLS 1.2 (browsers from ~2014 on; the edge setting is 'minimum TLS 1.2')"; else warn "$host refuses TLS 1.2 — some older phones can't connect"; fi
  exp=$(echo | timeout 10 openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$exp" ]; then
    days=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
    if [ "$days" -lt 7 ]; then fail "$host certificate expires in $days days"; elif [ "$days" -lt 20 ]; then warn "$host certificate expires in $days days (renewal should have happened)"; else pass "$host certificate valid for $days more days"; fi
  else fail "$host: could not read the certificate"; fi
done
if [ -n "$ORIGIN_IP" ] && [ "$CF_ONLY" = 0 ]; then
  if [ "$TLS13_ONLY" = 1 ]; then
    if tls_ok "$PUBLIC_DOMAIN" -tls1_2 "$ORIGIN_IP"; then fail "origin $ORIGIN_IP accepts TLS 1.2 but TLS_PROTOCOLS=TLSv1.3 was expected"; else pass "origin refuses TLS 1.2"; fi
  fi
  if tls_ok "unknown.invalid" -tls1_3 "$ORIGIN_IP"; then fail "origin completes TLS for an unknown hostname (catch-all server missing)"; else pass "origin refuses TLS for unknown hostnames"; fi
fi

# ───────────────────────── HTTP → HTTPS, headers ─────────────────────────
section "Redirects and security headers"
for host in "$PUBLIC_DOMAIN" "www.$PUBLIC_DOMAIN" "$ADMIN_DOMAIN"; do
  loc=$(headers "http://$host/some/path?x=1" | awk 'tolower($1)=="location:"{print $2; exit}')
  case "$loc" in https://*) pass "http://$host → $loc" ;; *) fail "http://$host does not redirect to https (Location: ${loc:-none})" ;; esac
done
loc=$(headers "https://www.$PUBLIC_DOMAIN/x" | awk 'tolower($1)=="location:"{print $2; exit}')
[ "$loc" = "https://$PUBLIC_DOMAIN/x" ] && pass "www → apex" || warn "https://www.$PUBLIC_DOMAIN/x → ${loc:-no redirect}"

check_headers() { # URL
  local h; h=$(headers "$1" | tr 'A-Z' 'a-z')
  local hsts; hsts=$(echo "$h" | awk -F': ' '$1=="strict-transport-security"{print $2; exit}')
  local age; age=$(echo "$hsts" | sed -n 's/.*max-age=\([0-9]*\).*/\1/p')
  if [ -n "$age" ] && [ "$age" -ge 31536000 ]; then pass "$1 HSTS max-age=$age"; else fail "$1 HSTS missing or shorter than a year (${hsts:-none})"; fi
  echo "$h" | grep -q '^content-security-policy: .*frame-ancestors' && pass "$1 CSP with frame-ancestors" || fail "$1 no Content-Security-Policy (or no frame-ancestors)"
  echo "$h" | grep -q '^x-content-type-options: nosniff' && pass "$1 X-Content-Type-Options" || fail "$1 X-Content-Type-Options missing"
  echo "$h" | grep -q '^referrer-policy:' && pass "$1 Referrer-Policy" || fail "$1 Referrer-Policy missing"
  local server; server=$(echo "$h" | awk -F': ' '$1=="server"{print $2; exit}')
  if echo "$server" | grep -qE '[0-9]+\.[0-9]+'; then fail "$1 Server header reveals a version ($server)"; else pass "$1 Server header: ${server:-none} (no version)"; fi
  echo "$h" | grep -q '^x-powered-by:' && fail "$1 X-Powered-By is exposed" || pass "$1 no X-Powered-By"
}
check_headers "https://$PUBLIC_DOMAIN/"
check_headers "https://$PUBLIC_DOMAIN/api/health"
check_headers "https://$ADMIN_DOMAIN/login"
headers "https://$ADMIN_DOMAIN/login" | grep -qi '^x-robots-tag: noindex' && pass "admin is noindex" || warn "admin has no X-Robots-Tag noindex"

# ───────────────────────── Exposure ─────────────────────────
section "Things that must not be reachable"
for p in /.env /.git/config /wp-login.php /phpmyadmin/ /server-status /.DS_Store /backup.sql /docker-compose.yml; do
  s=$(status "https://$PUBLIC_DOMAIN$p")
  case "$s" in 200) fail "$p answered 200" ;; 000) warn "$p: no answer" ;; *) pass "$p → $s" ;; esac
done
s=$(status "https://$PUBLIC_DOMAIN/api/admin/auth/me"); [ "$s" = 404 ] && pass "admin API hidden on the public domain (404)" || fail "admin API on the public domain answered $s (expected 404)"
s=$(status -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" --data '{"email":"x@example.com","password":"x"}' "https://$ADMIN_DOMAIN/api/admin/auth/login")
[ "$s" = 403 ] && pass "admin API refuses a foreign Origin (403)" || fail "admin API with Origin evil.example answered $s (expected 403)"
acao=$(headers -H "Origin: https://evil.example" "https://$PUBLIC_DOMAIN/api/properties" | awk 'tolower($1)=="access-control-allow-credentials:"{print $2}')
[ -z "$acao" ] && pass "public API never allows credentials cross-site" || fail "public API sends Access-Control-Allow-Credentials to evil.example"
s=$(head -c 2100000 /dev/zero | tr '\0' 'a' | status --max-time 30 -X POST -H "Content-Type: application/json" --data-binary @- "https://$PUBLIC_DOMAIN/api/submissions")
[ "$s" = 413 ] && pass "2 MB body refused on the public site (413)" || fail "2 MB body to /api/submissions answered $s (expected 413)"

# ───────────────────────── Origin lockdown ─────────────────────────
if [ -n "$ORIGIN_IP" ]; then
  section "Going around Cloudflare (direct to $ORIGIN_IP)"
  s=$(status --max-time 8 --resolve "$PUBLIC_DOMAIN:443:$ORIGIN_IP" "https://$PUBLIC_DOMAIN/")
  if [ "$CF_ONLY" = 1 ]; then
    [ "$s" = 000 ] && pass "origin does not answer direct visitors" || fail "origin answered $s directly — the Cloudflare-only firewall/origin pulls are not active"
  else
    [ "$s" = 000 ] && warn "origin did not answer directly (expected only with --expect-cloudflare-only)" || warn "origin answers direct visitors ($s) — fine before Cloudflare-only is switched on"
  fi
  s=$(status --max-time 8 "http://$ORIGIN_IP/")
  [ "$s" = 000 ] && pass "bare IP over HTTP gets no response (catch-all 444 or firewall)" || fail "http://$ORIGIN_IP/ answered $s"
fi

# ───────────────────────── Ports & SSH ─────────────────────────
if [ -n "$SERVER_IPS" ]; then
  section "Open ports (TCP connect scan)"
  PORTS="21 23 25 80 443 2049 3000 3001 3306 4000 5432 5433 6379 6432 8080 8081 9000 9090 9100 27017"
  for ip in $SERVER_IPS; do
    open=""
    for p in 22 $PORTS; do timeout 3 bash -c "exec 3<>/dev/tcp/$ip/$p" 2>/dev/null && open="$open $p"; done
    unexpected=""
    for p in $open; do
      case "$p" in
        22) ;;
        80|443) if [ "$ip" = "$ORIGIN_IP" ] && [ "$CF_ONLY" = 0 ]; then :; else unexpected="$unexpected $p"; fi ;;
        *) unexpected="$unexpected $p" ;;
      esac
    done
    if [ -z "$unexpected" ]; then pass "$ip open:${open:- none}"; else fail "$ip has unexpected open ports:$unexpected (all open:$open)"; fi
  done

  section "SSH refuses passwords"
  if command -v ssh >/dev/null; then
    for ip in $SERVER_IPS; do
      out=$(ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive "nobody@$ip" true 2>&1)
      if echo "$out" | grep -q 'Permission denied (publickey)'; then pass "$ip: keys only"
      elif echo "$out" | grep -qiE 'password|keyboard-interactive'; then fail "$ip offers password login: $(echo "$out" | tail -1)"
      else warn "$ip: could not tell ($(echo "$out" | tail -1))"; fi
    done
  else warn "no ssh client here — skipped"; fi
fi

# ───────────────────────── Rate limits ─────────────────────────
if [ "$RATE" = 1 ]; then
  section "Rate limits (bursts)"
  burst() { # NAME COUNT curl-args…
    local name="$1" n="$2"; shift 2; local got="" i first=""
    for i in $(seq "$n"); do
      s=$(status "$@"); got="$got $s"
      if [ "$s" = 429 ]; then first=$i; break; fi
    done
    if [ -n "$first" ]; then pass "$name: 429 on request $first"; else fail "$name: no 429 in $n requests (got:$got)"; fi
  }
  burst "admin sign-in" 20 -X POST -H "Origin: https://$ADMIN_DOMAIN" -H "Content-Type: application/json" --data "{\"email\":\"ratelimit-$RANDOM@example.invalid\",\"password\":\"x\"}" "https://$ADMIN_DOMAIN/api/admin/auth/login"
  burst "lead form" 15 -X POST -H "Content-Type: application/json" --data '{}' "https://$PUBLIC_DOMAIN/api/inquiries"
fi

# ───────────────────────── On-server checks ─────────────────────────
for target in "${SERVERS[@]}"; do
  section "On $target (read-only)"
  while IFS='|' read -r kind msg; do case "$kind" in PASS) pass "$msg" ;; FAIL) fail "$msg" ;; *) warn "$msg" ;; esac; done < <(ssh -o BatchMode=yes -o ConnectTimeout=10 "$target" 'sudo bash -s' <<'REMOTE' 2>&1 || echo "FAIL|could not run checks over SSH on $target"
chk() { if eval "$2" >/dev/null 2>&1; then echo "PASS|$1"; else echo "FAIL|$1"; fi; }
T=$(sshd -T 2>/dev/null)
chk "sshd: password login off"      'echo "$T" | grep -qx "passwordauthentication no"'
chk "sshd: root login off"          'echo "$T" | grep -qx "permitrootlogin no"'
chk "sshd: keyboard-interactive off" 'echo "$T" | grep -qx "kbdinteractiveauthentication no"'
chk "sshd: only deploy may log in"  'echo "$T" | grep -qx "allowusers deploy"'
chk "ufw active, deny incoming"     'ufw status verbose | grep -q "Status: active" && ufw status verbose | grep -q "deny (incoming)"'
chk "fail2ban sshd jail running"    'fail2ban-client status sshd'
chk "Docker firewall applied"       'iptables -S DOCKER-USER | grep -q -- "-j BROOKREGE" && iptables -S BROOKREGE | grep -q DROP'
chk "firewall re-applied at boot"   'systemctl is-enabled brookrege-firewall.service'
chk "automatic security updates"    'systemctl is-enabled unattended-upgrades'
chk "kernel: SYN cookies"           '[ "$(sysctl -n net.ipv4.tcp_syncookies)" = 1 ]'
if [ -f /etc/brookrege/firewall.env ] && grep -q CLOUDFLARE_ONLY=1 /etc/brookrege/firewall.env; then
  chk "Cloudflare ranges refreshed weekly" 'systemctl is-enabled brookrege-cf-sync.timer'
fi
n=$(ls /etc/letsencrypt/live 2>/dev/null | wc -l); [ "$n" -gt 0 ] && echo "PASS|certificates present ($n)" || echo "WARN|no /etc/letsencrypt/live on this server (fine for app servers)"
REMOTE
)
done

printf '\n\033[1m%d passed, %d failed, %d warnings\033[0m\n' "$PASS" "$FAIL" "$WARN"
[ "$FAIL" = 0 ]
