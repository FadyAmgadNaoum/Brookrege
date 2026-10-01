# Personal data & privacy (Phase 3 · Week 12)

> Not legal advice. This describes what the system does. **Timing matters:** the executive regulations of Egypt's
> Personal Data Protection Law (Law 151/2020) were issued by Prime Ministerial Decree 816 on 1 November 2025 with a
> one-year transition, so enforcement is expected from about **October–November 2026**. Before launch, have an Egyptian
> lawyer confirm: (1) whether Brookrege needs a **licence/permit** from the Personal Data Protection Center as a
> controller; (2) whether using providers outside Egypt (Cloudflare, R2 storage, the SMS/email providers) counts as a
> **cross-border transfer** needing a permit; (3) whether a **data protection officer** must be appointed; and (4) the
> wording of the public privacy page.

## What personal data Brookrege holds

| Data | Where | From whom | Why | Kept |
|---|---|---|---|---|
| Name, mobile, optional email and message | `Inquiry` | Visitors asking about a listing | Call them back | Until 24 months after the last update, then anonymized |
| Name, mobile, property type, area, details | `PropertySubmission` | Owners asking to list | Call them back, arrange the listing | Same |
| Recipient phone/email, template, status | `NotificationLog` | Our SMS/email sending | Delivery troubleshooting | 12 months, then deleted |
| Message contents incl. contact details | `Job` payloads | Queued SMS/emails | Deliver the message | Deleted 30 days after sending/failing |
| Staff name, email, sign-in times, IP, browser | `User`, `AdminSession`, `AuditLog` | Staff | Security, accountability | Sessions deleted 12 months after they expired; audit IP/browser blanked after 12 months (entries kept) |
| IP address, browser, page path (no query string) | nginx access logs: on the server (Docker log rotation, 5 × 20 MB), in Loki (monitoring), and Cloudflare | Everyone | Security, abuse prevention, troubleshooting | Server copy: days (rotated); Loki: 14 days; see `docs/operations/MONITORING.md` |
| Listing view counts | `PropertyViewDaily` | Visitors | Statistics | Not personal (a count per listing per day) |

No accounts for the public, no advertising, no analytics/tracking scripts, no marketing messages.
Cookies: one language cookie (`bk-locale`), the theme choice in `localStorage`, and Cloudflare's own security cookie (`__cf_bm`) when Cloudflare proxies the site. Staff sign-in cookies exist only on the admin domain. None needs a consent banner under a strictly-necessary reading — confirm with the lawyer.

## How the promises on the public page are kept

| Promise (`/ar/privacy`, `/en/privacy`) | Implementation |
|---|---|
| Used only to contact you | No other code path reads lead data except staff screens, notifications about that lead, and reports (counts only). |
| Deleted automatically after 24 months | Job `privacy_retention`, nightly at 04:10 (Cairo), one server at a time (advisory lock). Anonymizes leads whose `updatedAt` is older than the retention period: name/phone → `[removed]`, email, message, staff note → empty, `anonymizedAt` set. Staff notes are also removed from past activity-log entries for those leads (status history stays). |
| Delivery records deleted, IPs erased after 12 months | Same job: `NotificationLog` rows deleted; `AuditLog.ip` and `userAgent` blanked. The activity log is append-only (database trigger); these clean-ups are the only sanctioned changes and use the trigger's maintenance switch inside the same transaction. |
| Access, copy, correction, deletion within 30 days | Admin › **Privacy** (super admins only, `privacy:manage`). Search by phone in any format (`010…`, `+2010…`, `002010…`) or email → see everything → **Download a copy** (JSON) or **Erase** (type `ERASE` to confirm). Correction: edit the lead, or erase and ask them to send it again. |
| Staff access protected | Password policy, account lockout, sessions, IP allowlist — `ACCOUNT-SECURITY.md`. |
| Encrypted in transit, database unreachable, encrypted backups | `INFRASTRUCTURE.md`, `DATA-PROTECTION.md`, `BACKUPS.md`. |

Retention periods are editable in Admin › Privacy › Retention (leads 6–120 months, logs 3–36). **If you change them, update the numbers on the public privacy page** (`apps/web/lib/i18n/ar.ts` and `en.ts`, key `privacy`).

### Erasure — exactly what happens

For the phone/email entered, and every other phone/email found on the matching records:

1. Matching inquiries and property requests are anonymized (as above). The rows stay so counts and conversion reports still add up.
2. `NotificationLog` rows sent to those numbers/addresses are deleted.
3. Queued or failed SMS/emails whose payload contains them are deleted (running ones are left to finish).
4. Staff notes on those leads are removed from past activity-log entries.
5. One `privacy.erase` activity entry is written with **masked** identifiers (`010•••••678`) and counts — proof the request was handled, without re-storing the data.

**Not covered automatically** (tell the person, or handle by hand): copies already in encrypted backups (they age out with backup retention: 14 daily + 12 monthly; restoring a backup must be followed by re-running the erasure — keep a list of erasure requests for this, the activity log has them), messages already delivered to the person's phone/inbox or staff inboxes, and anything staff copied outside the system (WhatsApp chats, notebooks).

### Handling a request (staff procedure)

1. **Verify identity**: call back the number on the records; for email-only records reply to that address. Never send data to a different number/address than the one on file.
2. Search in Admin › Privacy. Act within **30 days** (the public page promises this).
3. Access/copy → download the JSON and send it through the verified channel. Deletion → Erase. Stop contacting → mark the leads `CLOSED` with a note "do not contact", or erase.
4. The activity log records the export/erasure automatically (Activity log › filter "Privacy requests").

## Breach notification

Law 151/2020 and its executive regulations require notifying the Personal Data Protection Center of a personal-data breach within **72 hours**, and the affected people within **three working days after notifying the Center**. The process is in `INCIDENT-RESPONSE.md` §5.

## GDPR

Brookrege targets Egypt and doesn't knowingly monitor or target people in the EU, so GDPR most likely does not apply. The same controls (minimisation, retention, access, erasure, security, breach process) cover GDPR's core requirements anyway if it ever does — e.g. EU-resident expatriates buying in Sohag.

## Tests

`apps/api/test/privacy.test.ts` — permission (super admin only), lookup across phone formats, export (download header, masked audit entry), erasure (confirmation required, all tables, other people untouched, audit trail keeps status but loses the note, nothing left to find), retention (old anonymized/deleted/blanked, recent untouched, second run is a no-op), policy limits. `packages/domain/test/privacy.test.ts` — calendar-month cut-offs, phone variants, masking. The SQL (jsonb key removal, append-only trigger bypass, payload matching) was also run against real PostgreSQL 15 during development.
