#!/usr/bin/env bash
# VPS2 / VPS3 role: app server (api, web, admin). VPS2 also hosts the DB replica.
# Run as root after 10-wireguard.sh:   bash 20-app-server.sh 2    (or 3)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
N=${1:?Usage: 20-app-server.sh <2|3>}

# Mount the shared uploads folder from VPS1 over the private network.
install -d /srv/brookrege/uploads
grep -q "10.0.0.1:/srv/brookrege/uploads" /etc/fstab || \
  echo "10.0.0.1:/srv/brookrege/uploads /srv/brookrege/uploads nfs4 rw,hard,timeo=50,retrans=3,_netdev,x-systemd.requires=wg-quick@wg0.service 0 0" >> /etc/fstab
systemctl daemon-reload && mount -a
touch /srv/brookrege/uploads/.nfs-ok-vps$N && echo "✓ shared uploads mounted"

# Only VPS1 (the load balancer) may reach the apps. (These UFW rules document intent; ports published by
# Docker bypass UFW and are actually enforced by 30-firewall.sh — run it after this script.)
for port in 3000 3001 4000; do ufw allow in on wg0 from 10.0.0.1 to any port $port proto tcp comment "from load balancer"; done
if [ "$N" = "2" ]; then
  # Replica: pgBouncer reads from it; after a failover it becomes the primary; VPS1 may re-clone from it.
  ufw allow in on wg0 from 10.0.0.1 to any port 5432 proto tcp comment "postgres from vps1"
fi
echo "✓ VPS$N ready. Then: bash 30-firewall.sh setup --role vps$N. Deploy: cd /opt/brookrege/infra/servers/vps$N && docker compose --env-file ../../../.env.cluster up -d --build"
