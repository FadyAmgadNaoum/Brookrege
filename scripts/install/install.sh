#!/usr/bin/env bash
# Brookrege — one-command installer for ONE fresh Ubuntu server (22.04 or 24.04, 4 GB RAM or more).
#
#   1. Point your domain at the server (A records: @, www, admin → the server's IP address).
#   2. Copy the project to the server and run, as root:
#        cd /opt/brookrege && bash scripts/install/install.sh
#   It asks three questions (domain, your email, WhatsApp number) and does the rest:
#   Docker, firewall, secure random passwords and keys, HTTPS certificate (renewed automatically),
#   encrypted nightly backups, the website + admin + API + database + cache, and your first admin account.
#
#   Later:  bash scripts/install/install.sh --update     rebuild and restart after replacing the code (backup first)
#           bash scripts/install/install.sh --status     what's running
#
# Non-interactive (e.g. from a provider's "startup script"): set DOMAIN, EMAIL, WHATSAPP (and optionally
# ADMIN_DOMAIN, BACKUP_PUBLIC_KEY=age1…) in the environment. DRY_RUN=1 writes the settings file and prints the
# plan without installing anything (used by the tests).
# Guide (Arabic and English): docs/LAUNCH-NOW.md
main() {
set -Eeuo pipefail
trap 'echo; echo "✗ Stopped at line $LINENO. Nothing is lost: fix the problem shown above and run the same command again."' ERR
ROOT="${BROOKREGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"
ENVF="$ROOT/.env.production"
DC=(docker compose -f "$ROOT/docker-compose.prod.yml" --env-file "$ENVF")
DRY="${DRY_RUN:-0}"
say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

case "${1:-install}" in
  --status) "${DC[@]}" ps; exit 0 ;;
  --update) update; exit 0 ;;
  install|--install) ;;
  -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
  *) die "Unknown option $1 (use --help)" ;;
esac

[ "$DRY" = 1 ] || [ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash scripts/install/install.sh"
[ -f "$ROOT/docker-compose.prod.yml" ] || die "Run this from the Brookrege project folder."

# ───────────── 1. Questions ─────────────
say "Brookrege installer"
ask() { # VAR "question" "example" [default]
  local var="$1" q="$2" ex="$3" def="${4:-}" v="${!1:-}"
  while [ -z "$v" ]; do
    [ -t 0 ] || die "$var is not set (non-interactive run)"
    read -r -p "  $q${def:+ [$def]} (e.g. $ex): " v; v="${v:-$def}"
  done
  printf -v "$var" '%s' "$v"
}
ask DOMAIN "Website address, without www" "brookrege.com"
DOMAIN="${DOMAIN#http*://}"; DOMAIN="${DOMAIN#www.}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN,,}"
[[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "\"$DOMAIN\" doesn't look like a domain."
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.$DOMAIN}"
ask EMAIL "Your email (first admin account and certificate notices)" "owner@$DOMAIN"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "\"$EMAIL\" doesn't look like an email address."
ask WHATSAPP "WhatsApp number with country code, digits only" "201001234567"
WHATSAPP="${WHATSAPP//[^0-9]/}"; [ "${#WHATSAPP}" -ge 10 ] || die "The WhatsApp number is too short."
ok "Website https://$DOMAIN · admin https://$ADMIN_DOMAIN · first admin $EMAIL"

# ───────────── 2. Server checks ─────────────
say "Checking the server"
if [ "$DRY" != 1 ]; then
  . /etc/os-release 2>/dev/null || true
  [ "${ID:-}" = ubuntu ] || warn "This installer is tested on Ubuntu; you're on ${PRETTY_NAME:-unknown}."
  mem=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  free_gb=$(df -Pk "$ROOT" | awk 'NR==2 {print int($4/1048576)}')
  [ "$free_gb" -ge 12 ] || die "Only ${free_gb} GB free disk; at least 12 GB is needed."
  if [ "$mem" -lt 3800 ] && ! swapon --show | grep -q .; then
    warn "${mem} MB RAM: adding 4 GB of swap so the build doesn't run out of memory"
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  ok "${mem} MB RAM, ${free_gb} GB free disk"
fi

# ───────────── 3. Software ─────────────
say "Installing Docker, firewall and tools"
if [ "$DRY" != 1 ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg ufw openssl age cron dnsutils python3 >/dev/null
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "$(docker --version | cut -d, -f1), $(docker compose version --short)"
  if bash "$ROOT/infra/provision/30-firewall.sh" setup --role single >/tmp/brookrege-firewall.log 2>&1; then ok "firewall on (SSH, web; database and cache closed)"
  else
    warn "full firewall script failed (see /tmp/brookrege-firewall.log); using the basic rules"
    ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
  fi
fi

# ───────────── 4. DNS ─────────────
say "Checking that the domain points here"
if [ "$DRY" != 1 ]; then
  me=$(curl -fsS4 --max-time 8 https://api.ipify.org || curl -fsS4 --max-time 8 https://ifconfig.me || true)
  miss=0
  for h in "$DOMAIN" "www.$DOMAIN" "$ADMIN_DOMAIN"; do
    got=$(dig +short A "$h" @1.1.1.1 | tail -1)
    if [ -n "$me" ] && [ "$got" = "$me" ]; then ok "$h → $got"
    else warn "$h → ${got:-nothing} (this server is ${me:-unknown})"; miss=1; fi
  done
  if [ "$miss" = 1 ]; then
    echo "  Add A records for @, www and admin pointing to ${me:-this server}. With Cloudflare, set them to"
    echo "  'DNS only' (grey cloud) for the install; turn the orange cloud on afterwards (docs/LAUNCH-NOW.md)."
    [ -t 0 ] && read -r -p "  Continue anyway? The certificate step will fail if DNS isn't ready. [y/N] " a && [[ "$a" =~ ^[yY] ]] || die "Fix DNS, wait a few minutes, then run the installer again."
  fi
fi

# ───────────── 5. Settings and secrets ─────────────
say "Creating the settings file with secure random passwords"
if [ -f "$ENVF" ]; then
  ok "$ENVF already exists — keeping it (delete it to start over)"
else
  rnd() { openssl rand -hex "$1"; }
  admin_pw() { # meets the admin password policy: 16+ characters, upper, lower, digit, symbol, no sequences
    local p
    while :; do
      p="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 14)"
      p="${p:0:7}-${p:7:7}!"
      [[ "$p" =~ [a-z] && "$p" =~ [A-Z] && "$p" =~ [0-9] ]] || continue
      grep -Eiq '(.)\1\1\1|0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|pass|admin|brook|sohag' <<<"$p" && continue
      echo "$p"; return
    done
  }
  BACKUP_KEY_FILE=""
  if [ -z "${BACKUP_PUBLIC_KEY:-}" ]; then
    BACKUP_KEY_FILE="/root/brookrege-backup-key.txt"; [ "$DRY" = 1 ] && BACKUP_KEY_FILE="$ROOT/.dry-backup-key.txt"
    rm -f "$BACKUP_KEY_FILE"; age-keygen -o "$BACKUP_KEY_FILE" 2>/dev/null; chmod 600 "$BACKUP_KEY_FILE"
    BACKUP_PUBLIC_KEY="$(grep -o 'age1[0-9a-z]*' "$BACKUP_KEY_FILE" | head -1)"
  fi
  ADMIN_PASSWORD="$(admin_pw)"
  DOMAIN="$DOMAIN" ADMIN_DOMAIN="$ADMIN_DOMAIN" EMAIL="$EMAIL" WHATSAPP="$WHATSAPP" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  DBP="$(rnd 24)" JWT="$(rnd 48)" SEK="$(rnd 32)" RP="$(rnd 24)" BK="$BACKUP_PUBLIC_KEY" \
  python3 - "$ROOT/.env.production.example" "$ENVF" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
e = os.environ
values = {
  "PUBLIC_DOMAIN": e["DOMAIN"], "ADMIN_DOMAIN": e["ADMIN_DOMAIN"], "DB_PASSWORD": e["DBP"], "JWT_ACCESS_SECRET": e["JWT"],
  "WHATSAPP_NUMBER": e["WHATSAPP"], "BOOTSTRAP_EMAIL": e["EMAIL"], "BOOTSTRAP_PASSWORD": e["ADMIN_PASSWORD"],
  "STORAGE_DRIVER": "local", "PUBLIC_MEDIA_BASE_URL": "", "R2_BUCKET": "", "SETTINGS_ENCRYPTION_KEY": e["SEK"],
  "BACKUP_AGE_RECIPIENT": e["BK"], "REDIS_PASSWORD": e["RP"], "IMAGE_REGISTRY": "brookrege", "APP_VERSION": "installer",
}
out = []
for line in open(src):
    m = re.match(r"^([A-Z_]+)=", line)
    if m and m.group(1) in values:
        line = f"{m.group(1)}={values[m.group(1)]}\n"
    out.append(line)
out.append("\n# Installed by scripts/install/install.sh. Photos are stored on this server (STORAGE_DRIVER=local);\n"
           "# to move them to Cloudflare R2 later see docs/PHASE2-WEEKS6-8.md.\nIMAGE_TAG=local\n")
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: f.writelines(out)
PY
  chmod 600 "$ENVF"
  leftover=$(grep -nE '=(generate-|Choose-|age1replace)' "$ENVF" || true)
  [ -z "$leftover" ] || die "Example values left in the settings file: $leftover"
  ok "settings written to $ENVF (only root can read it)"
fi

if [ "$DRY" = 1 ]; then
  say "Dry run: stopping before certificates and containers"
  echo "  Would: get the HTTPS certificate for $DOMAIN, www.$DOMAIN, $ADMIN_DOMAIN; build and start the site;"
  echo "  create the first admin ($EMAIL); install certificate renewal and Cloudflare IP updates."
  exit 0
fi

# ───────────── 6. HTTPS certificate ─────────────
say "Getting the HTTPS certificate (Let's Encrypt)"
mkdir -p /etc/brookrege/cloudflare
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then ok "certificate already present"
else
  "${DC[@]}" stop nginx >/dev/null 2>&1 || true
  docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --standalone --non-interactive \
    --agree-tos -m "$EMAIL" -d "$DOMAIN" -d "www.$DOMAIN" -d "$ADMIN_DOMAIN" \
    || die "The certificate couldn't be issued. Usually DNS isn't pointing here yet (or the Cloudflare orange cloud is on). Fix it and run again."
  ok "certificate issued"
fi
cat > /etc/cron.d/brookrege-certbot <<CRON
# Renew the HTTPS certificate weekly (only renews when <30 days left), then reload nginx.
17 3 * * 1 root docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v brookrege_certbot-www:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot --quiet && cd $ROOT && docker compose -f docker-compose.prod.yml --env-file .env.production exec -T nginx nginx -s reload
CRON
ok "automatic renewal installed"
bash "$ROOT/infra/cloudflare/sync-ips.sh" >/dev/null 2>&1 && bash "$ROOT/infra/cloudflare/sync-ips.sh" --install >/dev/null 2>&1 && ok "Cloudflare address list installed (weekly refresh)" || warn "Cloudflare address list not fetched (fine if you don't use Cloudflare yet)"

# ───────────── 7. Build and start ─────────────
say "Building and starting Brookrege (10–20 minutes the first time)"
mkdir -p "$ROOT/backups"
"${DC[@]}" up -d --build
ok "containers started"

say "Waiting for the site to answer"
healthy=0
for _ in $(seq 60); do
  if curl -fsSk --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" | grep -q '"status":"ok"'; then healthy=1; break; fi
  sleep 5
done
[ "$healthy" = 1 ] || { "${DC[@]}" ps; "${DC[@]}" logs --tail 40 api web nginx; die "The site didn't become healthy in 5 minutes (logs above)."; }
ok "https://$DOMAIN answers"
curl -fsSk --max-time 10 --resolve "$ADMIN_DOMAIN:443:127.0.0.1" "https://$ADMIN_DOMAIN/login" -o /dev/null && ok "https://$ADMIN_DOMAIN answers" || warn "admin didn't answer yet — try it in a minute"

# ───────────── 8. First admin, then remove its password from the file ─────────────
say "Securing the first admin account"
pw_line=$(grep '^BOOTSTRAP_PASSWORD=' "$ENVF" | cut -d= -f2-)
sed -i -e 's/^BOOTSTRAP_EMAIL=.*/BOOTSTRAP_EMAIL=/' -e 's/^BOOTSTRAP_PASSWORD=.*/BOOTSTRAP_PASSWORD=/' "$ENVF"
"${DC[@]}" up -d api >/dev/null
ok "the admin password is no longer stored on the server"
"${DC[@]}" exec -T backup sh -c '. /etc/backup.env && brookrege-backup' >/dev/null 2>&1 && ok "first encrypted backup taken" || warn "first backup failed — check: docker compose -f docker-compose.prod.yml logs backup"

# ───────────── 9. Done ─────────────
cat <<DONE

════════════════════════════════════════════════════════════════════════
  Brookrege is live.

  Website   https://$DOMAIN
  Admin     https://$ADMIN_DOMAIN
  Sign in   $EMAIL
  Password  ${pw_line}
            (shown only now — write it down; you'll be asked to set 2-step verification)
DONE
if [ -n "${BACKUP_KEY_FILE:-}" ] && [ -f "$BACKUP_KEY_FILE" ]; then
  cat <<KEY

  BACKUP KEY — needed to restore backups. Copy these lines into your password manager
  AND print them. They are deleted from this server as soon as you confirm.
────────────────────────────────────────────────────────────────────────
$(cat "$BACKUP_KEY_FILE")
────────────────────────────────────────────────────────────────────────
KEY
  if [ -t 0 ]; then
    while :; do read -r -p "  Type SAVED once the key is stored safely: " s; [ "$s" = SAVED ] && break; done
    shred -u "$BACKUP_KEY_FILE" 2>/dev/null || rm -f "$BACKUP_KEY_FILE"
    echo "  ✓ backup key removed from the server"
  else
    echo "  ! Non-interactive install: the key is in $BACKUP_KEY_FILE — copy it off the server, then delete it."
  fi
fi
cat <<NEXT

  Next (docs/LAUNCH-NOW.md): sign in and turn on 2-step verification · add regions, compounds
  and listings · Admin › Notifications for email/SMS · turn on Cloudflare's orange cloud.
  Status: bash scripts/install/install.sh --status   Update: bash scripts/install/install.sh --update
════════════════════════════════════════════════════════════════════════
NEXT
}

update() {
  set -Eeuo pipefail
  local ROOT; ROOT="${BROOKREGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  local DC=(docker compose -f "$ROOT/docker-compose.prod.yml" --env-file "$ROOT/.env.production")
  [ -f "$ROOT/.env.production" ] || { echo "✗ Not installed yet — run without --update first."; exit 1; }
  echo "▸ Backup before updating"; "${DC[@]}" exec -T backup sh -c '. /etc/backup.env && brookrege-backup' || { echo "✗ Backup failed — not updating."; exit 1; }
  echo "▸ Rebuilding (the site keeps running until the new version is ready)"; "${DC[@]}" build
  echo "▸ Switching"; "${DC[@]}" up -d
  local d; d=$(grep '^PUBLIC_DOMAIN=' "$ROOT/.env.production" | cut -d= -f2)
  for _ in $(seq 36); do curl -fsSk --max-time 5 --resolve "$d:443:127.0.0.1" "https://$d/api/health" | grep -q '"status":"ok"' && { echo "✓ Updated and healthy"; return 0; }; sleep 5; done
  echo "✗ Not healthy after 3 minutes: bash scripts/install/install.sh --status, then check the logs."; exit 1
}

main "$@"
