# Staging

A copy of the production setup on its own small server, where every release is checked before customers see
it, staff practise, and load tests run. Password-protected, invisible to search engines, with demo data and its
own secrets.

| | Production | Staging |
|---|---|---|
| Addresses | brookrege.com, admin.brookrege.com | staging.brookrege.com, staging-admin.brookrege.com |
| Server | VPS1–3 (or one) | one small VPS (2 vCPU, 4 GB is enough) |
| Files | `docker-compose.prod.yml` + `.env.production` | same + `docker-compose.staging.yml` + `.env.staging` |
| Web image | `web:<release>` | `web-staging:<release>` (built for the staging address) |
| Access | public | password on both sites (nginx), `X-Robots-Tag: noindex`, robots.txt blocks all |
| Data | real | demo listings (`STAGING_SEED_DEMO=true`) — never a copy of production personal data |
| Email/SMS | real providers | none configured by default; to test, use SendGrid sandbox mode and a Twilio test number |
| Photos | R2 `brookrege-media` | R2 `brookrege-media-staging` (separate bucket and token) |
| Start-up checks | strict | the same strict checks (`APP_ENV=staging`) |

## Set it up (once)

1. Provision the server like a single production server (`infra/provision/00-harden.sh`, `20-app-server.sh`,
   `30-firewall.sh setup --role single --cloudflare-only`), clone to `/opt/brookrege`.
2. DNS in Cloudflare: `staging` and `staging-admin` → the staging server, proxied. Certificate as in
   `docs/DEPLOYMENT.md` › 3, for both names.
3. `cp .env.staging.example .env.staging && chmod 600 .env.staging` and fill it. **Every secret new** — never
   copy production's `JWT_ACCESS_SECRET`, `SETTINGS_ENCRYPTION_KEY`, database or Redis passwords.
   The backup key pair can be a separate test pair.
4. The password for the whole site (share it with testers, change it after each UAT round):
   ```bash
   sudo mkdir -p /etc/brookrege/staging
   printf 'brookrege:%s\n' "$(openssl passwd -apr1)" | sudo tee /etc/brookrege/staging/htpasswd >/dev/null   # asks for the password
   sudo chmod 640 /etc/brookrege/staging/htpasswd
   ```
   More testers: one line each (`name:hash`). Remove a line to remove a tester.
5. GitHub: repository variable `STAGING_DOMAIN=staging.brookrege.com` (so Release images builds `web-staging`),
   environment `staging` with `DEPLOY_HOST`, `DEPLOY_TARGET=staging` and the SSH secrets
   (`docs/operations/DEPLOYMENT-RUNBOOK.md` › One-time setup).
6. First deploy by hand: `sudo scripts/deploy/deploy.sh --target staging --tag <release>`.

The demo super admin is `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env.staging`. Uptime checks can reach
`https://staging.brookrege.com/api/health` without the password; nothing else can.

## Checking a release on staging (10 minutes)

- Website: home, search with two filters, a listing (photos, map, WhatsApp button), a compound, the English site,
  dark mode, a phone-sized window.
- Submit an inquiry and an "add your property" request; see both in the admin.
- Admin: add a listing with two photos, publish, find it on the site within a minute, mark it sold.
- Anything the release changed, specifically.
- Grafana has no staging dashboards by default; look at `docker compose logs --since 15m api` for errors.

## Refreshing staging

Staging data is disposable: `docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --env-file .env.staging down -v`
then deploy again — the demo data is loaded at start. Never restore a production backup onto staging (it contains
customers' personal data); if a production-like volume is needed, generate it (`docs/operations/PERFORMANCE.md`).
