# support@ and other addresses on brookrege.com

Customers and partners write to **support@brookrege.com** (on the website footer, privacy page and
announcements). It costs nothing: Cloudflare Email Routing forwards it to real mailboxes; SendGrid sends the
site's own emails. Nobody needs a new mailbox.

## Addresses

| Address | Forwards to | Used for |
|---|---|---|
| support@brookrege.com | owner + sales lead | customers, privacy requests, general questions |
| privacy@brookrege.com | owner | named in the privacy notice for data requests |
| security@brookrege.com | owner + technical contact | vulnerability reports (`SECURITY.md`) |
| alerts@brookrege.com | technical contact | sender of monitoring emails (Alertmanager) |
| no-reply@brookrege.com | — (not received) | sender of the site's automatic emails (SendGrid) |

## Set up (15 minutes, once)

1. Cloudflare › brookrege.com › **Email › Email Routing** › Get started. Cloudflare adds its MX and SPF records;
   accept them. (If the domain already receives mail elsewhere, stop — ask the technical contact.)
2. **Destination addresses:** add each real mailbox (owner's Gmail, etc.); each person clicks the verification email.
3. **Routing rules:** create the custom addresses above → destinations. Leave **Catch-all** *off* (it attracts spam).
4. **SPF with SendGrid:** there must be **one** SPF record. Edit Cloudflare's TXT record so it reads
   `v=spf1 include:_spf.mx.cloudflare.net include:sendgrid.net ~all`.
5. **SendGrid domain authentication** (Settings › Sender Authentication › Authenticate your domain): add the three
   CNAME records it shows in Cloudflare with the proxy **off** (grey cloud). Then set Admin › Notifications ›
   Email › From address to `no-reply@brookrege.com`, and "reply-to" behaviour stays: customers reply to the
   staff member who calls them.
6. **DMARC:** TXT record `_dmarc` = `v=DMARC1; p=quarantine; rua=mailto:support@brookrege.com; adkim=r; aspf=r`
   (start with `p=none` for two weeks if unsure, then `quarantine`).
7. Test: send a mail from a phone to support@ — it arrives in the destination mailboxes. Send a test from
   Admin › Notifications › Send test — it arrives, and in Gmail "Show original" shows SPF, DKIM, DMARC = PASS.

## Replying

Cloudflare only forwards. Reply from the destination mailbox; to reply *as* support@, use Gmail's "Send mail as"
with SendGrid SMTP (`smtp.sendgrid.net`, user `apikey`, a SendGrid key limited to "Mail Send") — or simply reply
from the staff member's own address. Answer within one working day; privacy requests follow Admin › Privacy
(`docs/training/admin-manual/Brookrege-Admin-Manual.pdf`, chapter 14).

## Support tickets (simple, free)

Brookrege's volume doesn't justify a paid help desk at launch. Customer **property questions** are already tickets:
they arrive as Inquiries in the admin, with statuses, notes and response-time reporting. For **email to support@**:

1. Forward support@ to one shared Gmail/Google Workspace mailbox that the owner and sales lead both open.
2. Labels as statuses: `1-New` (filter: every incoming mail), `2-Waiting on customer`, `3-Done`; one label per
   topic if useful (`Privacy`, `Listing correction`, `Partner`).
3. Rule: answer within one working day; privacy requests within 30 days at the latest and logged in Admin › Privacy.
4. Weekly: the owner checks nothing older than 3 days sits in `1-New`.

When mail exceeds ~30 a day, or more than three people answer it, move to a help desk (Freshdesk and Zoho Desk
both have free tiers) by pointing the support@ route at the help desk's forwarding address — nothing else changes.
