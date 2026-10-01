# Input validation & injection audit (Phase 3 · Week 10)

**Scope:** every place untrusted input enters: public API, admin API, file uploads, email/SMS templates, background jobs, and the two web apps.
**Method:**
- a code sweep for risky patterns: raw SQL, raw HTML, child processes, redirects, file paths, eval;
- a manual review of each route's validation;
- the automated attack tests in `apps/api/test/input-security.test.ts`, using OWASP payloads;
- every raw SQL statement executed on a real PostgreSQL.

**Date:** September 2026.

## Result

No SQL injection or stored-XSS path was found. Seven weaknesses were found and **fixed**; three risks are **accepted** and documented below.

| # | Area | Finding | Severity | Status |
|---|------|---------|----------|--------|
| F1 | Admin API / CORS | The public site's origin was allowed to call the admin API with credentials. The public site and the admin are the same *site*, so an XSS on the public site could have acted as a signed-in admin. | High | **Fixed:** the admin API only accepts the admin app's origin (CORS + Origin/Sec-Fetch-Site check); cookies are `__Host-`-prefixed and SameSite=Strict. Tests: `security.test.ts` › network protections. |
| F2 | Admin sign-in | The post-sign-in redirect accepted `/\evil.com`, which browsers treat as `//evil.com` (open redirect usable for phishing). | Medium | **Fixed:** `apps/admin/lib/safeNext.ts`, tested against known bypasses. |
| F3 | Email templates | Visitor values were escaped, but the template text itself went into the HTML unescaped. Subjects could carry line breaks. | Low (staff-controlled) | **Fixed:** `renderEmail.ts` escapes both and strips line breaks from subjects; unit-tested. |
| F4 | Video processing | ffmpeg was run without a protocol restriction. A crafted file could, on some builds, make it fetch URLs or read other files (SSRF). The installed ffmpeg 6.1 already blocked the test file. | Low (defence in depth) | **Fixed:** `-protocol_whitelist file`, verified against a crafted playlist. |
| F5 | All endpoints | A NUL byte (`%00`) in a URL or field caused a PostgreSQL error, returned as HTTP 500. | Low | **Fixed:** `rejectNullBytes` middleware returns 400; upload file names are cleaned. |
| F6 | All endpoints | Malformed JSON and other framework client errors were returned as HTTP 500. | Low | **Fixed:** the error handler returns the framework's 4xx status with a generic message. |
| F7 | Tokens | The 2FA challenge token couldn't be used as a session token, but only because it lacked one claim. | Informational | **Fixed:** tokens with an audience are rejected explicitly. |
| A1 | Analytics | Anyone can inflate a listing's view count by reloading it; known crawlers and link previews are excluded. | Low | **Accepted:** it affects statistics only. Revisit if the numbers are used for billing. |
| A2 | Admin sign-in | After 5 failures the lock message reveals that an email belongs to a staff account. | Low | **Accepted:** a clear message helps staff; enumeration is limited by the rate limits, and staff emails aren't secret. |
| A3 | Content Security Policy | Inline scripts are allowed (Next.js bootstrap and the theme script). Scripts from other origins are blocked. | Low | **Accepted for now:** a nonce-based CSP is the next step (see "Follow-ups"). |

## What was checked and passed

| Check | Evidence |
|---|---|
| **SQL injection** | All 18 raw SQL statements use Prisma tagged templates (parameterised). Each was executed on PostgreSQL 16 with realistic parameters. The only `…Unsafe` call is the test-database reset (a constant string). OWASP payloads in search and filters return normal results, no errors and no delays (`pg_sleep` never runs). |
| **Operator / parameter tampering** | Every query string and body goes through a Zod schema. Objects and arrays where text is expected (`?minPrice[gt]=0`, `{"email":{"$ne":null}}`) are rejected with 400. |
| **Mass assignment** | Zod strips unknown fields. Sending `status`, `viewCount`, `createdById` or `expiresAt` to the create-listing endpoint has no effect (tested). |
| **Stored XSS** | Visitor text is stored as-is and rendered by React, which escapes it. `dangerouslySetInnerHTML` appears once, with a constant string. The map pins build HTML only from numbers and dictionary text, and titles use `textContent`. |
| **Response sniffing** | API responses are `application/json` with `X-Content-Type-Options: nosniff` (Helmet). |
| **Prototype pollution** | `__proto__` / `constructor` keys in JSON bodies have no effect (tested). |
| **Path traversal** | Storage keys match `^[a-zA-Z0-9/_.-]+$` with no `..`, and deletes check the resolved path stays inside the upload folder. IDs are looked up in the database, never used as paths. |
| **File uploads** | Types are detected from magic bytes, never from the name or MIME type. Size limits: images 15 MB, videos 95 MB. Sharp has a 60-megapixel limit (decompression bombs). Files stream to temporary storage and are deleted after processing. EXIF/GPS data is removed. |
| **CSV / Excel injection** | Cells starting with `= + - @` tab or CR are neutralised (unit-tested). |
| **Header injection** | `Content-Disposition` filenames are built only from enums and ISO dates. Email subjects are stripped of line breaks. |
| **SSRF** | The server fetches only fixed URLs (SendGrid, Twilio, R2). ffmpeg is restricted to local files. |
| **Open redirect** | The admin sign-in redirect accepts only same-site paths. The public site builds links from its own data. |
| **Denial of service by input** | JSON bodies are capped at 200 KB, fields have maximum lengths, and pages at 48–100 rows. Nginx and Cloudflare limits are in place (Week 11). |
| **Secrets in responses** | Password hashes, TOTP secrets and provider keys are never selected into responses (explicit `select`). Provider keys are masked to their last 4 characters. |
| **Error leakage** | Unexpected errors return a generic message. Stack traces and SQL appear only in server logs (tested). |

## Follow-ups (not blocking)
1. **Nonce-based CSP:** needs a real browser test pass. Next.js supports it through middleware.
2. **One view per visitor per day** for analytics accuracy (A1).
3. **Repeat this audit** whenever a new public input is added. The attack tests run on every CI build.
