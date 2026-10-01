# Deployment — Phase 1 (single VPS)

Phase 1 runs everything on one Hostinger VPS with Docker Compose. Phase 2 splits the database and adds a second app server.

## 1. Server preparation (once)

Ubuntu 24.04, 4 vCPU / 8 GB recommended (KVM 2 minimum).

```bash
# as root, after copying your SSH public key to /root/.ssh/authorized_keys
git clone <repo> /opt/brookrege
bash /opt/brookrege/infra/provision/00-harden.sh                       # deploy user, SSH keys-only, fail2ban, sysctl, Docker
bash /opt/brookrege/infra/provision/30-firewall.sh setup --role single # UFW + rules for Docker-published ports
```

Phase 3 hardening (Cloudflare in front, origin locked to Cloudflare, TLS 1.3 to the origin) is a separate,
ordered checklist: **docs/security/INFRASTRUCTURE.md**.

## 2. DNS

Point `brookrege.com`, `www.brookrege.com` and `admin.brookrege.com` A-records at the VPS.

## 3. TLS certificate (once)

```bash
docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --standalone \
  -d brookrege.com -d www.brookrege.com -d admin.brookrege.com --agree-tos -m you@example.com
```

Renewal: cron `0 3 * * 1` running certbot `renew --webroot -w /var/www/certbot` then `docker compose exec nginx nginx -s reload`.

## 4. Deploy

```bash
git clone <repo> /opt/brookrege && cd /opt/brookrege
cp .env.production.example .env.production   # fill every value; chmod 600
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The API container applies database migrations on every start. On the **first** deploy, the `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` values in `.env.production` create the first super admin (no demo data is loaded in production). Remove those two lines afterwards and restart.

Then sign in to the admin and add regions and compounds (Admin > Regions, compounds & projects).

## 5. Verify

- `https://brookrege.com` loads; `https://brookrege.com/api/admin/auth/me` returns 404 (admin API blocked on the public domain)
- `https://admin.brookrege.com` shows the sign-in page
- `docker compose -f docker-compose.prod.yml ps` — all services healthy
- Next morning: `ls backups/` shows a dump file

## 6. Update

```bash
git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## Restore a backup

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U brookrege -d brookrege --clean --if-exists < backups/brookrege-YYYY-MM-DD.dump
```
Test a restore at least once before launch.
