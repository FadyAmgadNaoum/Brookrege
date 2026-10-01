#!/usr/bin/env bash
# Applies Brookrege's Cloudflare security configuration through the Cloudflare API (idempotent).
#
#   CF_API_TOKEN=… CF_ZONE_ID=… PUBLIC_DOMAIN=brookrege.com ADMIN_DOMAIN=admin.brookrege.com \
#     bash infra/cloudflare/apply.sh [--plan free|pro] [--origin-pull] [--dry-run]
#
# API token permissions (Cloudflare › My Profile › API Tokens › Create custom token), for this zone only:
#   Zone › Zone Settings: Edit · Zone › Zone WAF: Edit · Zone › Bot Management: Edit
# What it sets (details and reasons: docs/security/INFRASTRUCTURE.md):
#   TLS: Full (strict), minimum TLS 1.2, TLS 1.3 on, HTTPS everywhere, HSTS (2 years, subdomains, preload)
#   WAF custom rules (Free allows 5 — this uses 4, leaving one for you)
#   Rate limiting for sign-in and lead forms (Free: 1 rule, 10-second window)
#   Pro plan only: Cloudflare Managed Ruleset + OWASP Core Ruleset
#   Bot Fight Mode on
#   --origin-pull: Authenticated Origin Pulls on. Do this BEFORE setting ORIGIN_PULL=on on the server:
#                  Cloudflare then presents its certificate, and the server can start requiring it.
set -euo pipefail

PLAN=free; ORIGIN_PULL=0; DRY=0
while [ $# -gt 0 ]; do case "$1" in
  --plan) PLAN="$2"; shift 2 ;;
  --origin-pull) ORIGIN_PULL=1; shift ;;
  --dry-run) DRY=1; shift ;;
  *) echo "Unknown option $1"; exit 2 ;;
esac; done
[ "$PLAN" = free ] || [ "$PLAN" = pro ] || { echo "--plan must be free or pro"; exit 2; }
: "${PUBLIC_DOMAIN:?}" "${ADMIN_DOMAIN:?}"
if [ $DRY = 0 ]; then : "${CF_API_TOKEN:?}" "${CF_ZONE_ID:?}"; fi
ZONE="${CF_ZONE_ID:-ZONE_ID}"
API="https://api.cloudflare.com/client/v4/zones/$ZONE"

call() { # call METHOD PATH JSON  → prints a one-line result; exits on API error
  local method="$1" path="$2" body="$3"
  echo "$body" | jq -e . >/dev/null || { echo "✗ invalid JSON for $path"; exit 1; }
  if [ $DRY = 1 ]; then printf '%s %s\n%s\n\n' "$method" "$path" "$(echo "$body" | jq -c .)"; return; fi
  local out; out=$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" --data "$body")
  if [ "$(echo "$out" | jq -r .success)" = true ]; then echo "  ✓ $method $path"; else echo "  ✗ $method $path: $(echo "$out" | jq -c .errors)"; exit 1; fi
}
setting() { call PATCH "/settings/$1" "{\"value\": $2}"; }

echo "▸ TLS and HTTPS"
setting ssl '"strict"'                      # origin certificate is validated (Let's Encrypt on the server)
setting min_tls_version '"1.2"'             # TLS 1.0/1.1 refused at the edge
setting tls_1_3 '"on"'
setting always_use_https '"on"'
setting automatic_https_rewrites '"on"'
setting 0rtt '"off"'                        # no replayable early data
setting security_header '{"strict_transport_security": {"enabled": true, "max_age": 63072000, "include_subdomains": true, "preload": true, "nosniff": true}}'
setting browser_check '"on"'

echo "▸ WAF custom rules"
jqs() { jq -Rn --arg s "$1" '$s'; } # JSON-quote a string
EXPR_PROBES='(http.request.uri.path contains "/.env") or (http.request.uri.path contains "/.git") or (http.request.uri.path contains "wp-login") or (http.request.uri.path contains "wp-admin") or (http.request.uri.path contains "xmlrpc.php") or (http.request.uri.path contains "phpmyadmin") or ends_with(http.request.uri.path, ".php")'
EXPR_ADMIN_API_PUBLIC="(http.host in {\"$PUBLIC_DOMAIN\" \"www.$PUBLIC_DOMAIN\"} and starts_with(http.request.uri.path, \"/api/admin\"))"
EXPR_METHODS='not (http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"})'
EXPR_ADMIN_ABROAD="(http.host eq \"$ADMIN_DOMAIN\" and ip.src.country ne \"EG\")"
call PUT "/rulesets/phases/http_request_firewall_custom/entrypoint" "$(cat <<JSON
{ "description": "Brookrege custom rules (infra/cloudflare/apply.sh)",
  "rules": [
    { "description": "Block scanner probes for files and apps we don't have", "action": "block", "expression": $(jqs "$EXPR_PROBES") },
    { "description": "Admin API is never served on the public hostname", "action": "block", "expression": $(jqs "$EXPR_ADMIN_API_PUBLIC") },
    { "description": "Only the HTTP methods the site uses", "action": "block", "expression": $(jqs "$EXPR_METHODS") },
    { "description": "Admin from outside Egypt must pass a challenge (staff abroad still get in)", "action": "managed_challenge", "expression": $(jqs "$EXPR_ADMIN_ABROAD") }
  ] }
JSON
)"

echo "▸ Rate limiting ($PLAN plan)"
# Free plan: 1 rule, path-only expression, 10-second window and block. Pro: longer windows.
EXPR_RL='(http.request.uri.path in {"/api/admin/auth/login" "/api/admin/auth/2fa/verify" "/api/inquiries" "/api/submissions"})'
if [ "$PLAN" = free ]; then RL='{"characteristics": ["cf.colo.id", "ip.src"], "period": 10, "requests_per_period": 5, "mitigation_timeout": 10}'
else RL='{"characteristics": ["cf.colo.id", "ip.src"], "period": 60, "requests_per_period": 10, "mitigation_timeout": 600}'; fi
call PUT "/rulesets/phases/http_ratelimit/entrypoint" "$(cat <<JSON
{ "description": "Brookrege rate limits (infra/cloudflare/apply.sh)",
  "rules": [ { "description": "Sign-in, 2FA and lead forms", "action": "block", "expression": $(jqs "$EXPR_RL"), "ratelimit": $RL } ] }
JSON
)"

if [ "$PLAN" = pro ]; then
  echo "▸ Managed WAF rulesets (Pro)"
  call PUT "/rulesets/phases/http_request_firewall_managed/entrypoint" '{
    "description": "Brookrege managed rules (infra/cloudflare/apply.sh)",
    "rules": [
      { "description": "Cloudflare Managed Ruleset", "action": "execute", "expression": "true", "action_parameters": { "id": "efb7b8c949ac4650a09736fc376e9aee" } },
      { "description": "Cloudflare OWASP Core Ruleset", "action": "execute", "expression": "true", "action_parameters": { "id": "4814384a9e5d4991b9815dcfc25d2f1f" } }
    ] }'
else
  echo "▸ Managed WAF rulesets: Free plan uses the Cloudflare Free Managed Ruleset (on automatically). Pro adds the full Managed + OWASP rulesets."
fi

echo "▸ Speed (Phase 4)"
# Photos, scripts and styles are cached at Cloudflare's edge by default (by file extension) for as long as the
# origin allows (Next.js assets and uploads are "immutable", 1 year). HTML and API answers are NOT cached at the
# edge: nginx's 10-second micro-cache and the app's Redis cache handle them, and admin changes stay instant.
setting http3 '"on"'
setting early_hints '"on"'                  # browsers start fetching CSS/fonts while the page is generated
call PATCH "/cache/tiered_cache_smart_topology_enable" '{"value": "on"}'   # fewer requests reach the origin (free)

echo "▸ Bots"
call PUT "/bot_management" '{"fight_mode": true}'

if [ $ORIGIN_PULL = 1 ]; then
  echo "▸ Authenticated Origin Pulls"
  setting tls_client_auth '"on"'
fi
echo "Done. Verify from outside: bash scripts/security/verify-infra.sh"
