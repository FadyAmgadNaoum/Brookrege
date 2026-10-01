# Admin account security (Phase 3 · Week 9)

## What staff experience

| Situation | What happens |
|---|---|
| **Signing in** | Email and password. There is no two-step verification (removed at the owner's request, DECISIONS row 79). |
| **First sign-in of a new team member** | They must replace the temporary password before anything else. |
| **Forgotten password** | A super admin sets a new temporary password in *Team*. The only super admin: see "Locked out of the admin" below. |
| **5 wrong passwords in a row** | The account locks for 15 minutes, then 30, 60 … up to 24 hours. The person gets an email. A super admin can unlock it. |
| **60 minutes without activity** | Signed out. A warning appears 5 minutes before, with a "Stay signed in" button. Every session also ends after 12 hours regardless. |
| **Password changed / role changed / suspended** | Other browsers are signed out at once, not after the token expires. |
| **Security-relevant change to your account** | An email notice ("Your password was changed…") so a takeover can't happen silently. |

## Rules

**Passwords**
- At least 12 characters, with upper and lower case, a number and a symbol.
- Not a common word or the company name, no sequences like `12345` or `qwert`, and not the person's own name or email.
- The policy (`packages/domain/src/security.ts`) is shared, so the form and the server enforce exactly the same rules.
- Hashing is bcrypt cost 12, with lower-cost hashes upgraded at next sign-in. The architecture asked for cost 10; 12 is deliberately stronger (≈250 ms per check).

**Sessions**
- Every sign-in creates a server-side session that is checked on every request. Revocation is instant, and the role is always read from the database.
- Idle limit `SESSION_IDLE_MINUTES` (60), absolute limit `SESSION_MAX_HOURS` (12).
- Access tokens last 15 minutes; refresh tokens rotate, and reuse of an old one ends the session.

**Brute force**
- Account lockout is stored in the database, so it works across both app servers.
- Plus a per-address limit (`SIGNIN_RATE_LIMIT`, 10 per 15 min per server), the Nginx `auth` zone, and the Cloudflare rules (Week 11).

**Cookies**
- `__Host-` / `__Secure-` prefixed, HttpOnly, Secure, SameSite=Strict.
- They're only sent to the admin host: the public site (a sibling subdomain) never receives them.

**Origin check**
- The admin API only accepts browser requests from the admin app's own origin (`ADMIN_APP_URL`).

**Activity log**
- Append-only at the database level (trigger), so even a stolen admin account can't erase its tracks.
- Security events can be filtered in *Activity log* and appear on the *Security* page.

## IP allowlist (optional)
*Security › Allowed networks.* When on, the admin API only answers listed addresses or ranges (IPv4/IPv6, CIDR).
- **You can't lock yourself out:** saving is refused unless your current address is in the list.
- **Most Egyptian home and mobile connections change address.** Use this only with an office line that has a fixed IP. For people who move around, Cloudflare Access (Week 11) is the better tool.
- **Emergency:** everyone locked out (for example, the office IP changed). Set `ADMIN_IP_ALLOWLIST_BYPASS=true` in the server's env file and restart the API, fix the list, then remove the setting. The Security page shows a warning while the bypass is on.

## Security page (super admins)
- Overview:
  - active staff accounts and who is signed in now;
  - failed sign-ins (24 h / 7 days);
  - locked accounts;
  - the sign-in rules (timeouts, lockout);
  - server configuration checks (encryption key, secure cookies, HTTPS, timeouts, bypass).
- Staff accounts: unlock, sign out everywhere.
- Signed in now: every active session (browser, address, last activity), with *End session*.
- Allowed networks: the IP allowlist.
- Recent events: the last 50 security events.

## Upgrading from Phase 2
All existing sessions end when the migration runs (they have no server-side session record), so everyone signs in once.
- The server needs `SETTINGS_ENCRYPTION_KEY` (it encrypts the email/SMS provider keys). Production refuses to start without it.

## Locked out of the admin (last resort)

When the only super admin forgot the password and nobody else can reset it from Admin › Team: on the server, in
the project folder, run `bash scripts/ops/reset-admin-access.sh owner@brookrege.com`.
It prints a temporary password, unlocks the account, signs out its browsers, forces a new password at the next
sign-in, and writes `security.reset_access_from_server` to the activity log.
