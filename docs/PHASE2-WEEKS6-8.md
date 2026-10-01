# Phase 2 · Weeks 6–8 — Media & CDN, Analytics & Reports, Notifications

## Week 6 — Media management & CDN

**How uploads work**
1. Staff drag files onto the listing page or the **Media library**. Up to 20 files per batch, with a live progress bar.
2. Files stream to a temporary folder, not into memory. The file type is checked from its first bytes, never trusted from the file name.
3. **Photos** (JPG, PNG, WebP, up to 15 MB):
   - resized to 480, 960 and 1600 px WebP, never larger than the original;
   - rotated upright using the phone's orientation data;
   - **camera data (EXIF), including GPS location, is removed**.
   Three files are processed at a time.
4. **Videos** (MP4, MOV, WebM, up to 95 MB, because Cloudflare caps request bodies at 100 MB on its Free and Pro plans):
   - stored straight away;
   - a background job reads the length with `ffprobe` and grabs a poster frame with `ffmpeg`.
5. A file that fails doesn't stop the batch; each problem is reported for its own file.
6. The public site serves `srcset`, so phones download the 480 px image instead of 1600 px. A listing card is typically 20–40 KB instead of a 3–5 MB phone photo.

**Storage and CDN.** `STORAGE_DRIVER=local` keeps using the folder (development, single server). `STORAGE_DRIVER=r2` stores files in Cloudflare R2 and serves them from `https://media.brookrege.com` through Cloudflare's CDN. Every file gets a unique name and is never overwritten, so it's sent with `Cache-Control: public, max-age=31536000, immutable`: browsers and the CDN cache it for a year and never re-check.

R2 setup, done once in the Cloudflare dashboard:
1. **R2 › Create bucket** named `brookrege-media` (location hint: Eastern Europe, the closest region to Egypt).
2. **Bucket › Settings › Custom domains › Connect domain** `media.brookrege.com`. This makes the bucket public through the CDN only.
3. **R2 › Manage API tokens › Create token** with *Object Read & Write* on this bucket only. Put the Access Key ID, Secret and Account ID in `.env.cluster`.
4. Optional: add a **Cache Rule** for `media.brookrege.com` with Edge TTL of 1 month (the files are immutable).
5. Set `STORAGE_DRIVER=r2` and redeploy. New uploads go to R2. Photos uploaded in Phase 1 keep working from `/uploads`.

**Media expiration strategy** (`packages/domain/src/media.ts`, runs nightly at 03:30 Cairo):
- Deleted files can be restored for **30 days**, then are removed from storage.
- Uploads never attached to anything are treated as abandoned after **7 days** and moved to Deleted, so they can still be restored for another 30 days.
- Photos of **expired** listings are kept, because the listing can be renewed at any time.

## Week 7 — Analytics & reporting

| Endpoint | What it returns |
|---|---|
| `GET /admin/analytics/dashboard?from=&to=` | 8 KPIs, each compared with the previous period of the same length; daily views and inquiries; results by property type; top listings |
| `GET /admin/analytics/properties` | Every listing's views, inquiries and inquiries per 100 views; median asking price by region and type |
| `GET /admin/analytics/inquiries` | Daily series, counts by status, median time to first response, full list |
| `GET /admin/analytics/users` | **Team** activity: sign-ins, listing changes, lead updates, last active. The public site has no user accounts, so "users" means staff. |
| `POST /admin/reports/generate` | `{report: overview\|properties\|inquiries\|team, format: xlsx\|csv, from, to}` returns a file |
| `GET/POST/DELETE /admin/reports/schedules` | Weekly (Sunday) or monthly (1st) reports emailed as attachments |

**Where the numbers come from**
- **Views** are counted once per property page visit, per day. Crawlers, link previews (such as WhatsApp) and monitors are excluded.
- **First response** is the first time staff move an inquiry out of "New".
- The KPI maths lives in `packages/domain/src/analytics.ts` and is unit-tested. Analytics queries run on the read replica when one exists.

**Exports**
- **Excel** has one sheet per table, with the header row frozen.
- **CSV** opens correctly in Excel with Arabic text, and cells that start with `=`, `+`, `-` or `@` are neutralised so a spreadsheet can't run them as formulas.
- **PDF** uses the analytics page's **Print / save as PDF** button, which produces a clean printable layout. Server-side PDF libraries can't lay out Arabic text correctly (letters come out disconnected and in the wrong order), while the browser renders it properly.

## Week 8 — Email, SMS & background jobs

**Background queue.** Jobs are stored in PostgreSQL, not Redis Pub/Sub. Pub/Sub drops any message published while no worker is listening, so a restart would silently lose emails. The PostgreSQL queue works like this:
- Each worker claims jobs with `FOR UPDATE SKIP LOCKED`, so two workers (VPS2 and VPS3) never take the same job.
- Failed jobs are retried with exponential backoff: 30 s, 1 min, 2 min, and so on, capped at 1 hour, 5 attempts by default.
- Errors that retrying can't fix (bad API key, invalid number) fail immediately.
- Jobs stuck because a worker crashed are re-queued after 15 minutes.
- Finished jobs are deleted after 30 days.
- **Admin › Notifications › Background jobs** shows the queue and lets staff retry failed jobs.

**What's sent automatically**

| Event | Email (staff) | SMS (customer, optional) |
|---|---|---|
| Inquiry on a listing | `inquiry_staff` | `inquiry_customer_ack`, in the visitor's language |
| "Add your property" | `submission_staff` | `submission_owner_ack` |
| New team member | `team_welcome` (no password is ever emailed) | — |
| Weekly, Sunday 09:00 | `expiring_digest`: listings expiring within 14 days | — |
| Report schedule | `scheduled_report` with the file attached | — |

All messages can be edited in **Admin › Notifications › Messages**, in Arabic and English, with a live preview and an SMS length counter. Arabic SMS allows 70 characters per segment instead of 160.

**Provider setup**
- **SendGrid:** first verify the domain (*Settings › Sender Authentication*, which adds DKIM and SPF DNS records at Cloudflare) so emails don't land in spam. Then create an API key with *Mail Send* permission only, and paste it in Admin › Notifications › Email.
- **Twilio:** delivery to Egyptian networks needs a **registered alphanumeric sender ID** (for example "Brookrege"). Request it in Twilio before launch. Use a Messaging Service, then enter the Account SID, Auth Token and Messaging Service SID in Admin › Notifications › SMS.
- **Stored keys** are encrypted in the database (AES-256-GCM) with `SETTINGS_ENCRYPTION_KEY` and never sent back to the browser; only the last 4 characters are shown. Back that key up: if it's lost, the provider keys must be re-entered.
- **Until providers are configured**, choose "write to server log": messages are logged instead of sent, so everything can be tested safely.

**Where jobs run**
- **Single server:** inside the API (`JOBS_WORKER=true`).
- **Three servers:** the dedicated `worker` container on VPS3, with the API servers set to `JOBS_WORKER=false`.
- **Local cluster simulation:** a `worker` service.
