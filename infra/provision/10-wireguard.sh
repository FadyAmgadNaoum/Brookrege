#!/usr/bin/env bash
# Private network 10.0.0.0/24 between the three VPS, encrypted with WireGuard.
# (Hostinger VPS plans don't provide a private network between servers, so we build one.)
#
# Step 1 — on EACH server:      sudo bash 10-wireguard.sh keygen
#          prints this server's public key. Collect all three.
# Step 2 — on EACH server:      sudo bash 10-wireguard.sh configure <N> <PUB1> <IP1> <PUB2> <IP2> <PUB3> <IP3>
#          N = 1, 2 or 3 (this server). PUBn = public keys from step 1, IPn = PUBLIC IPs of the servers.
# Step 3 — check from any server:  ping 10.0.0.1 && ping 10.0.0.2 && ping 10.0.0.3
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
cd /etc/wireguard
umask 077

case "${1:-}" in
  keygen)
    [ -f private.key ] || wg genkey > private.key
    wg pubkey < private.key > public.key
    echo "Public key of $(hostname): $(cat public.key)"
    ;;
  configure)
    [ $# -eq 8 ] || { echo "Usage: $0 configure <N> <PUB1> <IP1> <PUB2> <IP2> <PUB3> <IP3>"; exit 1; }
    N=$2; shift 2
    PUBS=("$1" "$3" "$5"); IPS=("$2" "$4" "$6")
    {
      echo "[Interface]"
      echo "Address = 10.0.0.$N/24"
      echo "ListenPort = 51820"
      echo "PrivateKey = $(cat private.key)"
      for i in 1 2 3; do
        [ "$i" = "$N" ] && continue
        echo
        echo "[Peer]  # vps$i"
        echo "PublicKey = ${PUBS[$((i-1))]}"
        echo "Endpoint = ${IPS[$((i-1))]}:51820"
        echo "AllowedIPs = 10.0.0.$i/32"
        echo "PersistentKeepalive = 25"
      done
    } > wg0.conf
    for i in 1 2 3; do [ "$i" = "$N" ] || ufw allow from "${IPS[$((i-1))]}" to any port 51820 proto udp comment "wireguard vps$i"; done
    systemctl enable --now wg-quick@wg0
    # Docker must start AFTER wg0 exists, because containers bind their ports to 10.0.0.x.
    mkdir -p /etc/systemd/system/docker.service.d
    printf '[Unit]\nAfter=wg-quick@wg0.service\nRequires=wg-quick@wg0.service\n' > /etc/systemd/system/docker.service.d/10-after-wireguard.conf
    systemctl daemon-reload && systemctl restart docker
    echo "✓ wg0 up as 10.0.0.$N"; wg show wg0 | head -20
    ;;
  *) echo "Usage: $0 keygen | configure ..."; exit 1 ;;
esac
