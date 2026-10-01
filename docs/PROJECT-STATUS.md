# Project status — September 2026

## Done (all four phases + the home-page redesign)

| Area | State | Where |
|---|---|---|
| Public website (Arabic/English, light/dark, SEO) | complete | `apps/web` |
| Home film (wide film on laptops, portrait film on phones), photo banners on every page | complete | `docs/HOME-FILM.md` |
| Admin dashboard (listings, media, leads, analytics, team, security, privacy) | complete, restyled | `apps/admin`, manual: `docs/training/admin-manual/` |
| API, background jobs, email/SMS | complete | `apps/api`, `docs/api/index.html` |
| Security hardening (2FA, sessions, encryption, firewall, Cloudflare, privacy law) | complete | `docs/security/` |
| Three-server setup, database replica, load balancing | complete | `docs/PHASE2-WEEK5.md` |
| Monitoring, alerts, logs, backups | complete | `docs/operations/MONITORING.md` |
| Performance (indexes, caching, CDN, load-test scripts) | complete | `docs/operations/PERFORMANCE.md` |
| Release, deploy, rollback, staging | complete | `docs/operations/DEPLOYMENT-RUNBOOK.md` |
| Documentation, training plan, UAT plan, launch checklist, announcement kit | complete | `docs/` |

Checked here: business rules (41 tests), API unit tests (48), website and admin type checks, database
migrations, API reference (98 routes), deploy/rollback scenarios (56), nginx (16 configurations + behaviour),
monitoring rules and alerts, all Docker Compose files, every public page in a real browser on laptop and phone
in both languages. The API integration tests run in GitHub CI (they need the project's packages installed).

## Launch today

**`docs/LAUNCH-NOW.md`** (Arabic and English): rent a server, point the domain, upload the project, run
`bash scripts/install/install.sh`, answer three questions. The installer does the rest — Docker, firewall,
random passwords and keys, HTTPS, backups, the whole site and the first admin account.

## What only the owner can do (needs your accounts, money or signature)

These were postponed to the end of the project on purpose. Each links to step-by-step instructions.

| # | Step | Needs | Guide |
|---|---|---|---|
| 1 | Rent the servers (3 VPS, or 1 to start) | payment | `docs/PHASE2-WEEK5.md` › Production rollout |
| 2 | Put the code on GitHub (private repository) and set the variables | GitHub account | `docs/operations/DEPLOYMENT-RUNBOOK.md` › One-time setup |
| 3 | Domain brookrege.com in Cloudflare | registrar + Cloudflare login | `docs/security/INFRASTRUCTURE.md` |
| 4 | Make the backup key on your own computer, keep it offline | you, 5 minutes | `docs/security/BACKUPS.md` |
| 5 | SendGrid (email) and Twilio (SMS, sender ID for Egypt) accounts | accounts + payment | `docs/operations/SUPPORT-EMAIL.md`, Admin › Notifications |
| 6 | Real listings, regions, compounds, photos; the WhatsApp number | your content | Admin manual |
| 7 | Rights to the two home films, or your own footage (1920 px) | you | `docs/HOME-FILM.md` |
| 8 | Lawyer review of the privacy policy | lawyer | `docs/security/PRIVACY.md` |
| 9 | External security test | security company | `docs/security/SECURITY-TESTING.md` |
| 10 | Staff training and UAT sign-off | your team | `docs/training/TRAINING-PLAN.md`, `docs/launch/UAT-PLAN.md` |
| 11 | Launch day | you + technical contact | `docs/launch/GO-LIVE-RUNBOOK.md` |

Steps 1, 3 and 6 are enough to go live with the installer; the rest can follow in the first weeks.
