# Infrastructure security (Phase 3 · Week 11)

How the servers and the network in front of them are protected, and the **ordered checklist** to switch it all on.
Everything here is scripted; each script is idempotent (safe to run again).

| Layer | What protects it | Where |
|---|---|---|
| Edge (internet → Cloudflare) | TLS ≥ 1.2, HSTS, WAF custom rules, rate limiting, bot fight mode, DDoS mitigation (always on) | `infra/cloudflare/apply.sh` |
| Cloudflare → origin | TLS 1.3 only, Full (strict) certificate check, Authenticated Origin Pulls | `TLS_PROTOCOLS`, `ORIGIN_PULL`, `infra/nginx/snippets/origin-pull.*.conf` |
| Origin firewall | UFW (host) + `BROOKREGE` chain in `DOCKER-USER` (containers), Cloudflare-only web ports | `infra/provision/30-firewall.sh` |
| nginx | rate & connection limits per visitor, timeouts, size limits, probe blocking, catch-all for unknown hosts | `infra/nginx/templates/default.conf.template` |
| SSH | keys only, `deploy` user only, modern ciphers, fail2ban + recidive | `infra/provision/00-harden.sh` |
| Kernel | SYN cookies, no redirects/source routing, BPF/ptrace/dmesg restrictions | `/etc/sysctl.d/90-brookrege.conf` (from `00-harden.sh`) |
| Application | 2FA, sessions, IP allowlist, origin checks — see `ACCOUNT-SECURITY.md` | API |

## 1. Switch-on checklist (do it in this order)

Each step leaves the site working; stop at any step and it is still safe. Steps marked ⚠ can cut access if done out of order.

1. **Server hardening** (every server, as root): `bash infra/provision/00-harden.sh`.
   Before running it, check that `/root/.ssh/authorized_keys` holds your key — afterwards only `deploy` can log in, with a key.
   Keep your current SSH session open and test a *new* login as `deploy` before closing it.
2. **Firewall** (every server): `bash infra/provision/30-firewall.sh setup --role single` (Phase 1) or `--role vps1|vps2|vps3` (cluster).
   Optional: `--ssh-from 41.x.x.0/24,…` to allow SSH only from the office / your home ISP range (the script refuses if it would lock *you* out).
3. **Cloudflare DNS**: add the zone, set the `@`, `www` and `admin` records to **Proxied** (orange cloud). SSL/TLS mode must be **Full (strict)** — the origin already has a Let's Encrypt certificate.
4. **Cloudflare settings**: `CF_API_TOKEN=… CF_ZONE_ID=… PUBLIC_DOMAIN=… ADMIN_DOMAIN=… bash infra/cloudflare/apply.sh --plan free` (see `--dry-run` to preview).
5. **Real visitor IPs**: on the web server, `sudo bash infra/cloudflare/sync-ips.sh --install` (writes `/etc/brookrege/cloudflare`, installs a weekly timer, reloads nginx after `nginx -t`).
   Without this, nginx would see every visitor as a Cloudflare address and the per-visitor limits would throttle everyone together.
6. **TLS 1.3 to the origin**: set `TLS_PROTOCOLS=TLSv1.3` in the env file, `docker compose up -d nginx`. (Cloudflare speaks TLS 1.3 to origins; only Cloudflare connects once step 8 is done.)
7. ⚠ **Authenticated Origin Pulls** — Cloudflare first, then the server:
   `bash infra/cloudflare/apply.sh --plan free --origin-pull`, wait a minute, then `ORIGIN_PULL=on` in the env file and `docker compose up -d nginx`.
   Reversed, the server would demand a certificate Cloudflare isn't sending yet → every visitor gets an error.
   Note: this uses Cloudflare's *shared* origin-pull certificate, which proves "the request came through Cloudflare", not "through *our* Cloudflare account". Step 8 closes the rest of the gap for our threat model; a per-zone certificate is available if ever needed.
8. ⚠ **Cloudflare-only firewall** (web server): `bash infra/provision/30-firewall.sh setup --role single --cloudflare-only` (or `vps1`). Direct connections to the server's IP on 80/443 are dropped; only Cloudflare's ranges get through.
   Let's Encrypt renewals keep working: the HTTP-01 challenge reaches the server *through* Cloudflare.
9. **Verify from outside** (your laptop):
   ```bash
   PUBLIC_DOMAIN=brookrege.com ADMIN_DOMAIN=admin.brookrege.com ORIGIN_IP=<vps1 ip> SERVER_IPS="<all ips>" \
     bash scripts/security/verify-infra.sh --expect-tls13-only --expect-cloudflare-only --rate-limits --server deploy@<vps1 ip>
   ```
   It checks TLS versions, certificates, redirects, security headers, hidden paths, the admin API origin check, 413s, going around Cloudflare, an open-port scan, SSH password refusal, 429s, and on-server settings. Exit code 0 = no failures.

**Undo** (emergencies): `sudo brookrege-firewall remove` (Docker rules), `ORIGIN_PULL=off` + `docker compose up -d nginx`, Cloudflare DNS back to "DNS only".

## 2. Cloudflare (Free plan, with the Pro upgrade path)

What `apply.sh` configures, and why:

- **TLS**: Full (strict); minimum TLS 1.2 at the edge (TLS 1.0/1.1 refused); TLS 1.3 on; Always Use HTTPS; 0-RTT **off** (early data can be replayed); HSTS 2 years + subdomains + preload.
- **WAF custom rules** (Free allows 5; we use 4, one left for incidents):
  1. block scanner probes (`/.env`, `/.git`, `wp-login`, `phpmyadmin`, `*.php` …) — we run none of these;
  2. block `/api/admin` on the public hostname (nginx also returns 404 there — defense in depth);
  3. block HTTP methods we don't use (TRACE, CONNECT, WebDAV …);
  4. **managed challenge** for the admin hostname from outside Egypt — staff abroad still get in after the challenge.
- **Rate limiting** (Free: one rule, 10-second window): sign-in, 2FA, inquiry and submission endpoints, 5 requests / 10 s per IP → blocked for 10 s. On Pro: 10 / minute, blocked 10 minutes. nginx and the API have their own, stricter limits behind it (below).
- **Managed WAF**: Free includes the *Cloudflare Free Managed Ruleset* automatically (high-impact CVEs). The full *Cloudflare Managed Ruleset* and *OWASP Core Ruleset* need Pro; `--plan pro` deploys both.
- **Bot Fight Mode** on. If an uptime monitor or partner integration gets challenged, allow its IP with the spare custom rule rather than turning this off.
- **DDoS**: Cloudflare's network-layer and HTTP DDoS protection is always on for proxied records, on every plan — nothing to configure. The firewall step (§1.8) is what stops attackers from simply hitting the origin IP instead.

**Recommended (free, not scripted): Cloudflare Access (Zero Trust) in front of `admin.`** — staff sign in with a one-time email code before the admin app even loads. It adds a second, independent gate to the app's own password + 2FA. Set it up in the Zero Trust dashboard: Access › Applications › Self-hosted › `admin.brookrege.com`, policy "Emails ending in @your-company" or a list of staff emails. Keep `/api/health` public if an uptime monitor checks the admin host.

**Keep the origin IP secret**: never put the VPS IP in DNS records that aren't proxied (e.g. a `mail` A-record on the same server), in emails' headers, or in public repos. If it ever leaks, step 8 still keeps attackers out.

## 3. nginx (origin)

| Zone | Applies to | Rate per visitor (burst) |
|---|---|---|
| `pages` | public & admin pages | 10/s (40) |
| `api` | public API | 20/s (40) |
| `search` | `/api/properties`, `/map`, `/summary` (database-heavy) | 5/s (20) |
| `leads` | `POST /api/inquiries`, `/api/submissions` | 5/min (5) |
| `auth` | `/api/admin/auth/*` | 10/min (5) |
| `admin` | admin API | 30/s (60) |

Also: 50 simultaneous connections per visitor on the public site (30 on admin); request bodies 1 MB public / 300 MB admin (uploads); header 10 s and body 30 s timeouts against slow-loris; `server_tokens off`; hostnames we don't serve (or the bare IP) get **no response at all** (`444` on HTTP, TLS handshake refused on HTTPS); `X-Forwarded-For` is overwritten with the real client address so the API can't be fooled by a forged header. All nginx configs are checked offline by `scripts/check-nginx.py` (and by `nginx -t` in CI).

The API adds its own limits (sign-in attempts per IP, account lockout after 5 failures) — see `ACCOUNT-SECURITY.md`.

## 4. Firewall — and the Docker trap

**Docker bypasses UFW.** A container port published as `80:80` or `10.0.0.2:4000:4000` is forwarded by Docker's own iptables rules *before* UFW's rules run, so `ufw deny 4000` does nothing for it. This is documented Docker behaviour and a very common real-world exposure.

`30-firewall.sh` fixes it the supported way: a `BROOKREGE` chain hooked first into Docker's `DOCKER-USER` chain.

| Role | Public interface → containers | Private network (wg0) → containers |
|---|---|---|
| single | 80, 443 (Cloudflare only with `--cloudflare-only`) | — |
| vps1 | 80, 443 (Cloudflare only with `--cloudflare-only`) | from 10.0.0.2/10.0.0.3 → 5432, 6432 |
| vps2 | nothing | from 10.0.0.1 → 3000, 3001, 4000, 5432 |
| vps3 | nothing | from 10.0.0.1 → 3000, 3001, 4000 |

Everything else trying to open a new connection to a container is dropped. Rules match the *original* destination port (`conntrack --ctorigdstport`), so they stay correct whatever Docker's internal addresses are. A systemd unit (`brookrege-firewall.service`, `PartOf=docker.service`) re-applies them whenever Docker starts, and `sync-ips.sh` re-applies them when Cloudflare's ranges change.
Host services (SSH, WireGuard UDP 51820, NFS on VPS1) are covered by UFW as before. SSH is rate-limited by UFW (`limit`: 6 connections / 30 s per address) or restricted with `--ssh-from`.

Tested in the build sandbox against a real iptables with a stand-in `DOCKER-USER` chain: rule sets for all four roles, Cloudflare-only (15 IPv4 + 7 IPv6 ranges), idempotency (re-apply gives the same rules and a single hook), SSH self-lockout guard, removal leaving nothing behind.

## 5. SSH

`/etc/ssh/sshd_config.d/00-brookrege.conf` — a drop-in named `00-…` because sshd uses the **first** value it reads and cloud images ship `50-cloud-init.conf` with `PasswordAuthentication yes`. (The Phase 1 script edited `sshd_config` with `sed`, which that file silently overrode — fixed.)
Keys only (`AuthenticationMethods publickey`), no root, `AllowUsers deploy`, 3 tries, 20 s login grace, no X11/agent forwarding, no tunnels, local port-forwarding only (for DB access through SSH), modern key exchange (incl. post-quantum `sntrup761x25519`), AEAD ciphers only. The script runs `sshd -t` and refuses to reload a broken config.

**fail2ban** watches SSH only: 5 failures in 10 minutes → 1 hour ban; banned 5 times in a day → 1 week (`recidive`). Web traffic is deliberately *not* fail2ban'd: behind Cloudflare every visitor arrives from Cloudflare's addresses, so banning at the server would block real customers. Web abuse is stopped at Cloudflare and by nginx/API limits.

## 6. Kernel and Docker daemon

`/etc/sysctl.d/90-brookrege.conf`: SYN cookies and larger SYN backlog (SYN floods), loose reverse-path filtering (strict breaks WireGuard/Docker), no ICMP redirects or source routing, restricted `dmesg`, kernel pointers, unprivileged BPF and `ptrace`. IP forwarding stays on (Docker and WireGuard need it).
Docker daemon: log rotation, `live-restore` (containers survive daemon restarts), `no-new-privileges` (no setuid escalation inside containers), `userland-proxy: false`. Automatic security updates via `unattended-upgrades`.

## 7. What was not possible to test here, and how it is covered

The build environment has no nginx, sshd, fail2ban, Docker daemon or Cloudflare account. Covered instead by: the offline nginx checker plus `nginx -t` in CI (real nginx image); the firewall script run against real iptables; `sync-ips.sh` run end-to-end with local fixtures including malformed/short lists and a bad CA; `apply.sh --dry-run` validating every API body as JSON; and `verify-infra.sh`, which is the acceptance test to run once on the real servers (it was itself smoke-tested against a local HTTPS stand-in).
