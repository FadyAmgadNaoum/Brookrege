# Final security review — Phase 4 changes

The full hardening and its tests are Phase 3 (`docs/security/README.md`). This review covers only what Phase 4
added, before launch. The **external penetration test** (`SECURITY-TESTING.md`) is still required and is done by
a person against the real servers.

| Area | Risk looked at | Result |
|---|---|---|
| Metrics endpoint (`:9464`) | Internal numbers or an admin route reachable from the internet | Separate HTTP server, not behind nginx; published only on 127.0.0.1 / 10.0.0.x; firewall flows only from VPS1; optional bearer `METRICS_TOKEN`. No personal data or ids in labels (routes are normalised). ✅ |
| Monitoring UIs (Grafana, Prometheus, Alertmanager, Loki) | Exposed dashboards, default passwords | Bound to loopback / private addresses; Grafana via SSH tunnel; admin password and SMTP/webhook secrets in `/etc/brookrege/monitoring/secrets` (600), checked by `configure.py`. Loki accepts pushes only from 10.0.0.2/.3. ✅ |
| Logs (Loki) | Personal data in logs | nginx JSON log uses `$uri` (no query strings, so no search terms or tokens); API logs ids only; 14-day retention, in the privacy notice. ✅ |
| Redis | Unauthenticated cache, cache poisoning | Password required (24+ characters, production start-up check); private address only; no persistence; keys namespaced; values are public data only (never sessions). ✅ |
| nginx micro-cache | Serving one visitor's page to another | Bypassed for any session cookie, `RSC` requests, non-GET, health; admin never cached; cache key includes `Origin`. Tested (`scripts/ci/nginx-behaviour.sh`). ✅ |
| View beacon `POST /api/properties/:id/view` | Inflating views, abuse | 30/min per address, 30-min dedupe per visitor and listing, bots ignored, only visible listings; returns nothing. ✅ |
| Sitemap `GET /api/sitemap` | Leaking hidden listings | Same visibility filter as the site (live, not expired); ids, slugs and dates only; cached; nginx rate limit. Test in `apps/api/test/api.test.ts`. ✅ |
| Structured data (JSON-LD) | Script injection through listing text | Serialized with `JSON.stringify`, `<` escaped, `type="application/ld+json"` (not executed). ✅ |
| Release workflow | Stolen credentials, tampered images | Only the job's short-lived `GITHUB_TOKEN` (`packages: write`); no third-party actions except `actions/checkout`; images labelled with the commit; servers pull by exact commit tag. ✅ |
| Deploy workflow | Command injection through inputs, man-in-the-middle | Inputs passed as environment variables, validated (hex commit, fixed target list) before use, validated again in `deploy.sh`; SSH with a dedicated key, `StrictHostKeyChecking=yes` and a pinned host key; production waits for a required reviewer; key file removed after the job. ✅ |
| Deploy script | Secrets exposure, partial deploys | Settings file stays 600 (rewritten in place); pre-deploy encrypted backup; nothing switched before all checks pass; automatic rollback; one deploy at a time (lock). 56 scenario tests. ✅ |
| Staging | Test copy found by search engines or attackers; shared secrets | Password on both sites, `noindex` header + robots, own secrets and database (example file says so), same strict start-up checks as production, demo data only. ✅ |
| Registry access on servers | Long-lived broad token | Fine-grained token with `read:packages` only; expiry in the owner's calendar (`DEPLOYMENT-RUNBOOK.md`). ⚠ human step |
| Email (support@, SPF/DKIM/DMARC) | Spoofed mail from brookrege.com | One SPF record (Cloudflare + SendGrid), DKIM via SendGrid, DMARC `quarantine`. ⚠ human step (`docs/operations/SUPPORT-EMAIL.md`) |
| Scripts and workflows | Shell bugs | ShellCheck (warnings) and actionlint clean; ShellCheck now runs in CI. ✅ |

Open items for launch: external penetration test, registry token and email DNS set-up, lawyer review of the privacy
notice — all listed in `docs/launch/LAUNCH-CHECKLIST.md`.
