# Go-live runbook

The week around launch, hour by hour on the day. Prerequisite: `LAUNCH-CHECKLIST.md` complete. Launch on a
**Sunday–Tuesday morning** (Egyptian working week), never before the weekend.

## T-7 days

- Code freeze: only fixes from UAT go in. Tag the release candidate: note its release id here: `____________`.
- Deploy it to staging; UAT round 2 with staff (`UAT-PLAN.md`).
- Load test on staging with the release candidate (`PROFILE=1k`); save the k6 summary.
- Confirm the launch date with the owner, marketing and the sales team; book the people for launch day.
- Lower Cloudflare DNS TTL is not needed (records are proxied); check the certificates expire > 60 days from launch.

## T-1 day

- Deploy the final release to production (site still unannounced; `robots.txt` open is fine).
- Backup taken and **restore-tested** the same day (`scripts/ops/restore-drill.sh`).
- Walk the go / no-go list (`LAUNCH-CHECKLIST.md` › G). Record the decision and who made it.
- Staff: every account can sign in; everyone knows who answers inquiries tomorrow.
- Prepare the announcement posts (`MARKETING-KIT.md`) scheduled for the agreed time, not earlier.
- Tech on call tomorrow 09:00–21:00, phone charged, laptop with VPN/SSH working.

## T-0 (launch day)

| Time | Who | What |
|---|---|---|
| 09:00 | Tech | Grafana › Overview: all targets up, no alerts. `docker compose ps` healthy on every server. |
| 09:15 | Tech | Smoke test on production: home, search, listing, map, English, dark mode, phone; one real test inquiry (then mark it Spam). |
| 09:30 | Owner | Go. Publish the announcement (social, WhatsApp broadcast, Google Business Profile). |
| 09:30–12:00 | Tech | Watch every 15 min: request rate, 5xx rate (< 0.5%), p95 latency (< 500 ms API), CPU, database connections. |
| 09:30–… | Staff | Answer inquiries within 1 hour today. Report anything odd in the launch chat. |
| 12:00 | Tech + Owner | Short check: traffic, inquiries, errors, feedback. Decide fixes: urgent (today, hotfix) vs later. |
| 16:00 | Tech | Second check; confirm tonight's backup is scheduled; nothing deployed after 16:00 unless urgent. |
| 21:00 | Tech | Handover note: numbers, open issues, who is on call overnight (alerts go to their phone). |

**Stop rules.** Roll back (`docs/operations/DEPLOYMENT-RUNBOOK.md` › Rollback) if, after a launch-day deploy,
errors > 2% for 5 minutes or the site is down. If the site is overwhelmed: Cloudflare › Security › "Under
attack" mode for bots; for real traffic, follow `PERFORMANCE.md` › capacity steps (cache HTML at the edge for 60 s).
Any sign of a breach: `docs/security/INCIDENT-RESPONSE.md`.

## T+1 to T+7

- Daily 10:00: Grafana review (errors, latency, top slow queries in `pg_stat_statements`), inquiries answered, alerts
  seen. Log numbers in the table below.
- T+2: Search Console — sitemap processed, pages discovered, no coverage errors.
- T+3: first real backup restore drill after launch.
- T+7: post-launch review (below). Unfreeze normal releases.

| Day | Visits | Inquiries | Submissions | 5xx % | p95 API | Alerts | Notes |
|---|---|---|---|---|---|---|---|
| T-0 | | | | | | | |
| T+1 | | | | | | | |
| T+2 | | | | | | | |
| T+3 | | | | | | | |
| T+7 | | | | | | | |

## Post-launch review (T+7, one hour, owner + tech + sales lead)

Blameless: about the system, not people.

1. **Numbers:** traffic, inquiries, conversion (inquiries per 100 views), time to first response, uptime, errors, alerts.
2. **What went well** (keep doing).
3. **What went wrong or was close** — for each: what happened, impact, why, what change prevents it, owner, date.
4. **Customer and staff feedback** — top 5 requests, sorted by value/effort.
5. **Decisions:** what goes into the next release; whether to raise server sizes (`PERFORMANCE.md` › when to scale).
6. Write it up in `docs/launch/POST-LAUNCH-REVIEW-<date>.md` and add lasting decisions to `docs/DECISIONS.md`.
