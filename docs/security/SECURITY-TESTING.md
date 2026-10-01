# Security testing & vulnerability management (Phase 3 · Week 12)

## Automated (runs without anyone remembering to)

| What | Tool | When | Blocks the merge? |
|---|---|---|---|
| Secrets committed anywhere in Git history | gitleaks (`.gitleaks.toml`) | every push / PR | yes |
| Known-vulnerable dependencies (production) | `npm audit --omit=dev --audit-level=high` | every push / PR | yes |
| Known-vulnerable dependencies + secrets in files | Trivy `fs` | every push / PR | yes (HIGH/CRITICAL with a fix available) |
| nginx configuration | offline checker + real `nginx -t` on every combination (`scripts/ci/nginx-test.sh`) | every push / PR | yes |
| Migrations match the schema | `scripts/check-migrations.py` | every push / PR | yes |
| Security behaviour | API tests: `security.test.ts` (sign-in, lockout, sessions, allowlist, origin), `input-security.test.ts` (SQLi, XSS, tampering, pollution, limits), `privacy.test.ts` | every push / PR | yes |
| Vulnerable OS packages in our images | Trivy `image` on all 5 images | weekly + main | CRITICAL with a fix |
| Dockerfile / compose misconfiguration | Trivy `config` | weekly + main | report only |
| Running application (DAST) | OWASP ZAP baseline on web, admin, API (`.zap/rules.tsv`) | weekly + main | rules marked FAIL |
| Static analysis | Semgrep (OWASP Top 10, TypeScript, Node) | weekly + main | report only (warnings in the run) |
| Dependency scan (commercial) | Snyk | weekly + main, **only if `SNYK_TOKEN` secret is set** | HIGH |
| Dependency updates | Dependabot (`.github/dependabot.yml`) | weekly, security fixes immediately | PRs must pass CI |
| Live site & servers | `scripts/security/verify-infra.sh` | after every infrastructure change, and monthly | — |

Supply-chain note: in March 2026 Trivy's release v0.69.4 and its GitHub Actions were compromised. We therefore run Trivy as the
container `aquasec/trivy:0.69.3` (a version the maintainers list as safe) instead of third-party actions, and avoid
third-party actions in general. Better still: pin every scanner image by **digest** (`image@sha256:…`) once the pipeline runs.

## Fix times (vulnerability management)

| Severity | Internet-facing & exploitable | Otherwise |
|---|---|---|
| Critical | 48 hours | 7 days |
| High | 7 days | 30 days |
| Medium | 30 days | next planned release |
| Low | when convenient | — |

If a fix isn't available: mitigate (WAF rule, disable the feature, config change) and record it in `INPUT-VALIDATION-AUDIT.md` → "Accepted".
Snyk/Trivy ignores need a reason and an expiry date in the ignore file.

## External penetration test (needs a human tester — not something code can do)

Recommended once before launch (after `INFRASTRUCTURE.md` §1 is complete) and then yearly or after major changes. Budget: a small local firm or a vetted freelancer (e.g. OSCP/OSWE-certified) for ~3–5 days.

**Scope to send them**
- In scope: `https://brookrege.com` (public site, `/api/*`), `https://admin.brookrege.com` (admin app and `/api/admin/*`), the three VPS public IPs (network/service exposure only), Cloudflare configuration review.
- Accounts provided: one of each role (super admin, content admin, moderator) on a **staging copy** with demo data. Production testing only for non-destructive checks.
- Focus areas: authentication & session handling (lockout, session revocation, cookie scope), authorisation between roles, IDOR on admin endpoints, file upload (images/videos → sharp/ffmpeg), lead forms (spam, injection), admin origin/CSRF protections, IP allowlist bypass attempts (headers), rate limits, going around Cloudflare to the origin, information disclosure.
- Out of scope: DoS/volumetric testing, social engineering of staff, physical, third-party providers' own systems (Cloudflare, Hostinger, SMS/email providers).
- Rules: testing window agreed in writing; source IPs shared in advance (add them to the Cloudflare allow rule temporarily); stop and call on finding personal data or a critical issue.
- Deliverables: report with severity (CVSS), reproduction steps, fixes; a free re-test of fixed findings.

Record results here:

| Date | Tester | Critical/High/Medium/Low | All fixed by | Re-test |
|---|---|---|---|---|
| | | | | |
