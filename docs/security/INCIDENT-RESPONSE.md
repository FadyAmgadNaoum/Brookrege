# Incident response plan

For anything that threatens the site, the staff accounts or visitors' personal data. Print this page and keep a copy
offline — during an incident the wiki, email or laptop may be the thing that's compromised.

## 1. Who does what

| Role | Who | Backup |
|---|---|---|
| **Incident lead** — decides, keeps the timeline, talks to the owner | Fady (Unilira) | _fill in_ |
| **Technical responder** — servers, Cloudflare, database | _developer / contractor_ | _fill in_ |
| **Business owner** — approves customer/regulator communication | _Brookrege owner_ | _fill in_ |
| **Legal** — Personal Data Protection Center notification | _lawyer_ | — |

Contacts (phone numbers, not only email): _fill in_. Hosting: Hostinger support (hPanel › Help). Cloudflare: dashboard › Support.
Where the secrets live: the password manager vault "Brookrege production" (env files, backup private key, Cloudflare/R2 tokens).

## 2. Severity

| Level | Examples | Response |
|---|---|---|
| **SEV1** | Personal data exposed or stolen; attacker inside a server or the admin; site defaced; data lost | Start now, day or night. Owner informed within 1 hour. |
| **SEV2** | Site down or very slow (DDoS, outage); a staff account suspected compromised but no data seen; leaked secret | Start within 1 hour in working time, 4 hours otherwise. |
| **SEV3** | Suspicious activity blocked by controls (many failed sign-ins, scans); vulnerability report without exploitation | Next working day. |

When unsure, treat it as the higher level.

## 3. The first hour (any SEV1/SEV2)

1. **Start a timeline** (paper or a notes app on your phone): time, what you saw, what you did. Times in Cairo time.
2. **Preserve evidence before changing things**, where it takes minutes, not hours:
   - Activity log: Admin › Activity log (or `docker compose exec postgres pg_dump -t '"AuditLog"' …`).
   - Security events: Admin › Security › Events. Cloudflare › Security › Events (export).
   - Server logs: `docker compose logs --since 48h > incident-$(date +%F)-logs.txt` on each server; `journalctl -u ssh --since -2d`; `sudo fail2ban-client status sshd`.
   - A server you believe is compromised: take a **Hostinger snapshot** first (hPanel › VPS › Snapshots) — keep it, don't restore it.
3. **Contain** with the playbook below.
4. **Tell the owner** (SEV1: within the hour) — what happened, what's being done, next update time.

## 4. Playbooks

### A. A staff account is (maybe) compromised
1. Admin › Team › the person › **Sign out everywhere**, then **Suspend** (or reset their password — they must choose a new one at next sign-in).
2. Reset their 2FA (Team › Reset 2FA) if the phone/authenticator may be affected.
3. Several accounts, or a super admin: `bash scripts/ops/revoke-all-sessions.sh` — everyone is signed out immediately.
4. Review what they did: Activity log filtered by that person, last 30 days (exports, erasures, deletions, team and security changes).
5. If sign-ins came from unexpected places, turn on the **IP allowlist** (Admin › Security › Network) for the office/home networks.

### B. A secret leaked (env file, API key, database password, backup key)
Follow `KEY-ROTATION.md` for that secret — rotate **first**, investigate after. A leaked `SETTINGS_ENCRYPTION_KEY` together with a database copy exposes 2FA secrets and provider keys: rotate the key, then reset every staff member's 2FA and replace the provider keys.
Committed to Git? Rotate anyway — removing it from history is not enough (clones and caches exist). CI's secret scanner (gitleaks) should have flagged it; find out why it didn't.

### C. A server is compromised (unknown processes, changed files, unexpected SSH keys or users)
1. Snapshot (evidence), then **isolate**: in Cloudflare, point DNS to the healthy server if the cluster allows (VPS1 is the only web entry point — for VPS1, turn on Cloudflare **Under Attack mode** and continue); at Hostinger, restrict the VPS firewall to your own IP.
2. Do **not** try to clean it. Build a new VPS from the provisioning scripts (`00-harden.sh`, `10-wireguard.sh`, `20-*.sh`, `30-firewall.sh`), deploy from Git (never copy files from the compromised server), restore data from the last backup taken **before** the compromise if the database was touched (`BACKUPS.md`).
3. Rotate **all** secrets that were on that server (`KEY-ROTATION.md`) and every SSH key used there.
4. Revoke all staff sessions (A.3).

### D. The site is under attack / very slow (DDoS, scraping, credential stuffing)
1. Cloudflare › Overview › **Under Attack mode** on (every visitor gets a short check). Turn off once calm — it hurts real visitors.
2. Cloudflare › Security › Events: find the pattern (path, country, user agent, ASN) and add a block or challenge rule using the spare custom-rule slot (`INFRASTRUCTURE.md` §2).
3. Check the origin isn't being hit directly: `verify-infra.sh --expect-cloudflare-only`. If the origin IP leaked and Cloudflare-only isn't on yet, turn it on (`30-firewall.sh … --cloudflare-only`).
4. Many failed admin sign-ins: accounts lock themselves (5 failures); consider the IP allowlist.

### E. Personal data exposed or stolen → also §5
1. Stop the exposure (fix, take the page/endpoint offline, or put the site behind Cloudflare Access temporarily).
2. Work out **what** data (tables/columns), **whose** (how many people, which phone numbers), **since when**, and **how** — the activity log, nginx/Cloudflare logs, and the database.
3. Notify per §5 — the 72-hour clock starts when you learn of it, not when the investigation ends.

### F. Data deleted or corrupted (mistake, ransomware, bad migration)
1. Stop writes if needed: `docker compose stop api` (single server), or `api` on VPS2 and `api worker` on VPS3 (the public site shows its error page).
2. Restore the most recent good backup into a **scratch** database first (`scripts/ops/restore-drill.sh`), check it, then restore to production (`BACKUPS.md`). Cluster: restore to the primary, then re-initialise the replica (`scripts/cluster/reinit-replica.sh`).
3. Re-apply erasure requests made after that backup (Activity log › "Privacy requests") — see `PRIVACY.md`.

### G. Locked out of the admin (IP allowlist mistake, lost 2FA)
- IP allowlist: set `ADMIN_IP_ALLOWLIST_BYPASS=true` in the env file, restart the API, fix the list, set it back to `false`, restart. The Security page warns while the bypass is on.
- A super admin lost their 2FA device and backup codes: another super admin resets it (Team › Reset 2FA). The **only** super admin: on the server, `docker compose exec postgres psql …` → `UPDATE "User" SET "twoFactorEnabled"=false, "totpSecret"=NULL, "totpPendingSecret"=NULL WHERE email='…'; DELETE FROM "BackupCode" WHERE "userId"=(SELECT id FROM "User" WHERE email='…');` — they must set 2FA up again at next sign-in (super admins are always required to). Record this in the timeline.

### H. Someone reports a vulnerability
Thank them, don't threaten. Reproduce, fix, deploy, then reply. See `SECURITY.md` at the repository root.

## 5. Personal-data breach notification (Egypt, Law 151/2020)

- **Personal Data Protection Center: within 72 hours** of becoming aware (immediately if national security is involved) — the lawyer files it. Include: what happened, when, what data, how many people, likely consequences, what was done, contact person.
- **Affected people: within three working days after notifying the Center**, in Arabic (and English if they used English), by SMS/phone to the number they gave: what happened, what data, what we did, what they should do (e.g. be careful with calls claiming to be Brookrege), how to reach us.
- Keep a record of every breach, even ones that turn out not to need notification, and why.
- Not every incident is a personal-data breach: a blocked attack or a DDoS without data access usually isn't. When unsure, ask the lawyer inside the 72 hours.

Timelines per the law's executive regulations (Decree 816/2025) — confirm with the lawyer; see `PRIVACY.md`.

## 6. Afterwards (within 5 working days)

A short written review — no blame, facts only:
1. Timeline (from the notes).
2. Root cause — what allowed it, not just who clicked what.
3. What worked, what didn't (detection, response time, runbooks).
4. Actions with owners and dates (e.g. "add a WAF rule", "turn on IP allowlist", "add a test").
5. Update this plan and the other runbooks.

## 7. Practice

Twice a year, a 1-hour tabletop exercise with the team: read one scenario from §4 aloud and walk through who does what, using this page only. Every quarter, a real restore drill (`BACKUPS.md`). Record the date and gaps found here:

| Date | Exercise | Gaps found | Fixed |
|---|---|---|---|
| | | | |
