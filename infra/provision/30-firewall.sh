#!/usr/bin/env bash
# Firewall for Brookrege servers — UFW for the host, plus rules for Docker (which UFW does NOT cover).
#
#   sudo bash 30-firewall.sh setup --role single|vps1|vps2|vps3 [--cloudflare-only] [--ssh-from CIDR[,CIDR…]] [--public-if eth0]
#   sudo brookrege-firewall status        # show what is applied
#   sudo brookrege-firewall apply         # re-apply (runs at every boot, and after the Cloudflare IP sync)
#   sudo brookrege-firewall remove        # take the Docker rules out again (UFW is left as is)
#
# WHY THE DOCKER PART MATTERS: ports published by Docker ("80:80", "10.0.0.2:4000:4000") are forwarded by
# Docker's own iptables rules BEFORE UFW sees them, so `ufw deny` does nothing for them. Docker provides the
# DOCKER-USER chain for exactly this; we hang a BROOKREGE chain off it:
#   • public interface: only 80/443 reach containers (the load balancer only) — with --cloudflare-only,
#     only from Cloudflare's ranges, so nobody can go around Cloudflare's WAF/DDoS protection by IP;
#   • wg0 (private network): only the server-to-server flows the cluster needs (table below);
#   • everything else that tries to open a new connection to a container is dropped.
#
# Role    public → containers   private (wg0) → containers
# single  80, 443               —
# vps1    80, 443               10.0.0.2 & 10.0.0.3 → 5432 (postgres), 6432 (pgbouncer)
# vps2    —                     10.0.0.1 → 3000, 3001, 4000 (apps), 5432 (replica), 9464 (metrics)
# vps3    —                     10.0.0.1 → 3000, 3001, 4000 (apps), 9464, 9465 (metrics); 10.0.0.2 → 6379 (Redis)
#
# Monitoring agents run with host networking, so UFW (not Docker) covers them — see monitoring_ufw below:
# node-exporter 9100 and cAdvisor 9338 everywhere, postgres-exporter 9187 on vps2, redis-exporter 9121 on
# vps3, all from 10.0.0.1 only; Loki 3100 on vps1 from 10.0.0.2 and 10.0.0.3.
set -euo pipefail

CONF="${FIREWALL_CONF:-/etc/brookrege/firewall.env}"
CF_DIR="${CF_DIR:-/etc/brookrege/cloudflare}"
CHAIN=BROOKREGE
IPT4="${IPT4:-iptables}"      # overridable for tests
IPT6="${IPT6:-ip6tables}"
UFW="${UFW:-ufw}"
SELF="$(readlink -f "$0")"

die() { echo "✗ $*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || [ "${FIREWALL_TEST:-0}" = 1 ] || die "Run as root"; }

public_ports() { case "$1" in single|vps1) echo "80 443" ;; *) echo "" ;; esac; }
# Lines of "SOURCE PORT" allowed in over wg0.
private_flows() {
  case "$1" in
    vps1) for s in 10.0.0.2 10.0.0.3; do for p in 5432 6432; do echo "$s $p"; done; done ;;
    vps2) for p in 3000 3001 4000 5432 9464; do echo "10.0.0.1 $p"; done ;;
    vps3) for p in 3000 3001 4000 9464 9465; do echo "10.0.0.1 $p"; done; echo "10.0.0.2 6379" ;;
  esac
}

# Host-network monitoring services (UFW): lines of "SOURCE PORT COMMENT".
monitoring_ufw() {
  case "$1" in
    vps1) for s in 10.0.0.2 10.0.0.3; do echo "$s 3100 loki-logs"; done ;;
    vps2) for p in 9100 9338 9187; do echo "10.0.0.1 $p monitoring"; done ;;
    vps3) for p in 9100 9338 9121; do echo "10.0.0.1 $p monitoring"; done ;;
  esac
}

load_conf() {
  [ -f "$CONF" ] || die "$CONF not found — run: 30-firewall.sh setup --role …"
  # shellcheck disable=SC1090
  . "$CONF"
  case "${ROLE:-}" in single|vps1|vps2|vps3) ;; *) die "ROLE in $CONF must be single, vps1, vps2 or vps3" ;; esac
  PUBLIC_IF="${PUBLIC_IF:-auto}"
  if [ "$PUBLIC_IF" = auto ]; then
    PUBLIC_IF="$( (ip route show default 2>/dev/null || true) | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  fi
  [ -n "$PUBLIC_IF" ] || die "Could not find the public network interface; set PUBLIC_IF in $CONF"
  CLOUDFLARE_ONLY="${CLOUDFLARE_ONLY:-0}"
}

# build_chain IPT FAMILY(4|6) — (re)creates the BROOKREGE chain and hooks it into DOCKER-USER.
build_chain() {
  local ipt="$1" fam="$2"
  if ! "$ipt" -n -L DOCKER-USER >/dev/null 2>&1; then
    echo "  • IPv$fam: no DOCKER-USER chain (Docker not running, or Docker IPv$fam off) — skipped"; return 0
  fi
  "$ipt" -N "$CHAIN" 2>/dev/null || "$ipt" -F "$CHAIN"
  "$ipt" -A "$CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  "$ipt" -A "$CHAIN" -i "$PUBLIC_IF" -m conntrack --ctstate INVALID -j DROP

  local ranges=""
  if [ "$CLOUDFLARE_ONLY" = 1 ]; then
    local list="$CF_DIR/ips-v$fam.txt"
    [ -s "$list" ] || die "--cloudflare-only needs $list — run infra/cloudflare/sync-ips.sh first"
    ranges="$(grep -Ev '^[[:space:]]*(#|$)' "$list")"
  fi
  for port in $(public_ports "$ROLE"); do
    if [ -n "$ranges" ]; then
      while read -r cidr; do
        "$ipt" -A "$CHAIN" -i "$PUBLIC_IF" -p tcp -s "$cidr" -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j RETURN
      done <<< "$ranges"
    else
      "$ipt" -A "$CHAIN" -i "$PUBLIC_IF" -p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j RETURN
    fi
  done
  "$ipt" -A "$CHAIN" -i "$PUBLIC_IF" -m conntrack --ctstate NEW -j DROP

  if [ "$fam" = 4 ] && [ "$ROLE" != single ]; then
    while read -r src port; do
      [ -n "$src" ] || continue
      "$ipt" -A "$CHAIN" -i wg0 -p tcp -s "$src" -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j RETURN
    done <<< "$(private_flows "$ROLE")"
    "$ipt" -A "$CHAIN" -i wg0 -m conntrack --ctstate NEW -j DROP
  fi
  "$ipt" -A "$CHAIN" -j RETURN   # traffic from containers themselves (bridges) is untouched

  # Hook: exactly one jump, first in DOCKER-USER.
  while "$ipt" -D DOCKER-USER -j "$CHAIN" 2>/dev/null; do :; done
  "$ipt" -I DOCKER-USER 1 -j "$CHAIN"
  echo "  ✓ IPv$fam: $("$ipt" -S "$CHAIN" | grep -c '^-A') rules in $CHAIN (public interface $PUBLIC_IF)"
}

remove_chain() {
  local ipt="$1"
  command -v "$ipt" >/dev/null 2>&1 || return 0
  while "$ipt" -D DOCKER-USER -j "$CHAIN" 2>/dev/null; do :; done
  "$ipt" -F "$CHAIN" 2>/dev/null || true
  "$ipt" -X "$CHAIN" 2>/dev/null || true
}

cmd_apply() {
  need_root; load_conf
  echo "▸ Docker firewall (role $ROLE$([ "$CLOUDFLARE_ONLY" = 1 ] && echo ", Cloudflare-only"))"
  build_chain "$IPT4" 4
  if command -v "$IPT6" >/dev/null 2>&1; then build_chain "$IPT6" 6; fi
}

cmd_status() {
  load_conf
  echo "Role: $ROLE · public interface: $PUBLIC_IF · Cloudflare-only: $([ "$CLOUDFLARE_ONLY" = 1 ] && echo yes || echo no)"
  for ipt in "$IPT4" "$IPT6"; do
    command -v "$ipt" >/dev/null 2>&1 || continue
    echo "── $ipt DOCKER-USER"; "$ipt" -S DOCKER-USER 2>/dev/null || echo "(no DOCKER-USER chain)"
    echo "── $ipt $CHAIN";      "$ipt" -S "$CHAIN" 2>/dev/null || echo "(not applied)"
  done
  command -v "$UFW" >/dev/null 2>&1 && { echo "── ufw"; "$UFW" status verbose || true; }
}

# ip_in_cidrs IP "CIDR,CIDR" → 0 if covered
ip_in_cidrs() {
  python3 - "$1" "$2" <<'PY' 2>/dev/null
import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
ok = any(ip in ipaddress.ip_network(c.strip(), strict=False) for c in sys.argv[2].split(",") if c.strip())
sys.exit(0 if ok else 1)
PY
}

cmd_setup() {
  need_root
  local role="" cf=0 ssh_from="" force=0 pub=auto
  while [ $# -gt 0 ]; do case "$1" in
    --role) role="$2"; shift 2 ;;
    --cloudflare-only) cf=1; shift ;;
    --ssh-from) ssh_from="$2"; shift 2 ;;
    --force) force=1; shift ;;
    --public-if) pub="$2"; shift 2 ;;
    *) die "Unknown option $1" ;;
  esac; done
  case "$role" in single|vps1|vps2|vps3) ;; *) die "--role must be single, vps1, vps2 or vps3" ;; esac
  if [ "$cf" = 1 ] && [ -z "$(public_ports "$role")" ]; then die "--cloudflare-only only makes sense on the server that receives web traffic (single or vps1)"; fi

  # Don't lock out the person running this.
  if [ -n "$ssh_from" ] && [ -n "${SSH_CLIENT:-}" ] && [ "$force" = 0 ]; then
    local me="${SSH_CLIENT%% *}"
    if ! ip_in_cidrs "$me" "$ssh_from"; then
      die "Your own address $me is not in --ssh-from ($ssh_from); you would lose SSH access. Add it, or pass --force."
    fi
  fi

  install -d -m 755 "$(dirname "$CONF")"
  cat > "$CONF" <<EOF
# Written by infra/provision/30-firewall.sh — re-run "30-firewall.sh setup" to change.
ROLE=$role
PUBLIC_IF=$pub
CLOUDFLARE_ONLY=$cf
SSH_FROM=$ssh_from
EOF
  chmod 644 "$CONF"
  load_conf   # validates the settings (e.g. the public interface) before anything is changed
  if [ "$cf" = 1 ] && [ ! -s "$CF_DIR/ips-v4.txt" ]; then die "--cloudflare-only needs $CF_DIR/ips-v4.txt — run infra/cloudflare/sync-ips.sh first"; fi

  echo "▸ Host firewall (UFW)"
  "$UFW" default deny incoming >/dev/null
  "$UFW" default allow outgoing >/dev/null
  # SSH: rate-limited for everyone (6 attempts / 30 s), or only from the given admin networks.
  "$UFW" --force delete allow OpenSSH >/dev/null 2>&1 || true
  "$UFW" --force delete limit OpenSSH >/dev/null 2>&1 || true
  if [ -n "$ssh_from" ]; then
    IFS=, read -r -a nets <<< "$ssh_from"
    for n in "${nets[@]}"; do "$UFW" limit from "$n" to any port 22 proto tcp comment "ssh (admin network)" >/dev/null; done
    echo "  ✓ SSH only from: $ssh_from (rate-limited)"
  else
    "$UFW" limit OpenSSH >/dev/null
    echo "  ✓ SSH open to all but rate-limited (6 per 30 s per address); keys only (see 00-harden.sh)"
  fi
  # Web ports on the host itself: nginx runs in Docker, so these rules are informational — the BROOKREGE
  # chain is what actually filters them. Keep them so `ufw status` tells the truth.
  if [ -n "$(public_ports "$role")" ]; then
    "$UFW" allow 80/tcp comment "web (filtered for Docker by BROOKREGE chain)" >/dev/null
    "$UFW" allow 443/tcp comment "web (filtered for Docker by BROOKREGE chain)" >/dev/null
  fi
  while read -r src port what; do
    [ -n "$src" ] || continue
    "$UFW" allow in on wg0 from "$src" to any port "$port" proto tcp comment "$what" >/dev/null
  done <<< "$(monitoring_ufw "$role")"
  "$UFW" logging low >/dev/null
  "$UFW" --force enable >/dev/null
  echo "  ✓ UFW on: incoming denied by default"

  # Installed so it can run at boot and from the Cloudflare sync.
  if [ "${FIREWALL_TEST:-0}" != 1 ]; then
    install -m 755 "$SELF" /usr/local/sbin/brookrege-firewall
    cat > /etc/systemd/system/brookrege-firewall.service <<'UNIT'
[Unit]
Description=Brookrege: firewall rules for Docker-published ports (DOCKER-USER)
# Docker (re)creates DOCKER-USER when it starts; our rules go in right after.
After=docker.service
PartOf=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/brookrege-firewall apply
ExecStop=/usr/local/sbin/brookrege-firewall remove

[Install]
WantedBy=multi-user.target docker.service
UNIT
    systemctl daemon-reload
    systemctl enable brookrege-firewall.service >/dev/null
  fi
  cmd_apply
  echo "✓ Firewall set up. Check from OUTSIDE with: bash scripts/security/verify-infra.sh"
}

case "${1:-}" in
  setup) shift; cmd_setup "$@" ;;
  apply) cmd_apply ;;
  status) cmd_status ;;
  remove) need_root; remove_chain "$IPT4"; remove_chain "$IPT6"; echo "✓ Docker firewall rules removed (UFW unchanged)" ;;
  *) sed -n '2,8p' "$SELF"; exit 2 ;;
esac
