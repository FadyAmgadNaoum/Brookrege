# User acceptance testing (UAT)

The owner and staff check, on **staging**, that the system does what the business needs — before customers see
it. Testers use the site like customers and the admin like on a normal day, and record anything wrong.

- **Where:** https://staging.brookrege.com and https://staging-admin.brookrege.com (password from the tech contact).
- **Who:** owner (O), a content admin (C), a moderator / sales person (M), one outside person on a phone (P).
- **When:** round 1 two weeks before launch; round 2 (re-test fixes) at T-7 days. About 2 hours per person.
- **Devices:** at least one Android phone, one iPhone, one laptop (Chrome), one with the phone in Arabic and one in English.
- **Record problems** in the table at the end: what you did, what you expected, what happened, a screenshot.
  Severity: **Blocker** (can't launch), **Major** (wrong but a workaround exists), **Minor** (cosmetic).

## Scenarios

### Visitors (P, O)

| # | Do this | Expected | ✓ |
|---|---|---|---|
| V1 | Open the site on a phone | Arabic, right-to-left, loads in under 3 s on 4G, readable without zooming | |
| V2 | Search: apartments for sale in one region, price range | Only matching listings; count shown; sort by price works | |
| V3 | Open a listing | Photos, price, area, rooms, location on map, WhatsApp and "call me back" | |
| V4 | Tap WhatsApp | WhatsApp opens with a message naming the listing | |
| V5 | Send "call me back" with name and phone | Confirmation on screen; SMS confirmation (if enabled); appears in the admin within a minute | |
| V6 | Send the same form 10 times quickly | After a few, a polite "already sent" message; no errors | |
| V7 | "Add your property": fill and send | Confirmation; appears in Admin › Property submissions | |
| V8 | Compounds page → one compound | Units and "starting from" prices per type | |
| V9 | Map page | Pins for listings with coordinates; tapping one opens it | |
| V10 | Switch to English | Same pages in English; listings without English text show Arabic | |
| V11 | Dark mode (phone setting or toggle) | Readable, nothing invisible | |
| V12 | Share a listing link in WhatsApp | Preview with photo, title and price | |
| V13 | Privacy page | Readable in both languages, contact address correct | |

### Staff (C, M, O)

| # | Do this | Expected | ✓ |
|---|---|---|---|
| S1 | First sign-in with the temporary password | Forced to choose a new password; rules explained | |
| S2 | Owner: turn on 2FA, sign out, sign in with the code, then with a backup code | Works; the used backup code doesn't work again | |
| S3 | Five wrong passwords | Account locked with a clear message; owner unlocks it | |
| S4 | C: add a listing with 10 photos and a video, publish | Photos processed in seconds, video poster within minutes; live on the site within a minute | |
| S5 | C: try Rent + Villa; Sale without seller type; a PDF as a photo | Each refused with a clear reason | |
| S6 | C: change the cover photo; remove a photo | Site shows the new cover | |
| S7 | M: renew a listing, take one offline, mark one sold | Status and expiry dates update; offline/sold listings leave the site | |
| S8 | M: try to edit a listing's price | Not possible for a moderator | |
| S9 | M: work through inquiries: status, note | Saved; visible to colleagues | |
| S10 | C: add a region, a compound, a project | Appear on the site | |
| S11 | O: Analytics for last 30 days; export Excel; print to PDF | Numbers match what you did; files open | |
| S12 | O: schedule a weekly report to yourself | Email arrives (staging: check the delivery log) | |
| S13 | O: add a team member, then suspend them | They're signed out at once and can't sign in | |
| S14 | O: Privacy › find the test phone from V5, download, erase | Copy downloads; after erasing, the inquiry shows no name/phone | |
| S15 | O: Activity log | Every change above is listed with who and when | |
| S16 | Anyone: leave the admin open 60+ minutes | Asked to sign in again | |

## Problems found

| # | Scenario | Severity | What happened | Tester | Fixed in release | Re-tested ✓ |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

## Sign-off

UAT passes when every scenario is ✓ and no Blocker or Major problem is open (Minor ones have a date).

| Role | Name | Decision (accept / not yet) | Date | Signature |
|---|---|---|---|---|
| Owner | | | | |
| Sales lead | | | | |
| Technical contact | | | | |
