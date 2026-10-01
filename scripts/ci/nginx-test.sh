#!/usr/bin/env bash
# Runs the REAL `nginx -t` (same image as production) on every configuration combination we ship.
# Needs Docker. Used by CI; run locally with:  bash scripts/ci/nginx-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE="${NGINX_IMAGE:-$(grep -m1 -oE 'nginx:[0-9.]+-alpine' docker-compose.prod.yml)}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# Stand-in certificates: Let's Encrypt layout for example.com, plus an origin-pull CA.
mkdir -p "$WORK/le/live/example.com" "$WORK/cf"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=example.com" \
  -keyout "$WORK/le/live/example.com/privkey.pem" -out "$WORK/le/live/example.com/fullchain.pem" 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=Test origin pull CA" \
  -keyout /dev/null -out "$WORK/cf/origin-pull-ca.pem" 2>/dev/null
cp infra/nginx/cloudflare/realip.conf "$WORK/cf/realip.conf"
mkdir -p "$WORK/cf-empty"   # also prove nginx starts before sync-ips.sh has ever run
mkdir -p "$WORK/staging" && printf 'tester:%s\n' "$(openssl passwd -apr1 test)" > "$WORK/staging/htpasswd"
chmod -R a+rX "$WORK"

HOSTS=(--add-host api:127.0.0.1 --add-host web:127.0.0.1 --add-host admin:127.0.0.1
       --add-host api-1:127.0.0.1 --add-host api-2:127.0.0.1 --add-host web-1:127.0.0.1
       --add-host web-2:127.0.0.1 --add-host admin-1:127.0.0.1 --add-host admin-2:127.0.0.1)
fails=0
run() { # NAME docker-args…
  local name="$1"; shift
  if out=$(docker run --rm "${HOSTS[@]}" "$@" "$IMAGE" nginx -t 2>&1); then echo "✓ $name"
  else echo "✗ $name"; echo "$out" | grep -v '^/docker-entrypoint' | sed 's/^/    /'; fails=$((fails+1)); fi
}

for upstreams in single-server multi-server; do
  for tls in "TLSv1.2 TLSv1.3" "TLSv1.3"; do
    for pull in off on; do
      for cf in cf cf-empty; do for access in public staging; do
        [ "$pull" = on ] && [ "$cf" = cf-empty ] && continue   # origin pulls need the CA file (sync-ips.sh)
        run "template · $upstreams · $tls · origin-pull $pull · $cf · $access" \
          -e PUBLIC_DOMAIN=example.com -e ADMIN_DOMAIN=admin.example.com -e TLS_PROTOCOLS="$tls" -e ORIGIN_PULL="$pull" -e SITE_ACCESS="$access" \
          -v "$WORK/staging:/etc/nginx/staging:ro" \
          -v "$PWD/infra/nginx/templates:/etc/nginx/templates:ro" \
          -v "$PWD/infra/nginx/snippets:/etc/nginx/snippets:ro" \
          -v "$WORK/$cf:/etc/nginx/cloudflare:ro" \
          -v "$PWD/infra/nginx/upstreams/$upstreams.conf:/etc/nginx/upstreams.conf:ro" \
          -v "$WORK/le:/etc/letsencrypt:ro"
      done; done
    done
  done
done
run "cluster-local (docker-compose.cluster.yml)" \
  -v "$PWD/infra/nginx/cluster-local.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/infra/nginx/snippets:/etc/nginx/snippets:ro"

[ "$fails" = 0 ] && echo "All nginx configurations pass nginx -t ($IMAGE)" || { echo "$fails configuration(s) failed"; exit 1; }
