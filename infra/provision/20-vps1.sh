#!/usr/bin/env bash
# VPS1 role: load balancer + primary DB + pgBouncer + shared uploads (NFS server).  Run as root after 10-wireguard.sh.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
apt-get install -y nfs-kernel-server

# Shared photo folder. All writes from app servers map to uid/gid 1000 (all_squash) so file ownership is consistent.
install -d -m 755 -o 1000 -g 1000 /srv/brookrege/uploads
install -d -m 700 /srv/brookrege/backups /var/www/certbot
grep -q "/srv/brookrege/uploads" /etc/exports || \
  echo "/srv/brookrege/uploads 10.0.0.2(rw,sync,no_subtree_check,all_squash,anonuid=1000,anongid=1000) 10.0.0.3(rw,sync,no_subtree_check,all_squash,anonuid=1000,anongid=1000)" >> /etc/exports
exportfs -ra && systemctl enable --now nfs-server

# Public: only web traffic. Private (wg0 only): Postgres, pgBouncer, NFS from the app servers.
# NFS is a host service (UFW applies). Postgres/pgBouncer/nginx run in Docker, which bypasses UFW —
# 30-firewall.sh (run next) enforces those.
ufw allow 80/tcp && ufw allow 443/tcp
for peer in 10.0.0.2 10.0.0.3; do
  ufw allow in on wg0 from $peer to any port 6432 proto tcp comment "pgbouncer"
  ufw allow in on wg0 from $peer to any port 5432 proto tcp comment "postgres replication/reinit"
  ufw allow in on wg0 from $peer to any port 2049 proto tcp comment "nfs uploads"
done
echo "✓ VPS1 ready. Deploy: cd /opt/brookrege/infra/servers/vps1 && docker compose --env-file ../../../.env.cluster up -d --build"
