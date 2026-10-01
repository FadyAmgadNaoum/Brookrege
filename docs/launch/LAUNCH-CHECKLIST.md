# Launch checklist

Everything that must be true before the site is announced. Tick in order; each line says who does it and where
the instructions are. **Owner** = Fady / the business owner, **Tech** = technical contact, **Staff** = sales and
content team. Items marked 🔒 are the "person needed" steps postponed to the end of the project.

## A. Servers and security (Tech)

- [ ] 🔒 Three VPSs provisioned, hardened, firewalled, WireGuard up — `docs/PHASE2-WEEK5.md`, `infra/provision/`
- [ ] 🔒 Every settings file filled with new random secrets, `chmod 600`; no example values left (`grep -n "generate-\|Choose-\|replace" .env.*` returns nothing)
- [ ] 🔒 Backup key pair made on the owner's computer; private key offline (password manager + printed copy); public key on the server
- [ ] Restore drill passed on a real backup: `scripts/ops/restore-drill.sh` — `docs/security/BACKUPS.md`
- [ ] `scripts/security/verify-infra.sh` passes on each server
- [ ] Cloudflare: proxied DNS, `infra/cloudflare/apply.sh` applied, origin certificate / Let's Encrypt valid, TLS 1.3 to origin, `ORIGIN_PULL=on`
- [ ] Monitoring up (`docs/operations/MONITORING.md`); a test alert reached email **and** the phone; heartbeat (healthchecks.io) configured
- [ ] 🔒 External penetration test done and findings fixed — `docs/security/SECURITY-TESTING.md`
- [ ] Deploy pipeline set up and one staging deploy + one rollback practised — `docs/operations/DEPLOYMENT-RUNBOOK.md`

## B. Performance (Tech)

- [ ] Load test on staging (or production before announcement): `PROFILE=1k` passes; `5k`/`10k` from several machines — `docs/operations/PERFORMANCE.md`
- [ ] PageSpeed Insights (mobile) on `/ar`, `/ar/properties`, one listing: LCP < 2.5 s, CLS < 0.1, INP < 200 ms
- [ ] Grafana baseline noted (p95 latency, CPU at idle) to compare with launch day

## C. Content (Staff, Owner)

- [ ] 🔒 Final list of regions and compounds entered (Admin › Regions, compounds & projects)
- [ ] At least 30 real listings live, each with 5+ good photos, Arabic title and description, correct price, coordinates
- [ ] Projects page: partnership and completed projects with photos
- [ ] 🔒 Real contact details: WhatsApp number in the release variables, `support@` routing — `docs/operations/SUPPORT-EMAIL.md`
- [ ] 🔒 Privacy policy reviewed by a lawyer (Egypt PDPL); company details added — `docs/security/PRIVACY.md`
- [ ] Demo data absent in production (no "Demo" listings; `SEED_DEMO` not set)

## D. Email, SMS, leads (Owner, Tech)

- [ ] SendGrid domain authenticated; SPF/DKIM/DMARC pass; test email from Admin › Notifications arrives (not in spam)
- [ ] 🔒 Twilio sender ID registered for Egypt; test SMS arrives on Vodafone, Orange, Etisalat, WE numbers
- [ ] Staff recipients for new inquiries set; a test inquiry on the live site reaches them within a minute
- [ ] Weekly report scheduled to the owner

## E. Search engines (Tech, Owner)

- [ ] `https://brookrege.com/robots.txt` allows crawling and lists the sitemap; `…/sitemap.xml` lists listings in both languages
- [ ] Google Search Console: add the domain property (DNS TXT record in Cloudflare), submit `sitemap.xml`
- [ ] Bing Webmaster Tools: import from Search Console
- [ ] Google Business Profile for the office (address, hours, phone, website) — text in `MARKETING-KIT.md`
- [ ] Link preview checked: paste a listing URL into WhatsApp — photo, title and price appear
- [ ] Staging is **not** indexed: `https://staging.brookrege.com` asks for a password

## F. People (Owner)

- [ ] 🔒 Staff trained (`docs/training/TRAINING-PLAN.md`), each signed in once and chose their own password
- [ ] 🔒 Security training done and attendance signed — `docs/security/STAFF-TRAINING.md`
- [ ] 🔒 UAT signed off — `UAT-PLAN.md`
- [ ] Who answers inquiries on launch day, and until when, is decided
- [ ] Incident contacts filled in `docs/security/INCIDENT-RESPONSE.md`

## G. Go / no-go (Owner + Tech, T-1 day)

All of A–F ticked, or each open item has a written reason and a date. Then follow `GO-LIVE-RUNBOOK.md`.
