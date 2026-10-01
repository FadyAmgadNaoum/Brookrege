# Brookrege

Real estate brokerage platform for Sohag — public website, admin dashboard, and API.

```
apps/api      Express + Prisma + PostgreSQL     :4000
apps/web      Next.js 14 public website          :3000
apps/admin    Next.js 14 admin dashboard         :3001
packages/domain  Business rules shared by all three (pure TypeScript, no dependencies)
infra/        Nginx and Postgres config
docs/         Architecture, guides, runbooks, security, launch and training material
```

**Launch it:** [docs/LAUNCH-NOW.md](docs/LAUNCH-NOW.md) (one command on a new server) · **Start here:** [Project status](docs/PROJECT-STATUS.md) · [Architecture](docs/ARCHITECTURE.md) · [Home film](docs/HOME-FILM.md) · [Developer guide](docs/DEVELOPER-GUIDE.md) ·
[API reference](docs/api/index.html) (open in a browser) · [Decisions](docs/DECISIONS.md)

## Run it on your computer

1. Install **Docker Desktop** (Windows/Mac) or Docker Engine (Linux) and open it once.
2. Start Brookrege:
   - **Windows:** double-click **`start-brookrege.bat`** in this folder.
   - **Mac / Linux:** run `./start-brookrege.sh` in this folder.

   It checks that Docker is running, makes sure no other project is using Brookrege's ports (if another
   project's container holds one, it asks to stop it — nothing is deleted), builds and starts everything,
   waits until the Brookrege site answers and opens it. The first start takes 5–15 minutes; later ones seconds.
   (Without the script: `docker compose up -d --build`.)
3. Open:

| | URL | Sign-in |
|---|---|---|
| Website (Arabic, English in the header) | http://localhost:3000 | — |
| Admin dashboard | http://localhost:3001 | `admin@brookrege.com` / `Brookrege-Demo-2026!` |
| API health | http://localhost:4000/health | — |

Stop: `stop-brookrege.bat` (Windows) or `docker compose down` — your data is kept. Wipe all local data: `docker compose down -v`.
The database migrations and demo listings are applied automatically.

**localhost:3000 shows a different project?** Another project (for example one started with its own
`docker compose`, which restarts with Docker Desktop) is holding the port, so Brookrege could not start. Run
the start script — it finds and stops that container — or stop it in Docker Desktop › Containers.
**Need other ports?** Create a file named `.env` here with e.g. `WEB_PORT=3100`, `ADMIN_PORT=3101`,
`API_PORT=4100` (and `DB_PORT`, default 5434), then start again. If something still fails, the start script
saves the details in `brookrege-start-log.txt`.

## Content language rule

- **Written content** (listing titles, descriptions) is **Arabic first**; the `…En` field is an optional English version. The English site falls back to Arabic.
- **Place names** (regions, compounds, projects) are stored in Latin letters (`name`, used for URLs) with an Arabic `nameAr`.

## Developing with hot reload (optional)

Requirements: Node 20.11+, npm 10+.

```bash
npm install
docker compose up -d postgres
cp apps/api/.env.example   apps/api/.env        # set JWT_ACCESS_SECRET and SEED_ADMIN_PASSWORD
cp apps/web/.env.example   apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
npm run build:domain
npx -w @brookrege/api prisma migrate deploy     # migrations are already committed
npm run db:seed
npm run dev:api & npm run dev:web & npm run dev:admin
```

Schema changes: edit `apps/api/prisma/schema.prisma`, then `npx -w @brookrege/api prisma migrate dev --name <change>` and commit the new migration.

## Test

```bash
npm test -w @brookrege/domain     # business rules, no database needed

# API integration tests use the separate brookrege_test database:
DATABASE_URL=postgresql://brookrege:brookrege@localhost:5434/brookrege_test?schema=public \
DIRECT_DATABASE_URL=postgresql://brookrege:brookrege@localhost:5434/brookrege_test?schema=public \
  npx -w @brookrege/api prisma migrate deploy
DATABASE_URL=postgresql://brookrege:brookrege@localhost:5434/brookrege_test?schema=public \
  NODE_ENV=test JWT_ACCESS_SECRET=local-test-secret-local-test-secret-xx \
  npm test -w @brookrege/api

npm run typecheck
```

## Key business rules (see `packages/domain`)

- Rentals are apartments and shops only. Sales must be marked **developer** or **resale**.
- Published listings expire after 3 months (setting `listing_duration_months`). Expired listings disappear from the public site immediately (checked at read time) and are flipped to `EXPIRED` nightly at 02:00 Cairo time. Admins still see them and can renew.
- Roles: Super admin (everything), Content admin (listings, catalog, leads), Moderator (view, renew/expire, handle inquiries).
- Every admin change is written to the activity log in the same database transaction.

## Useful commands

```bash
npm run job:expire -w @brookrege/api      # run the expiry job once
npx -w @brookrege/api prisma studio       # browse the database
```

Production deployment: single server — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); three servers with load balancing and replication (Phase 2) — [docs/PHASE2-WEEK5.md](docs/PHASE2-WEEK5.md).

Media & CDN, analytics & reports, email/SMS and background jobs (Phase 2, weeks 6–8): [docs/PHASE2-WEEKS6-8.md](docs/PHASE2-WEEKS6-8.md).

Try the three-server setup on one computer:

```bash
docker compose -f docker-compose.cluster.yml up --build -d
bash scripts/cluster/run-local-drill.sh
```

## Security

Phase 3 hardening (sign-in protection, sessions, encryption, firewall, Cloudflare, privacy, incident response): start at
[`docs/security/README.md`](docs/security/README.md) — it also lists the steps that need a person before launch.
Report vulnerabilities as described in [`SECURITY.md`](SECURITY.md).

## Production (Phase 4)

| Topic | Document |
|---|---|
| Deploy, rollback, releases | [docs/operations/DEPLOYMENT-RUNBOOK.md](docs/operations/DEPLOYMENT-RUNBOOK.md) |
| Staging | [docs/operations/STAGING.md](docs/operations/STAGING.md) |
| Monitoring, alerts, runbooks | [MONITORING.md](docs/operations/MONITORING.md) · [RUNBOOKS.md](docs/operations/RUNBOOKS.md) |
| Performance and load tests | [docs/operations/PERFORMANCE.md](docs/operations/PERFORMANCE.md) |
| support@ email | [docs/operations/SUPPORT-EMAIL.md](docs/operations/SUPPORT-EMAIL.md) |
| Launch | [checklist](docs/launch/LAUNCH-CHECKLIST.md) · [go-live runbook](docs/launch/GO-LIVE-RUNBOOK.md) · [UAT](docs/launch/UAT-PLAN.md) · [announcement kit](docs/launch/MARKETING-KIT.md) |
| Training | [plan](docs/training/TRAINING-PLAN.md) · [admin manual (PDF)](docs/training/admin-manual/Brookrege-Admin-Manual.pdf) |
