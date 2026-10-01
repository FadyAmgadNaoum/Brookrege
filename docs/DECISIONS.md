# Architecture decisions — Phase 1

Deviations from `BROOKREGE-FINAL-COMPLETE-ARCHITECTURE.md`, with reasons. Each is reversible.

| # | Decision | Doc said | Why |
|---|----------|----------|-----|
| 1 | Schema written in Prisma for PostgreSQL | SQL with `ENUM(...)` columns, inline `INDEX`, `FULLTEXT`, `SPATIAL` | That SQL is MySQL syntax and would not run on PostgreSQL. |
| 2 | No public user accounts / favorites | Buyer registration, favorites, saved searches | Not in the client brief. Buyers contact via call-back form or WhatsApp. Removes a whole attack surface. Easy to add later. |
| 3 | Transaction = SALE or RENT | SALE / RENT / BOTH | "Both" breaks price meaning (sale price vs monthly rent) and filtering. List twice if needed. |
| 4 | Seller type = DEVELOPER or RESALE | developer / resale / private | Matches the client's two labels exactly. |
| 5 | Rent restricted to apartments and shops; land has no rooms | — | Client brief. Enforced in `packages/domain`, used by API and admin form. |
| 6 | Added `Project` model (partnership / completed) and `PropertySubmission` | Not modelled | Client asked for these sections and for the "Add your property" page. |
| 7 | Expiry enforced at read time + nightly job | Nightly job only | A listing disappears the moment it expires, even if the job hasn't run. |
| 8 | Job lock via Postgres transaction advisory lock | Redis | Works across multiple app servers (Phase 2) without adding Redis now. |
| 9 | No Redis in Phase 1 | Redis for cache/sessions | Traffic doesn't need it yet; rate limits are in-memory (single app server) plus Nginx. Redis arrives in Phase 2 when there are two app servers. |
| 10 | Access token 15 min, httpOnly cookies, refresh rotation with reuse detection | 1-hour access token | Shorter exposure if a token leaks; rotation detects stolen refresh tokens. |
| 11 | Admin API served only on the admin domain | Same API host for both | The public domain returns 404 for `/api/admin/*` — admin endpoints aren't even reachable from the public site. |
| 12 | Basic photo upload in Phase 1 (local disk behind a `StorageDriver` interface) | Media in Phase 2 | An admin without photos isn't usable. Resizing/WebP and Cloudflare R2 plug into the same interface in Phase 2. |
| 13 | Calm palette (limestone / palm green / sandstone), IBM Plex Sans Arabic | Bright blue `#2563EB`, Inter | Client asked for calm, non-bright colours. Plex Arabic covers Latin and Arabic so RTL is a switch, not a redesign. |
| 14 | Search uses case-insensitive `contains`; lat/lng floats | PostgreSQL full-text + PostGIS | Enough for hundreds of listings. Upgrade when volume or radius search requires it. |
| 15 | Next.js data pages render per request | ISR | Builds never depend on a running API. Revisit in Phase 4 with caching at Nginx/Cloudflare. |

## Update — Arabic-first, dark mode, Apple-style landing

| # | Decision | Why |
|---|----------|-----|
| 16 | Public site is Arabic (Egypt, RTL) by default at `/ar`; English at `/en`. The visitor's choice is remembered in a cookie. | Client requirement. Separate URLs per language are indexable by Google in both languages. |
| 17 | Content rule: written content (titles, descriptions) is Arabic-primary with optional `…En`; place names are Latin `name` + `nameAr`. English falls back to Arabic. | Staff write Arabic first; translation is optional, never blocking. |
| 18 | Western digits in Arabic text (1,850,000 ج.م) and proper Arabic plural forms (وحدة / وحدتان / ٣ وحدات / ١١ وحدة). | Matches Egyptian property sites; correct grammar. |
| 19 | Light / dark / match-device theme via CSS variables; applied before first paint (no flash). | Client requirement. Every component shares one set of class names. |
| 20 | Apple-style landing: pinned scroll scenes, word-by-word statement, reveal-on-scroll, snap gallery, page transitions. All motion is disabled for reduced-motion users and content is visible without JavaScript. | Client requirement, without sacrificing accessibility. |
| 21 | Docker images transpile without type-checking; `npm run typecheck` and lint run in CI. | A type-level nit can never block the site from starting; CI still enforces correctness. |
| 22 | Initial migration committed (`20260926000000_init`), verified column-by-column against the Prisma schema. | Removes the manual `prisma migrate dev` step; `docker compose up --build` is the only command needed. |

## Phase 2 · Week 5

| # | Decision | Why |
|---|----------|-----|
| 23 | WireGuard mesh for the 10.0.0.x private network | Hostinger VPS plans don't provide private networking between servers; WireGuard is encrypted, fast and built into the Linux kernel. |
| 24 | Private services bind to WireGuard IPs, never 0.0.0.0 | Docker bypasses the ufw firewall for published ports; binding to 10.0.0.x is the only reliable way to keep them off the internet. |
| 25 | All app DB traffic through pgBouncer (three aliases: write / migrate / read) | A failover changes one config on one server; app servers never need redeploying. |
| 26 | Prisma `?pgbouncer=true` + separate session-mode alias for migrations | Transaction pooling breaks prepared statements and Prisma's migration lock; the aliases handle both. |
| 27 | Replica reads only for public pages, automatic fallback to primary | Admin always sees its own writes; a replica outage never takes the site down. |
| 28 | Physical replication slot with `max_slot_wal_keep_size=4GB` | The primary keeps WAL for a lagging replica, but can never fill its disk if the replica is gone for days. |
| 29 | Failover script fences (stops) the old primary before promoting | Prevents split-brain (two primaries accepting different writes). |
| 30 | Shared uploads over NFS until Week 6 | Two app servers must see the same photos; R2 replaces this next week behind the existing storage interface. |
| 31 | pgBouncer image built from Alpine packages | No third-party image to trust; fully reproducible. |
| 32 | Local 3-server simulation (`docker-compose.cluster.yml`) + `run-local-drill.sh` | Every Week 5 test, including a real failover, can run on one laptop before buying servers. |

## Phase 2 · Weeks 6–8

| # | Decision | Why |
|---|----------|-----|
| 33 | Cloudflare R2 (not AWS S3) behind the existing `StorageDriver` | No egress fees; CDN on the same account; S3-compatible so switching later is a config change. |
| 34 | WebP variants 480/960/1600, EXIF stripped, never upscaled | ~95% smaller downloads on mobile; removes GPS location from owners' phone photos. |
| 35 | Video limit 95 MB | Cloudflare Free/Pro reject request bodies over 100 MB. Longer videos: direct-to-R2 presigned uploads (future). |
| 36 | HEIC rejected with instructions | The standard sharp build can't decode HEIC; a clear message beats a silent failure. |
| 37 | Media library as its own table (`MediaAsset`), listings link to it | Reuse files across listings; soft delete + 30-day restore; nightly clean-up of abandoned uploads. |
| 38 | Durable Postgres job queue instead of Redis Pub/Sub | Pub/Sub loses messages when no worker listens; SKIP LOCKED gives exactly-once claiming with no new infrastructure. Redis remains optional for caching later. |
| 39 | Providers called over HTTPS with `fetch` (no SDKs) | Fewer dependencies; request formats unit-tested. |
| 40 | Provider keys AES-256-GCM encrypted in DB, masked in the UI | Staff can manage providers without server access; a database leak doesn't leak the keys. |
| 41 | PDF via print view, not server-side | PDF libraries can't shape Arabic text; the browser renders it correctly. |
| 42 | "User analytics" = staff team activity | The public site intentionally has no accounts (decision 2). |
| 43 | Views counted per day, bots excluded, detail page uncached | Accurate views and conversion rates. (Fixed a Phase 1 bug: the page's 30-second data cache meant most views were never counted.) |

## Phase 3 · Security hardening (Weeks 9–12)

| # | Decision | Why |
|---|----------|-----|
| 44 | Server-side session record per sign-in, checked on every admin request | Instant revocation (sign out everywhere, suspend, role change) and a real 60-minute idle timeout — a JWT alone can't be taken back. |
| 45 | TOTP implemented with `node:crypto` (RFC 6238 test vectors), no 2FA library | Tiny, auditable, no dependency; replay-protected (a code works once). |
| 46 | 2FA mandatory for super admins, optional (policy switch) for others | The accounts that can change security settings must have it; small team can phase in the rest. |
| 47 | Lockout in the database (5 failures → 15 min, doubling, max 24 h) + per-IP limits | Works across both app servers; an attacker can't reset the counter by passing the password step. |
| 48 | bcrypt cost 12 (roadmap said 10), upgraded on sign-in | ~250 ms per check on the VPS: still fast for staff, 4× harder to crack than 10. |
| 49 | Admin API accepts only the admin origin (Origin/Sec-Fetch-Site) + SameSite=Strict `__Host-` cookies | Closes cross-site request forgery and the "XSS on the public site reaches the admin" path found in the audit. |
| 50 | No database TDE; volume encryption at the host + field encryption for secrets + encrypted backups | PostgreSQL has no built-in TDE; the realistic threats (a leaked dump/backup, a stolen API key) are covered by `age`-encrypted backups and AES-256-GCM secrets. |
| 51 | Files: Cloudflare R2 server-side encryption (always on) instead of AWS SSE-KMS | We use R2 (decision 33); R2 encrypts all objects at rest by default. |
| 52 | Activity log append-only by database trigger | Even a compromised app or admin can't erase their tracks; privacy clean-up is the only, logged, exception. |
| 53 | Firewall for containers in `DOCKER-USER` (plus UFW for the host) | Docker bypasses UFW (see 24); this is Docker's supported hook, and lets web ports accept Cloudflare only. |
| 54 | TLS 1.3 only between Cloudflare and origin; TLS 1.2+ at the edge | Cloudflare speaks 1.3 to origins; some older phones still need 1.2 at the edge. |
| 55 | fail2ban for SSH only | Behind Cloudflare every visitor has a Cloudflare address; banning at the server would block customers. Web abuse is stopped by Cloudflare + nginx + API limits. |
| 56 | Security scanners as pinned containers, not third-party GitHub Actions | The March 2026 Trivy/trivy-action compromise showed actions tags can be hijacked. |
| 57 | Leads anonymized (not deleted) after 24 months; erasure keeps the row | Egypt's PDPL requires limited retention and erasure on request; keeping the anonymized row keeps reports and counts correct. |

## Phase 4 · Production ready (Weeks 13–16)

| # | Decision | Why |
|---|----------|-----|
| 58 | Logs in Grafana Loki (+ Alloy) instead of the ELK stack | Elasticsearch needs 2–4 GB of RAM on its own; Loki fits next to the database on VPS1 and shares Grafana with the metrics. Promtail is end-of-life, so Alloy ships the logs. |
| 59 | Own ~200-line Prometheus registry instead of `prom-client` | No dependency for a small, stable format (exposition 0.0.4, checked by `promtool check metrics`); metrics served on a separate port (9464) that the internet can't reach. |
| 60 | Monitoring binds to loopback / private addresses only; Grafana reached through an SSH tunnel | Nothing new exposed to the internet; Docker bypasses UFW, so the private flows are opened explicitly in `DOCKER-USER`. |
| 61 | Alerts by severity: critical → email + Slack/Telegram, repeated every 2 h; warning → email; info → email at most hourly, repeated daily; a Watchdog heartbeat to an outside service | Few, actionable alerts; the heartbeat catches "monitoring itself is down", which no internal alert can. |
| 62 | Two-level cache: per-server memory (≤30 s) + shared Redis, cleared on every admin change via a generation number and pub/sub | Fast reads without stale data after an edit; if Redis is down the site keeps working on memory + database. |
| 63 | nginx micro-cache (10 s, stale on error) for anonymous public pages and API | Absorbs traffic peaks (10k visitors ≈ a few hundred app requests/s) and keeps serving the last good page if the app servers fail. |
| 64 | Views counted by a browser beacon, not when the page is rendered | Pages can then be cached; bots and repeat views are excluded (fixes view loss that caching would cause). |
| 65 | Partial and trigram indexes in raw SQL; "top listings" query rewritten | Measured 10–150× faster on 40k listings; Prisma can't express these indexes, so the developer guide says how to keep them. |
| 66 | Load tests with k6, scripts in the repo; 5k/10k runs from several machines against staging | A single CI runner can't simulate 10k visitors; the script and thresholds are fixed so results are comparable. |
| 67 | Release = the commit; images built once by CI and pushed to GitHub's registry; servers never build | What was tested is exactly what runs; a rollback is an image switch (≈1 min), not a rebuild. |
| 68 | `deploy.sh` does backup → migrate → switch → health check → automatic rollback; cluster deploys one server at a time | No downtime on three servers; a bad release never stays live; migrations follow expand/contract so code rollbacks are safe. |
| 69 | Staging = production files + a small override (password, noindex, demo data, own secrets, same strict checks) | Tests the real configuration; can't be found by search engines or leak production data. |
| 70 | API reference generated from a script and checked in CI against the routes in the code | The docs can't silently drift from the API (98 operations). |
| 71 | SEO basics in the app: per-page canonical + hreflang, sitemap from a cheap API endpoint, robots by environment, Open Graph image, JSON-LD for listings | Fixes a Phase 1 bug where every page declared the home page as its alternate; listings get rich previews on WhatsApp and search. |
| 72 | support@ via Cloudflare Email Routing (forwarding), sending via SendGrid | No mailbox to pay for or secure; one SPF record covers both. |

## Home page redesign (client reference, September 2026)

| # | Decision | Why |
|---|----------|-----|
| 73 | Home page opens with a scroll-driven film (chapters, rail, timeline, hotspots), styled after the client's laptop reference; serif display type (Marcellus / Amiri), champagne-gold calls to action, dark cinematic sections | Client asked for the site to look like the reference. The rest of the site keeps its layout and adopts the same type and gold accents so it reads as one design. |
| 74 | Film as a `<video>` with a keyframe every 8 frames, seeked from scroll — not an image sequence | 6 MB instead of ~16 MB for the same smoothness; poster first so it never delays the first paint; still photo for reduced motion and data saver. |
| 75 | "Illustrative film" caption on the footage | The footage is not a Brookrege listing; presenting it as one would mislead buyers. |
| 76 | Two home films chosen by screen shape: a landscape film on wide screens, a portrait film on portrait screens | Each screen shows footage in its native shape at full quality instead of a cropped, enlarged band; chapters and labels are defined per film. |
| 77 | Inner pages open with a photo title banner; admin gets the same wordmark, dark sidebar and gold main buttons | One visual identity across the public site and the staff tool, without changing how the admin works. |
| 78 | Two-step verification is optional for every role, including super admins (previously compulsory for super admins) | Owner's request. Each person can still turn it on, and *Security › Policy › Require for everyone* makes it compulsory again with one switch. Strong passwords, lockout and server-side recovery remain. |
| 79 | Two-step verification removed completely (sign-in is email + password); its database fields, recovery codes, policy switch and screens are gone (migration `20261001000000_remove_two_step_verification`). Replaces row 78 | Owner's request. Remaining protection: password policy, lockout after 5 wrong passwords, server-side sessions with idle/absolute limits, per-IP and Cloudflare rate limits, optional IP allowlist, security alert emails, append-only activity log. Cloudflare Access in front of the admin (docs/security/INFRASTRUCTURE.md) can add a second gate without app changes. |
