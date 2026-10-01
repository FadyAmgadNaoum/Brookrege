# Training plan

Four audiences, each with sessions, hands-on exercises on **staging**, and a short check that proves the person
can do the job alone. Materials are already in the repository; this page says who learns what, in which order.

| Audience | Who | Length | Material |
|---|---|---|---|
| Client / owner | Owner and managers | 2 × 90 min | Admin manual, Analytics, launch docs |
| Admins (staff) | Content admins, moderators, sales | 2 × 2 h + practice week | Admin manual (`admin-manual/Brookrege-Admin-Manual.pdf`), security training |
| Developers | Whoever maintains the code | 2 days | Architecture, developer guide, API reference |
| Operations (DevOps) | Technical contact + a backup person | 2 days | Deployment runbook, monitoring, runbooks, backups, incidents |

Every session runs on staging with demo data, never on production. The trainer keeps the attendance table at the
end of this page.

## 1. Client / owner

**Session 1 — the business view (90 min)**
- Tour of the website as a customer on a phone (search, listing, WhatsApp, inquiry form).
- Admin overview: roles and who gets which (manual ch. 1); the daily and weekly routine (ch. 17).
- Analytics & reports: reading the numbers, inquiries per 100 views, time to first response; exporting; scheduling
  the weekly report (ch. 10).

**Session 2 — owning the system (90 min)**
- Team: adding and suspending staff, what to do when someone leaves (ch. 11).
- Security: 2FA (optional, recommended for super admins), backup codes stored offline, recognising phishing calls (ch. 2, 13;
  `docs/security/STAFF-TRAINING.md`).
- Privacy requests and retention — the owner's legal duties under the PDPL (ch. 14).
- What the owner must keep safe: the backup private key, the Cloudflare and GitHub accounts, registrar login.
- Who to call when: `docs/security/INCIDENT-RESPONSE.md` contacts; the monthly report of the technical contact.

**Check:** the owner adds a staff member, schedules a report, handles a mock privacy request, and says where the
backup key is kept (without showing it).

## 2. Admins (staff)

**Session 1 — listings (2 h):** signing in, first password, 2FA (ch. 2) · adding a listing with photos and video,
the listing rules (rent = apartments and shops; sale = developer or resale) · good photos · publishing, renewing,
sold, archive (ch. 4–6) · catalog for content admins (ch. 9).

**Session 2 — leads (2 h):** inquiries and their statuses, notes, the one-working-day call-back rule (ch. 7) ·
property submissions → listing (ch. 8) · customer data: what not to do (no personal WhatsApp groups, no
spreadsheets) · security awareness (`docs/security/STAFF-TRAINING.md`, 45 min, with its quiz).

**Practice week (staging):** each person adds 5 listings, handles 10 test inquiries created by the trainer, and
reports one problem through the right channel.

**Check (15 min each):** from a blank screen, publish a complete listing with photos and coordinates; move an
inquiry to "Viewing booked" with a note; renew an expiring listing; explain what to do if someone phones asking
for their 2FA code. Pass = done without help.

## 3. Developers

**Day 1 — understand it:** `docs/ARCHITECTURE.md` walkthrough · run it locally · `packages/domain` and why rules
live there · request flow through nginx, cache and replica · `docs/DECISIONS.md` highlights (sessions, cache,
view beacon, append-only audit log) · security model (`docs/security/README.md`, input validation audit).

**Day 2 — change it:** `docs/DEVELOPER-GUIDE.md` checklist · exercise: add a public endpoint end to end (zod,
cache, metric, audit where relevant, OpenAPI entry, integration test) · a migration following expand/contract ·
CI: read a failing run · release and deploy to staging, then roll back (`DEPLOYMENT-RUNBOOK.md`).

**Check:** the exercise pull request passes CI and review; the developer explains why a migration may not drop a
column the running release reads.

## 4. Operations (DevOps)

**Day 1 — run it:** servers and network (`docs/PHASE2-WEEK5.md`, `docs/security/INFRASTRUCTURE.md`) · deploy,
cluster deploy, rollback (`DEPLOYMENT-RUNBOOK.md`) · staging (`STAGING.md`) · monitoring: Grafana dashboards,
Loki log search, alert routing, silences (`docs/operations/MONITORING.md`).

**Day 2 — rescue it (drills on staging or the local cluster):**
- Alert drill: stop the API on one server → `TargetDown` arrives → follow the runbook → recover.
- Backup drill: `scripts/ops/restore-drill.sh`; restore into a scratch database; check row counts.
- Failover drill: `scripts/cluster/run-local-drill.sh` (database failover, replica re-init).
- Bad release drill: deploy a release that fails health checks → watch the automatic rollback.
- Incident tabletop: "an admin account is stolen" using `docs/security/INCIDENT-RESPONSE.md`.
- Key rotation walkthrough (`docs/security/KEY-ROTATION.md`).

**Check:** alone, with the runbooks only: deploy and roll back on staging, restore a backup, and silence then
resolve an alert. A second person is trained so holidays are covered.

## Attendance

| Date | Session | Trainer | Attendees | Check passed |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
