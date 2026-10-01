# Security documentation

| Document | What it covers |
|---|---|
| [ACCOUNT-SECURITY.md](ACCOUNT-SECURITY.md) | Staff accounts: password policy, lockout, sessions, IP allowlist, admin origin checks |
| [DATA-PROTECTION.md](DATA-PROTECTION.md) | Encryption in transit and at rest, secrets, security headers, production start-up checks |
| [INPUT-VALIDATION-AUDIT.md](INPUT-VALIDATION-AUDIT.md) | Every input reviewed (SQL injection, XSS, uploads…), findings fixed and accepted |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Cloudflare, firewall (and the Docker/UFW trap), nginx limits, SSH, kernel — with the ordered switch-on checklist |
| [PRIVACY.md](PRIVACY.md) | Personal data held, retention, access/export/erasure requests, Egypt's data protection law |
| [BACKUPS.md](BACKUPS.md) | Encrypted backups, off-site copy, restore drills |
| [KEY-ROTATION.md](KEY-ROTATION.md) | Rotating every secret and key |
| [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) | What to do when something goes wrong, breach notification |
| [SECURITY-TESTING.md](SECURITY-TESTING.md) | Automated scanners in CI, fix times, external penetration test scope |
| [STAFF-TRAINING.md](STAFF-TRAINING.md) | 45-minute staff session, quiz, Arabic quick card |

## Before launch — the human steps

The code and scripts are done; these need a person with access to the real accounts and servers:

1. Provision servers and run the checklist in `INFRASTRUCTURE.md` §1 (Cloudflare, firewall, origin pulls), then `verify-infra.sh` with no failures.
2. Generate and store the production secrets (`KEY-ROTATION.md`), the backup key pair (`BACKUPS.md`); run one restore drill.
3. Sign in as the first super admin, choose your own password; create staff accounts.
4. Lawyer review of the privacy page and the licensing/transfer questions (`PRIVACY.md`, top).
5. Fill in the contacts in `INCIDENT-RESPONSE.md` §1; run the staff training (`STAFF-TRAINING.md`).
6. Commit `package-lock.json` (run `npm install` once with internet access) so CI uses `npm ci` and scans the exact dependency tree.
7. Book the external penetration test (`SECURITY-TESTING.md`).

## Phase 4

Final review of what Phase 4 added (metrics, monitoring, cache, deploy pipeline, staging, SEO): [PHASE4-SECURITY-REVIEW.md](PHASE4-SECURITY-REVIEW.md).
