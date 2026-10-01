# Alert runbooks

Every alert email ends with "What to do: docs/operations/RUNBOOKS.md#…" — that link lands on one of the sections below.
Each section says what the alert means, how to check, and how to fix. Commands assume you are on the server named
in the alert, in `/opt/brookrege`, as the `deploy` user. For anything that looks like an attack or a data leak, switch
to `docs/security/INCIDENT-RESPONSE.md`.

Handy commands:

```bash
docker compose ps                                    # which containers run, and their health
docker compose logs --since 30m api                  # recent logs of one service
curl -s http://127.0.0.1:4000/health | jq            # API readiness (single server; cluster: 10.0.0.2 / 10.0.0.3)
ssh -L 3000:127.0.0.1:3000 deploy@<vps1>             # then open http://127.0.0.1:3000 for Grafana
```

---

## SiteDown
**Meaning:** a public page (`/ar`, `/en`, `/api/health`) or the admin sign-in page failed the check from the monitoring server for 2 minutes.
**Check:** open the site from your phone on mobile data. Grafana › Overview. Is it one URL or all? Is Cloudflare showing its own error page (5xx with a Cloudflare logo = origin unreachable)?
**Fix:**
1. All URLs down + Cloudflare error page → VPS1/nginx: `docker compose ps nginx`, `docker compose logs --tail 100 nginx`, `docker compose restart nginx`.
2. Only `/api/health` down → see [AllApiServersDown](#allapiserversdown) and [PostgresDown](#postgresdown).
3. Only the website pages → `web` containers: `docker compose logs --tail 100 web`, restart them.
4. TLS error → [CertificateExpiresSoon](#certificateexpiressoon).
5. Nothing wrong from outside but the alert continues → the monitoring server can't reach Cloudflare (DNS/outbound network on VPS1).

## SiteSlow
**Meaning:** a page takes more than 3 s for 10 minutes, measured from VPS1 through Cloudflare.
**Check:** Grafana › Application (p95, slowest routes) and › Servers (CPU, memory). Is traffic unusually high (Overview › Requests)?
**Fix:** high traffic → it's working as designed if errors stay low; check the cache hit ratio (Background jobs & cache). One slow route → [HighLatency](#highlatency). A server short of CPU/memory → [HighCPU](#highcpu) / [MemoryLow](#memorylow).

## CertificateExpiresSoon
**Meaning:** the certificate a visitor sees expires within 14 days. Behind Cloudflare this is Cloudflare's edge certificate (renewed by Cloudflare), so this alert usually means the origin certificate is also due.
**Check:** `sudo certbot certificates` on VPS1; `docker compose logs certbot` if you run the renewal container; the weekly renewal cron (`docs/DEPLOYMENT.md` §3).
**Fix:** `sudo certbot renew` then `docker compose exec nginx nginx -s reload`. If renewal fails with a challenge error, check Cloudflare doesn't block `/.well-known/acme-challenge/` (a WAF rule or "Under Attack" mode).

## TargetDown
**Meaning:** Prometheus can't collect metrics from a service for 3 minutes. Either the service is down, or the private network/firewall between VPS1 and that server is broken.
**Check:** the `job` and `server` in the alert. `docker compose ps` on that server. From VPS1: `curl -s http://10.0.0.X:PORT/metrics | head` (ports: api 9464, worker 9465, node 9100, cAdvisor 9338, postgres 9187, redis 9121, nginx 9113). `ping 10.0.0.X` tests WireGuard.
**Fix:** restart the service (`docker compose up -d <service>` or, for agents, `cd infra/monitoring/agents && docker compose up -d`). WireGuard down → `sudo systemctl restart wg-quick@wg0`. Firewall changed → re-run `sudo brookrege-firewall apply`.

## AllApiServersDown
**Meaning:** no API server is answering — the site can show pages from cache, but searches, inquiries and the admin fail.
**Check:** on VPS2 and VPS3: `docker compose ps api`, `docker compose logs --tail 200 api`. Common causes: database unreachable (see [PostgresDown](#postgresdown)), a bad deploy (crash at start: look for "Refusing to start" or "Invalid environment configuration" in the logs), disk full.
**Fix:** bad deploy → roll back (`docs/operations/DEPLOYMENT-RUNBOOK.md` › Rollback). Config error → fix the env file, `docker compose up -d api`. Database → fix the database first; the API recovers on its own.

## HighErrorRate
**Meaning:** more than 5% of API requests answered with a server error (5xx) for 5 minutes.
**Check:** Grafana › Application › "Requests per second by status" and the **API errors** log panel (or Loki: `{service=~"api|worker", level="error"}`). Look at the most common error message and route.
**Fix:** database errors → [PostgresDown](#postgresdown) / [HighDatabaseConnections](#highdatabaseconnections). Started right after a deploy → roll back. External provider errors (storage/R2) → check the provider status page; the site degrades but works.

## HighLatency
**Meaning:** the API's 95th-percentile response time is above 500 ms for 10 minutes (the performance target).
**Check:** Grafana › Application › "Slowest routes". Database › "Connections by state" (many `active` = slow queries). Top queries: `docker compose exec postgres psql -U $DB_USER -d $DB_NAME -c "SELECT calls, round(mean_exec_time) ms, left(query, 120) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10"`.
**Fix:** a new slow query → add an index (docs/operations/PERFORMANCE.md › "Finding slow queries"). Cache misses after a deploy → wait 10 minutes. CPU saturated → [HighCPU](#highcpu).

## EventLoopBlocked
**Meaning:** the Node.js process is too busy to answer promptly (event-loop delay > 0.5 s). Usually heavy CPU work: large report exports, image processing in the API process.
**Check:** which `job`: `worker` is expected to be busy during video/report jobs; `api` is not. Application › CPU and Memory panels.
**Fix:** api: restart it (`docker compose restart api`) and look for what started it in the logs (a huge export?). Persistent → move `JOBS_WORKER` off the API (cluster already does this).

## AppMemoryHigh
**Meaning:** an API or worker process has used more than 900 MB for 15 minutes — a memory leak or a very large job.
**Check:** Application › Memory. Does it climb steadily (leak) or jump with a job (spike)?
**Fix:** `docker compose restart <api|worker>` (safe: requests are drained, jobs are retried). Report a steady climb as a bug with the time range.

## AppRestarted
**Meaning:** the API or worker restarted more than twice in 15 minutes — probably crashing on start or on a specific request.
**Check:** `docker compose logs --since 20m <api|worker>` — the last lines before each restart.
**Fix:** after a deploy → roll back. Config problem → fix the env file. Database migration failing → see the migration error and `docs/operations/DEPLOYMENT-RUNBOOK.md`.

## PostgresDown
**Meaning:** PostgreSQL (primary or replica) isn't answering, or an app server can't query it.
**Check:** VPS1: `docker compose ps postgres`, `docker compose logs --tail 100 postgres`, `df -h` (a full disk stops Postgres). Cluster: `docker compose logs pgbouncer`.
**Fix:**
- Container stopped → `docker compose up -d postgres`.
- Disk full → [DiskSpaceLow](#diskspacelow) first.
- **Primary lost and not coming back** → planned failover to the replica: `scripts/cluster/failover-db.sh` (docs/PHASE2-WEEK5.md). Don't run it for a restart that takes a minute.
- Replica down only → public pages automatically read from the primary; fix at leisure (`scripts/cluster/reinit-replica.sh` if it can't catch up).

## HighDatabaseConnections
**Meaning:** more than 80% of `max_connections` in use. At 100% new requests fail.
**Check:** Database › "Connections by state". Many `idle in transaction` = a bug holding transactions open; many `active` = slow queries.
**Fix:** kill stuck ones: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND now() - state_change > interval '5 minutes';`. Check pgBouncer pool sizes (docs/operations/PERFORMANCE.md › "Connection pools").

## ReplicationLag
**Meaning:** the replica is more than 30 s behind the primary, is no longer a replica, or an app server can't use it (reads fall back to the primary — the site keeps working, the primary just works harder).
**Check:** on VPS1: `docker compose exec postgres psql -U $DB_USER -c "SELECT client_addr, state, replay_lag FROM pg_stat_replication"`. On VPS2: `docker compose logs --tail 100 postgres`. `ping 10.0.0.2` from VPS1.
**Fix:** network → restart WireGuard. Replica fell too far behind (WAL removed) → `scripts/cluster/reinit-replica.sh`. "No longer a replica" after an intended failover is expected — re-point monitoring labels (`infra/monitoring/prometheus/targets/cluster/postgres.yml`).

## DatabaseDeadlocks
**Meaning:** two transactions blocked each other and PostgreSQL cancelled one. One request failed.
**Check:** `docker compose logs postgres | grep -A5 deadlock` shows the two statements.
**Fix:** occasional ones are harmless. Repeated → report the statements as a bug (usually two admin actions updating the same listing in different orders).

## DiskSpaceLow
**Meaning:** less than 15% (warning) or 5% (critical) free, or the disk will fill within a day at the current rate.
**Check:** `df -h`, then `sudo du -xh --max-depth=2 / 2>/dev/null | sort -h | tail -20`. Usual suspects: `/var/lib/docker` (old images), `/srv/brookrege/backups`, Prometheus/Loki data.
**Fix:** `docker image prune -af --filter "until=168h"` (old images), `docker builder prune -af`. Backups: retention is automatic (14 daily + 12 monthly) — if they're still too big, move old monthlies off the server. Monitoring data: lower `PROMETHEUS_RETENTION_SIZE`. Upgrade the VPS disk if it's genuinely full of data.

## MemoryLow
**Meaning:** less than 10% of memory available for 10 minutes; the kernel may start killing processes.
**Check:** Servers › "Container memory" — which container grew? `docker stats --no-stream`.
**Fix:** restart the container that grew. On VPS1 the monitoring stack is the first thing to move to its own small VPS if memory is tight.

## HighCPU
**Meaning:** CPU above 90% for 15 minutes.
**Check:** `docker stats --no-stream`; Servers › "Container CPU". Traffic spike (Overview) or a runaway process?
**Fix:** traffic → check Cloudflare caching and the rate limits are on (docs/security/INFRASTRUCTURE.md); consider Cloudflare "Under Attack" mode if it's an attack. Runaway → restart it. Sustained real traffic → add capacity (docs/operations/PERFORMANCE.md › "Capacity").

## JobQueueStuck
**Meaning:** a background job (SMS, email, video thumbnail, report) has waited more than 10 minutes. Customers aren't getting confirmations.
**Check:** VPS3: `docker compose ps worker`, `docker compose logs --tail 100 worker`. Single server: jobs run inside `api` (`JOBS_WORKER=true`).
**Fix:** `docker compose restart worker`. If it can't reach the database → [PostgresDown](#postgresdown). Jobs stuck as RUNNING after a crash are recovered automatically within 5 minutes.

## JobsFailing
**Meaning:** more than 3 jobs of one type failed permanently (after all retries) in an hour.
**Check:** Loki: `{service="worker"} |= "job_failed"` — the `message` says why. Admin › Notifications › log for message jobs.
**Fix:** provider errors → [MessagesFailing](#messagesfailing). Video thumbnails → the file may be corrupt; the listing still works without a thumbnail.

## MessagesFailing
**Meaning:** more than 5 SMS or emails failed in an hour.
**Check:** Admin › Notifications › delivery log (error column). Provider dashboard (SendGrid / Twilio): credit, suspended account, rejected sender.
**Fix:** top up / fix at the provider; rotate the API key in Admin › Notifications if it was revoked. Failed messages aren't resent automatically once they've used all their retries.

## BackupTooOld
**Meaning:** no successful backup in the last 26 hours, the last backup attempt failed, backups never ran, or the off-site copy stopped. **Treat as urgent**: without backups, a disk failure loses data.
**Check:** `docker compose logs --tail 50 backup` on VPS1 (single server: the only server). `ls -lh /srv/brookrege/backups | tail` (single: `./backups`).
**Fix:** run one now: `docker compose exec backup /usr/local/bin/brookrege-backup`. Common failures: disk full, `BACKUP_AGE_RECIPIENT` missing, database password changed. Off-site: check the R2 token hasn't expired. Then run a restore drill (docs/security/BACKUPS.md).

## DeployFailed
**Meaning:** the last `deploy.sh` on that server stopped before switching (`failed`: backup, migration, image download or nginx check), or the new release was unhealthy and the server switched back (`rolled_back`), or even the switch back was unhealthy (`rollback_failed` — treat as **SiteDown**). `ServersOnDifferentReleases` also links here: VPS2 and VPS3 have run different releases for 30 minutes (a cluster deploy stopped half-way).
**Check:** `tail -5 /var/lib/brookrege/deploy/history.log` on the server named in the alert; the deploy's own output (GitHub › Actions › Deploy, or your terminal) says which step failed and why.
**Fix:** `failed` → nothing changed on the site; fix the cause (docs/operations/DEPLOYMENT-RUNBOOK.md › When a deploy stops) and deploy again. `rolled_back` → the site runs the previous release; find why the new one was unhealthy (`docker compose logs --since 1h api`) before retrying. Different releases → on VPS1 run `scripts/deploy/deploy-cluster.sh <release>` again, or `scripts/deploy/deploy-cluster.sh --rollback`. The alert clears with the next successful deploy.

## FailedSignInSpike
**Meaning:** many failed admin sign-ins (password guessing), accounts being locked, or many admin requests blocked by the origin/IP checks.
**Check:** Admin › Security › Recent events (which account, which addresses). Grafana › Security.
**Fix:** accounts lock themselves after 5 failures; nothing to do for a few attempts. Sustained attack → turn on the IP allowlist (Admin › Security › Network) or Cloudflare Access for the admin. A staff member locked out by mistake → Admin › Team › Unlock. If a **successful** sign-in looks suspicious → docs/security/INCIDENT-RESPONSE.md playbook A.

## LeadsWaiting
**Meaning:** more than 15 inquiries have stayed in NEW for over a day — customers are waiting for a call back.
**Check / fix:** a sales task, not a technical one: Admin › Inquiries › filter NEW. Forward this alert to the sales team lead (or remove the address from `ALERT_EMAIL_TO` for info alerts).

## NoLeads
**Meaning:** no inquiries or property requests for 3 days. Possible, but more often a broken form.
**Check:** submit a test inquiry on the live site (use your own number) and see it appear in Admin › Inquiries. Browser console errors? Cloudflare blocking the form (Security › Events)?
**Fix:** broken form → check `api` logs for the POST; a WAF/rate-limit rule too strict → relax it (docs/security/INFRASTRUCTURE.md).

## Watchdog
**Meaning:** this alert fires all the time on purpose. Alertmanager forwards it every minute to the heartbeat service (e.g. healthchecks.io). If *that* service emails you "Brookrege monitoring is down", Prometheus or Alertmanager (or VPS1) stopped. `PrometheusRuleErrors` also links here: a rule can't be evaluated.
**Fix:** on VPS1: `cd infra/monitoring && docker compose ps`, `docker compose up -d`. Rule errors: `docker compose logs prometheus | grep -i rule` and `promtool check rules`.

## AlertDeliveryFailing
**Meaning:** Alertmanager can't send email / Slack / Telegram messages. Other alerts may be firing unseen — check Grafana › Overview › "Alerts firing".
**Check:** `docker compose -f infra/monitoring/docker-compose.yml logs alertmanager | tail -50`.
**Fix:** SMTP password changed or SendGrid key revoked → update `/etc/brookrege/monitoring/secrets/smtp_password`, `docker compose restart alertmanager`. Slack webhook revoked → create a new one.
