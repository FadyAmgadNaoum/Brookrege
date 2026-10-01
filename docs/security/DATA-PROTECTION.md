# Data protection & encryption (Phase 3 · Week 10)

## What is protected, where, and how

| Data | In transit | At rest | Notes |
|---|---|---|---|
| Visitor ↔ site | TLS 1.2/1.3 at Cloudflare's edge; TLS 1.3 only from Cloudflare to our server (`TLS_PROTOCOLS`) | — | HSTS with preload. Old Android phones (below Android 10) still connect over TLS 1.2 at the edge. |
| Server ↔ server (VPS1/2/3) | WireGuard (ChaCha20-Poly1305) | — | Database, pgBouncer, NFS and the apps are reachable only on the WireGuard addresses. |
| Staff passwords | TLS | bcrypt cost 12 (one-way) | Never stored or logged in plain text; upgraded automatically. |
| SendGrid / Twilio keys | TLS | **AES-256-GCM** | Masked in the admin (last 4 characters only). |
| Sessions / refresh tokens | TLS, `__Host-` cookies | SHA-256 hash only | A database leak doesn't reveal usable tokens. |
| Database backups | TLS / WireGuard to R2 | **age (X25519 + ChaCha20-Poly1305)**, public-key | The server holds only the public key; the owner keeps the private key offline. |
| Listing photos and videos | TLS | Cloudflare R2 encrypts every object at rest (AES-256), automatically | Public by design. |
| Customer leads (names, phones, messages) | TLS | Disk of the VPS; retention and erasure rules (Week 12) | See "Why not encrypt every column" below. |

## Decisions

**Database-wide encryption ("TDE").**
- PostgreSQL has no built-in transparent data encryption. On a rented VPS, disk encryption would only protect against someone taking the physical disk, and the provider controls the hypervisor and RAM anyway.
- Instead: encrypt the *secrets* (above), encrypt every *backup*, keep the database off the internet (WireGuard only), and limit how long personal data is kept (Week 12).

**Why not encrypt every customer column.**
- The key would have to sit on the same app server that reads the data, so an attacker who controls the app gets both.
- It would protect only against a raw database or backup leak, which encrypted backups and the private network already cover.
- It would break search, sorting and analytics on those fields.
- Revisit if a regulator or the client requires field-level encryption.

**"S3 SSE-KMS".**
- That's an AWS feature. We use Cloudflare R2 (Phase 2), which encrypts all objects at rest by default, with no setting to forget.
- The photos are public listing images; nothing private is stored in the bucket. Backups go to a separate bucket and are already age-encrypted before upload.

**bcrypt cost 12 instead of 10.**
- The architecture says 10; 12 is 4× harder to crack and still fast enough for sign-in. It's configurable (`BCRYPT_ROUNDS`).

## Secrets management
- **No secrets in the code or images.** `.env*` files are git-ignored. Docker build arguments carry only public values (`NEXT_PUBLIC_*`). CI scans every commit for leaked secrets (gitleaks, Week 12).
- **On servers:** `/opt/brookrege/.env.cluster` (or `.env.production`), owned by `deploy`, `chmod 600`.
- **In GitHub:** deployment credentials (SSH key, host addresses) go in *Settings › Secrets and variables › Actions*, never in workflow files.
- **Refusing unsafe production:** with `APP_ENV=production` the API won't start if:
  - a secret is an example value or too short;
  - `SETTINGS_ENCRYPTION_KEY` is missing;
  - cookies aren't Secure;
  - any URL isn't HTTPS.
- **Rotation:** see [KEY-ROTATION.md](KEY-ROTATION.md).

## Browser security headers
Both web apps send the following (`packages/domain/securityHeaders.mjs`, unit-tested):
- **Content-Security-Policy:**
  - scripts only from our own origin; nothing from other domains;
  - no plugins (`object-src 'none'`);
  - no framing (`frame-ancestors 'none'`);
  - forms submit only to our own origin;
  - HTTP requests upgraded to HTTPS.
- `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`.
- The API adds Helmet's headers; Nginx adds HSTS.
