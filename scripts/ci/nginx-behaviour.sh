#!/usr/bin/env bash
# Starts the REAL production nginx configuration against stand-in app servers and checks how it behaves:
# micro-cache hits/bypasses, stale pages while the apps are down, security headers, hidden admin API,
# unknown hosts dropped, probes blocked, rate limits, gzip, X-Forwarded-For not spoofable, JSON access log.
#
#   bash scripts/ci/nginx-behaviour.sh              # CI: runs the official nginx image (host network, ports 80/443)
#   NGINX_BIN=/path/to/nginx bash scripts/ci/nginx-behaviour.sh   # a local nginx binary (needs root; writes /etc/nginx)
#   SITE_ACCESS=staging bash scripts/ci/nginx-behaviour.sh          # the staging mode instead: password + noindex
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"
IMAGE="${NGINX_IMAGE:-$(grep -m1 -oE 'nginx:[0-9.]+-alpine' docker-compose.prod.yml)}"
WORK="$(mktemp -d)"
export NO_PROXY='*' no_proxy='*'; unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy
SITE_ACCESS="${SITE_ACCESS:-public}"
fails=0; UP_PID=""; CID=""
cleanup() {
  [ -n "$UP_PID" ] && kill "$UP_PID" 2>/dev/null
  [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1
  [ -n "${NGINX_BIN:-}" ] && "$NGINX_BIN" -p /etc/nginx/ -c /etc/nginx/nginx.conf -s stop 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT
ok() { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; fails=$((fails+1)); }
expect() { # expect DESCRIPTION ACTUAL EXPECTED(regex)
  if [[ "$2" =~ $3 ]]; then ok "$1 ($2)"; else bad "$1: got '$2', expected /$3/"; fi
}

# ── stand-in app servers: api :4000, web :3000, admin :3001 ──
cat > "$WORK/up.py" <<'PY'
import http.server, json, sys, threading, itertools
count = itertools.count(1)
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def reply(self, code, body, ctype, extra=None):
        b = body.encode(); self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        info = {"n": next(count), "xff": self.headers.get("X-Forwarded-For"), "ae": self.headers.get("Accept-Encoding")}
        if self.server.server_port == 4000: self.reply(200, json.dumps(info), "application/json", {"Cache-Control": "public, max-age=300"})
        else: self.reply(200, "<html><body>" + json.dumps(info) + "x" * 2000 + "</body></html>", "text/html; charset=utf-8", {"Cache-Control": "private, no-cache, no-store"})
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.reply(204 if self.path.endswith("/view") else 201, "", "application/json")
for p in (4000, 3000, 3001):
    s = http.server.ThreadingHTTPServer(("0.0.0.0", p), H); threading.Thread(target=s.serve_forever, daemon=True).start()
threading.Event().wait()
PY
python3 "$WORK/up.py" & UP_PID=$!

# ── certificates and Cloudflare files the template expects ──
mkdir -p "$WORK/le/live/example.com" "$WORK/cf" "$WORK/staging"
printf 'tester:%s\n' "$(openssl passwd -apr1 staging-pass)" > "$WORK/staging/htpasswd"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=example.com" -addext "subjectAltName=DNS:example.com,DNS:www.example.com,DNS:admin.example.com" \
  -keyout "$WORK/le/live/example.com/privkey.pem" -out "$WORK/le/live/example.com/fullchain.pem" 2>/dev/null
cp infra/nginx/cloudflare/realip.conf "$WORK/cf/"
chmod -R a+rX "$WORK"

if [ -n "${NGINX_BIN:-}" ]; then
  # Local binary: recreate the image's layout under /etc/nginx (as the official image's nginx.conf does).
  rm -rf /etc/nginx /var/cache/nginx/brookrege; mkdir -p /etc/nginx/conf.d /var/log/nginx /var/cache/nginx /var/www/certbot /data/uploads
  ln -sfn "$REPO/infra/nginx/snippets" /etc/nginx/snippets; ln -sfn "$WORK/cf" /etc/nginx/cloudflare; ln -sfn "$WORK/staging" /etc/nginx/staging
  rm -rf /etc/letsencrypt; ln -sfn "$WORK/le" /etc/letsencrypt
  cp infra/nginx/upstreams/single-server.conf /etc/nginx/upstreams.conf
  printf 'user root;\nworker_processes 2;\nerror_log /var/log/nginx/error.log notice;\npid /var/run/nginx.pid;\nevents { worker_connections 1024; }\nhttp {\n  types { text/html html; application/json json; }\n  default_type application/octet-stream;\n  log_format main %s;\n  access_log /var/log/nginx/access.log main;\n  sendfile on;\n  keepalive_timeout 65;\n  include /etc/nginx/conf.d/*.conf;\n}\n' "'\$remote_addr \$request \$status'" > /etc/nginx/nginx.conf
  SITE_ACCESS="$SITE_ACCESS" python3 - <<'PY'
import re
s = open("infra/nginx/templates/default.conf.template").read()
import os
env = {"PUBLIC_DOMAIN": "example.com", "ADMIN_DOMAIN": "admin.example.com", "TLS_PROTOCOLS": "TLSv1.2 TLSv1.3", "ORIGIN_PULL": "off", "SITE_ACCESS": os.environ["SITE_ACCESS"]}
s = re.sub(r"\$\{([A-Z_]+)\}", lambda m: env[m.group(1)], s)
if "stub_status" not in open("/dev/null").read():  # some static builds lack the stub_status module
    import subprocess, os
    out = subprocess.run([os.environ["NGINX_BIN"], "-V"], capture_output=True, text=True).stderr
    if "http_stub_status_module" not in out:
        a = s.index("server {\n  listen 8088;"); b = s.index("}\n}\n", a) + 4; s = s[:a] + s[b:]
open("/etc/nginx/conf.d/default.conf", "w").write(s)
PY
  grep -q " api web admin" /etc/hosts || echo "127.0.0.1 api web admin" >> /etc/hosts
  "$NGINX_BIN" -p /etc/nginx/ -c /etc/nginx/nginx.conf || { echo "nginx failed to start"; exit 1; }
  LOG() { cat /var/log/nginx/access.log; }
else
  CID=$(docker run -d --network host --add-host api:127.0.0.1 --add-host web:127.0.0.1 --add-host admin:127.0.0.1 \
    -e PUBLIC_DOMAIN=example.com -e ADMIN_DOMAIN=admin.example.com -e TLS_PROTOCOLS="TLSv1.2 TLSv1.3" -e ORIGIN_PULL=off -e SITE_ACCESS="$SITE_ACCESS" \
    -v "$WORK/staging:/etc/nginx/staging:ro" -v "$REPO/infra/nginx/templates:/etc/nginx/templates:ro" -v "$REPO/infra/nginx/snippets:/etc/nginx/snippets:ro" \
    -v "$WORK/cf:/etc/nginx/cloudflare:ro" -v "$REPO/infra/nginx/upstreams/single-server.conf:/etc/nginx/upstreams.conf:ro" \
    -v "$WORK/le:/etc/letsencrypt:ro" "$IMAGE")
  LOG() { docker logs "$CID" 2>/dev/null | grep '^{"time"'; }
fi
sleep 2

C=(curl -s -k --max-time 10 --resolve example.com:443:127.0.0.1 --resolve admin.example.com:443:127.0.0.1)
hdr() { "${C[@]}" -o /dev/null -D - "$@" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}'; }
code() { "${C[@]}" -o /dev/null -w '%{http_code}' "$@"; }

if [ "$SITE_ACCESS" = staging ]; then
  echo "▸ Staging access (password + noindex)"
  expect "site asks for the password" "$(code https://example.com/ar)" '^401$'
  expect "admin asks for the password" "$(code https://admin.example.com/login)" '^401$'
  expect "wrong password refused" "$(code -u tester:wrong https://example.com/ar)" '^401$'
  expect "right password lets you in" "$(code -u tester:staging-pass https://example.com/ar)" '^200$'
  robots=$("${C[@]}" -o /dev/null -D - -u tester:staging-pass https://example.com/ar | tr -d '\r' | awk -F': ' 'tolower($1)=="x-robots-tag"{print $2}')
  expect "pages marked noindex" "$robots" 'noindex'
  expect "uptime check works without the password" "$(code https://example.com/api/health)" '^200$'
  expect "…but the rest of the API doesn't" "$(code https://example.com/api/regions)" '^401$'
  [ "$fails" = 0 ] && echo "✓ staging access behaves as designed" || { echo "✗ $fails staging check(s) failed"; exit 1; }
  exit 0
fi

echo "▸ Micro-cache"
R=$RANDOM   # fresh URLs: nothing cached from an earlier run
hdr "https://example.com/ar?r=$R" >/dev/null
expect "page served from cache on repeat" "$(hdr "https://example.com/ar?r=$R")" '^HIT$'
hdr https://example.com/ar >/dev/null
expect "Next.js navigation (RSC) bypasses the cache" "$(hdr -H 'RSC: 1' https://example.com/ar)" '^BYPASS$'
expect "signed-in cookie bypasses the cache" "$(hdr -H 'Cookie: __Host-bk_at=x' https://example.com/ar)" '^BYPASS$'
hdr https://example.com/api/health >/dev/null
expect "health check never cached" "$(hdr https://example.com/api/health)" '^BYPASS$'
hdr "https://example.com/api/properties?type=VILLA&r=$R" >/dev/null
expect "public API cached on repeat" "$(hdr "https://example.com/api/properties?type=VILLA&r=$R")" '^HIT$'
expect "POST (view beacon) passes through" "$(code -X POST https://example.com/api/properties/x/view)" '^204$'
expect "admin is never cached" "$(hdr https://admin.example.com/login)" '^$'
jh=$("${C[@]}" -o /dev/null -D - https://example.com/journey/v1/desktop.mp4 | tr -d '\r' | tr 'A-Z' 'a-z')
[[ "$jh" == *"cache-control: public, immutable"* && "$jh" != *"x-cache:"* ]] && ok "home film: cached a year, not micro-cached" || bad "home film cache headers wrong"

echo "▸ Security"
h=$("${C[@]}" -o /dev/null -D - https://example.com/ar | tr -d '\r' | tr 'A-Z' 'a-z')
[[ "$h" == *"strict-transport-security: max-age=63072000"* ]] && ok "HSTS on cached pages" || bad "HSTS missing on cached pages"
expect "live site has no noindex header" "$(echo "$h" | grep -c '^x-robots-tag')" '^0$'
expect "admin API hidden on the public domain" "$(code https://example.com/api/admin/auth/me)" '^404$'
expect "scanner probe blocked" "$(code https://example.com/.env)" '^404$'
expect "unknown host gets no response" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.test' http://127.0.0.1/)" '^000$'
curl -s -k --max-time 5 --resolve evil.test:443:127.0.0.1 https://evil.test/ -o /dev/null; expect "TLS refused for unknown names" "$?" '^35$'
xff=$("${C[@]}" -H 'X-Forwarded-For: 6.6.6.6' 'https://example.com/api/projects?q=1' | python3 -c 'import json,sys; print(json.load(sys.stdin)["xff"])')
expect "X-Forwarded-For can't be spoofed" "$xff" '^127\.0\.0\.1$'
expect "HTTP redirects to HTTPS" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --resolve example.com:80:127.0.0.1 'http://example.com/ar?x=1')" '^301 https://example.com/ar\?x=1$'

echo "▸ Limits and compression"
codes=""; for _ in $(seq 10); do codes="$codes $(code -X POST -H 'Content-Type: application/json' --data '{}' https://example.com/api/inquiries)"; done
expect "lead form rate limit (5/min + burst 5)" "$codes" ' 429'
enc=$("${C[@]}" -o /dev/null -D - -H 'Accept-Encoding: gzip' https://example.com/en | tr -d '\r' | awk -F': ' 'tolower($1)=="content-encoding"{print $2}')
expect "HTML compressed by nginx" "$enc" '^gzip$'

echo "▸ Load-test exemption (loadtest-allow.conf)"
# 150 requests, 25 at a time: well above 20 requests/s + burst 40 for one address.
burst() { seq 150 | xargs -P 25 -I{} curl -s -k --max-time 10 --resolve example.com:443:127.0.0.1 -o /dev/null -w '%{http_code}\n' "https://example.com/api/regions?b={}" | sort | uniq -c | tr -s ' \n' ' '; }
expect "browsing limit applies normally" "$(burst)" ' 429'
echo '127.0.0.1 "";' > "$WORK/cf/loadtest-allow.conf"; chmod a+r "$WORK/cf/loadtest-allow.conf"
if [ -n "${NGINX_BIN:-}" ]; then "$NGINX_BIN" -p /etc/nginx/ -c /etc/nginx/nginx.conf -s reload; else docker exec "$CID" nginx -s reload >/dev/null; fi
sleep 2
out=$(burst); if [[ "$out" == *429* ]]; then bad "listed address still rate-limited: $out"; else ok "listed address isn't rate-limited while browsing"; fi
codes=""; for _ in $(seq 8); do codes="$codes $(code -X POST -H 'Content-Type: application/json' --data '{}' https://example.com/api/inquiries)"; done
expect "…but the lead-form limit still applies" "$codes" '429'

echo "▸ Resilience"
kill "$UP_PID"; UP_PID=""; sleep 11
expect "last good page served while the app servers are down" "$(hdr https://example.com/ar)" '^STALE$'

echo "▸ Access log"
if LOG | tail -3 | python3 -c 'import json,sys; [json.loads(l) for l in sys.stdin if l.strip()]' 2>/dev/null; then ok "JSON access log lines parse"; else bad "access log is not JSON"; fi

[ "$fails" = 0 ] && echo "✓ nginx behaves as designed" || { echo "✗ $fails nginx behaviour check(s) failed"; exit 1; }
