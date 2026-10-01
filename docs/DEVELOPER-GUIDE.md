# Developer guide

For whoever writes code on Brookrege. Start with `README.md` (running it) and `docs/ARCHITECTURE.md` (the map).
This page is the conventions: how to add things so they stay consistent, secure, fast and observable.

## 1. Setup in five minutes

```bash
docker compose up --build                 # everything, with demo data: web :3000, admin :3001, api :4000
# or, for hot reload:
npm install && docker compose up -d postgres redis
npm run build:domain && npx -w @brookrege/api prisma migrate deploy && npm run db:seed
npm run dev:api & npm run dev:web & npm run dev:admin
```

Node 20.11+, npm 10+. Editor: format on save (Prettier), TypeScript strict everywhere.

## 2. Repository layout

| Path | What |
|---|---|
| `packages/domain` | Business rules shared by all apps. **Put a rule here if both the UI and the API need it** (listing validation, permissions, password policy, media sizes). No dependencies; unit-tested with `node:test`. |
| `apps/api` | Express API + worker. `src/modules/<area>/*.routes.ts` per area. |
| `apps/web`, `apps/admin` | Next.js apps. Talk to the API only. |
| `infra/` | nginx, PostgreSQL, pgBouncer, backup, monitoring, provisioning, per-server compose files. |
| `scripts/` | CI checks, deploy, cluster drills, monitoring and API-doc generators. |
| `docs/` | Everything written. `docs/DECISIONS.md` records why. |

## 3. Adding an API endpoint — checklist

1. **Route** in the right `*.routes.ts`, wrapped in `asyncHandler(...)` (it also labels metrics with the route).
2. **Validate every input** with zod: `validate(schema, "body" | "query" | "params")`, read with `parsed<typeof schema>(req, "body")`. Bound every string and number (`.max()`); never trust `req.body` directly.
3. **Permission** (admin routes): `requirePermission("property:write")`. New permission? Add it to `packages/domain/src/permissions.ts` and decide each role explicitly.
4. **Errors**: throw `notFound()`, `forbidden()`, `badRequest(msg)`, `conflict(msg)` from `lib/errors.ts`. The error handler turns them into `{ error: { code, message } }` and never leaks stack traces.
5. **Audit** every admin change: `await audit(req, { action: "property.update", entityType, entityId, before, after }, tx)` — in the **same transaction** as the change.
6. **Cache** (public reads): wrap in `cachedPublic([name, params], TTL.x, load)`. Admin writes under `/properties`, `/catalog`, `/media` clear the public cache automatically (`invalidatePublicOnWrite`); anything else that changes public data must call `invalidatePublic()`.
7. **Reads** that can be slightly stale: `readDb()` (the replica). Never mix replica and primary in one transaction.
8. **Metrics**: HTTP rate/latency/errors are automatic. Business events get a counter in `src/metrics/registry.ts` (name `brookrege_<thing>_total`, few label values — never user ids or free text).
9. **Logs**: `logger.info("snake_case_event", { ids only })`. No personal data (phone, email, message text) in logs.
10. **Docs**: add the operation to `scripts/api/build_openapi.py`, then `python3 scripts/api/build_openapi.py`. CI fails if a route in the code is missing from `docs/api/openapi.yaml` (`scripts/api/routes.py --check`) or if the generated files are stale.
11. **Tests**: integration test with supertest in `apps/api/test/*.test.ts` (real PostgreSQL), unit tests for pure logic in `apps/api/test/unit` (`node:test`).

## 4. Database and migrations

- Change `apps/api/prisma/schema.prisma`, then `npx -w @brookrege/api prisma migrate dev --name <change>`; commit the migration folder. CI refuses schema changes without a migration (`scripts/check-migrations.py`).
- **Raw-SQL indexes.** Some indexes can't be expressed in `schema.prisma` (partial indexes for public listings, trigram indexes for search, `INCLUDE` columns — migration `20260930000000_phase4_performance`). If `prisma migrate dev` ever generates `DROP INDEX` for `Property_public_*`, `Property_admin_updated_idx`, `*_trgm_idx` or `Inquiry_createdAt_idx`, **delete those lines** from the new migration before committing.
- **Expand, then contract.** Deploys roll back the *code*, not the database (`scripts/deploy/rollback.sh`). So every migration must keep the **previous release working**:
  - add columns as nullable or with a default; add tables freely;
  - to rename or change a column: release 1 adds the new column and writes both; release 2 reads the new one; release 3 drops the old one;
  - never drop or rename a column the running release still reads, in the same release that stops reading it.
- Long operations on big tables (`CREATE INDEX` on `Property`, backfills) → `CREATE INDEX CONCURRENTLY` in its own migration, or a job.
- Check a query plan before shipping anything that filters or sorts listings: `EXPLAIN (ANALYZE, BUFFERS)` against a copy with realistic data (`docs/operations/PERFORMANCE.md`).

## 5. Front end (web and admin)

- **Text**: every visible string in `apps/web/lib/i18n/ar.ts` and `en.ts` (same keys; TypeScript checks). Arabic is the default and the fallback.
- **Layout**: logical properties only (`ms-`, `me-`, `start-`, `end-`), so RTL and LTR both work.
- **Data**: server components fetch with `apiGet(path, revalidate)`; per-visitor things (view counting, forms) run in the browser.
- **SEO**: every page's `generateMetadata` returns `withAlternates(locale, path, {...})` from `lib/site.ts` (canonical + hreflang + Open Graph). New public page → add it to `app/sitemap.ts`.
- **Images**: use the WebP variants with `srcSet` (`pickVariant`, `srcSet` from the domain package); only the largest element above the fold loads eagerly.
- **Admin**: guard buttons with `can("permission")` for a clean UI, but the API is the authority.
- **Security headers / CSP**: `packages/domain/securityHeaders.mjs`. A new third-party script or host needs a CSP change and a reason in `DECISIONS.md`.

## 6. Background jobs

`enqueue("type", payload, { db: tx })` inside the transaction that creates the reason for it; add the handler in
`modules/jobs`. Jobs retry with back-off and appear in Admin › Notifications › Background jobs when they fail.
Scheduled work goes in `jobs/scheduler.ts` wrapped in `runExclusive(lockId, …)` so it runs once across servers.

## 7. Testing and CI

```bash
npm test -w @brookrege/domain                                # business rules
cd apps/api && npx tsx --test test/unit/*.test.ts            # API unit tests (no database)
npm test -w @brookrege/api                                   # API integration tests (PostgreSQL; see README)
npm run typecheck
python3 scripts/check-nginx.py infra/nginx/templates/default.conf.template --root infra/nginx …   # see ci.yml
bash scripts/monitoring/check.sh                             # Prometheus rules/tests, Alertmanager, dashboards
bash tests/deploy/test-deploy.sh                             # deploy/rollback scripts
```

CI (`.github/workflows/ci.yml`) runs all of these plus migration checks, nginx behaviour with stand-in servers,
compose validation, ShellCheck, Trivy (dependencies and secrets) and the API-doc check. `security.yml` runs ZAP and
Semgrep weekly. A red CI blocks the release.

## 8. Releasing

Merge to `main` → CI → **Release images** builds and publishes images tagged with the commit (first 12
characters) → **Deploy** workflow (staging first, then production). Rollback is one click. Details:
`docs/operations/DEPLOYMENT-RUNBOOK.md`.

Rules: small pull requests; one reviewer; no deploys on Thursday evening or Friday (Egyptian weekend, nobody to
watch); anything touching sign-in, permissions, uploads or payments-like flows gets a second look against
`docs/security/INPUT-VALIDATION-AUDIT.md`.
