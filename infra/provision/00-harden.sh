#!/usr/bin/env bash
# Run as root on EVERY new VPS (Ubuntu 24.04):  bash 00-harden.sh
# Creates the deploy user, locks down SSH (keys only), enables firewall + fail2ban + automatic security
# updates, applies kernel network hardening, installs Docker. Safe to run again.
# Next: 10-wireguard.sh (cluster only), 20-*.sh for the server's role, then 30-firewall.sh.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

apt-get update -y
apt-get install -y ufw fail2ban unattended-upgrades ca-certificates curl gnupg jq openssl python3 python3-systemd \
  wireguard nfs-common postgresql-client-common
dpkg-reconfigure -f noninteractive unattended-upgrades

# ───────────── deploy user (SSH keys copied from root) ─────────────
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG sudo deploy
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
  echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy && chmod 440 /etc/sudoers.d/deploy
fi
[ -s /home/deploy/.ssh/authorized_keys ] || { echo "✗ /home/deploy/.ssh/authorized_keys is empty — add your SSH public key first, or you will be locked out"; exit 1; }

# ───────────── SSH: keys only, deploy user only ─────────────
# A drop-in named 00-… is read FIRST, and for sshd the first value wins — so these settings beat
# anything a cloud image puts in 50-cloud-init.conf (editing sshd_config with sed does not).
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-brookrege.conf <<'SSHD'
# Brookrege SSH hardening (infra/provision/00-harden.sh). Keys only; only the deploy user.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthenticationMethods publickey
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding local
PermitTunnel no
GatewayPorts no
PermitUserEnvironment no
LogLevel VERBOSE
# Modern algorithms only (OpenSSH 9.x on Ubuntu 24.04; every current client supports these).
KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
HostKeyAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
SSHD
chmod 644 /etc/ssh/sshd_config.d/00-brookrege.conf
grep -qE '^\s*Include\s+/etc/ssh/sshd_config.d/\*\.conf' /etc/ssh/sshd_config \
  || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
# Never reload a broken config (that is how people lock themselves out).
install -d -m 755 /run/sshd   # sshd -t needs it; Ubuntu 24.04 socket activation may not have created it yet
if sshd -t; then systemctl try-reload-or-restart ssh.service 2>/dev/null || systemctl try-reload-or-restart sshd.service; echo "✓ SSH: keys only, deploy user only"
else echo "✗ sshd -t failed — SSH NOT reloaded; fix /etc/ssh/sshd_config.d/00-brookrege.conf"; exit 1; fi

# ───────────── fail2ban: SSH + repeat offenders ─────────────
# Web attacks are blocked at Cloudflare (WAF, rate limits) and nginx (limit_req); banning Cloudflare's
# addresses here would block real visitors, so fail2ban only watches SSH.
cat > /etc/fail2ban/jail.d/brookrege.local <<'F2B'
[DEFAULT]
backend  = systemd
banaction = ufw
bantime  = 1h
findtime = 10m
maxretry = 5
ignoreip = 127.0.0.1/8 ::1 10.0.0.0/24

[sshd]
enabled = true
mode    = aggressive

# Banned 5 times in a day → banned for a week.
[recidive]
enabled  = true
backend  = auto
logpath  = /var/log/fail2ban.log
bantime  = 1w
findtime = 1d
maxretry = 5
F2B
systemctl enable fail2ban >/dev/null && systemctl restart fail2ban
echo "✓ fail2ban: sshd + recidive"

# ───────────── kernel network hardening ─────────────
cat > /etc/sysctl.d/90-brookrege.conf <<'SYSCTL'
# Brookrege (infra/provision/00-harden.sh). ip_forward stays ON: Docker and WireGuard need it.
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_synack_retries = 3
net.ipv4.tcp_rfc1337 = 1
net.core.somaxconn = 4096
# Loose reverse-path filtering (strict mode breaks WireGuard/Docker asymmetric routes).
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
kernel.yama.ptrace_scope = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.suid_dumpable = 0
SYSCTL
sysctl -e -q -p /etc/sysctl.d/90-brookrege.conf && echo "✓ kernel network hardening applied"

# ───────────── baseline firewall (30-firewall.sh completes it per role) ─────────────
ufw default deny incoming
ufw default allow outgoing
ufw limit OpenSSH
ufw --force enable

# ───────────── Docker ─────────────
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
usermod -aG docker deploy
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true,
  "userland-proxy": false
}
JSON
systemctl restart docker
echo "✓ Hardened. Next: 10-wireguard.sh (cluster) → 20-*.sh (role) → $HERE/30-firewall.sh setup --role …"
