import { prisma, replicaStatus } from "../lib/prisma";
import type { Gauge } from "../lib/metrics";
import { registry } from "./registry";

/**
 * Business and queue gauges, read from the database at scrape time (at most every 30 s per process).
 * Every process reports the same values; dashboards use max() across instances.
 */
const CACHE_MS = 30_000;
let last = 0;
let running: Promise<void> | null = null;

const dbUp = registry.gauge("brookrege_db_up", "1 if this process can query the primary database.");
const listings = registry.gauge("brookrege_listings", "Listings by status (deleted excluded).", ["status"]);
const expiring = registry.gauge("brookrege_listings_expiring_7d", "Active listings that expire within 7 days.");
const leadsOpen = registry.gauge("brookrege_leads_open", "Leads nobody has handled yet (status NEW).", ["kind"]);
const leads24h = registry.gauge("brookrege_leads_last_24h", "Leads received in the last 24 hours.", ["kind"]);
const jobs = registry.gauge("brookrege_jobs", "Background jobs by status (QUEUED counts only jobs that are due).", ["status"]);
const oldestQueued = registry.gauge("brookrege_jobs_oldest_due_seconds", "Age of the oldest due job still waiting. Grows when workers are stuck.");
const mediaProcessing = registry.gauge("brookrege_media_processing", "Uploads still being processed (video thumbnails etc.).");
const sessions = registry.gauge("brookrege_admin_sessions_active", "Signed-in admin sessions.");
// Replica as seen by this app server (fallback to primary happens when unhealthy). Replication lag itself
// comes from postgres_exporter on the replica (pg_replication_lag_seconds).
const replicaHealthy: Gauge = registry.gauge("brookrege_db_replica_healthy", "1 if this server can read from the replica; 0 = reads fell back to the primary.", [], () => {
  const r = replicaStatus();
  replicaHealthy.reset();
  if (r) replicaHealthy.set(undefined, r.healthy ? 1 : 0);
});

async function refresh() {
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [byStatus, exp, inqNew, subNew, inq24, sub24, jobRows, oldest, media, sess] = await Promise.all([
      prisma.property.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.property.count({ where: { deletedAt: null, status: "ACTIVE", expiresAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) } } }),
      prisma.inquiry.count({ where: { status: "NEW" } }),
      prisma.propertySubmission.count({ where: { status: "NEW" } }),
      prisma.inquiry.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.propertySubmission.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT status::text AS status, count(*)::bigint AS n FROM "Job"
        WHERE status IN ('RUNNING', 'FAILED') OR (status = 'QUEUED' AND "runAt" <= now())
        GROUP BY status`,
      prisma.$queryRaw<{ age: number | null }[]>`
        SELECT EXTRACT(EPOCH FROM now() - min("runAt"))::float8 AS age FROM "Job" WHERE status = 'QUEUED' AND "runAt" <= now()`,
      prisma.mediaAsset.count({ where: { status: "PROCESSING", deletedAt: null } }),
      prisma.adminSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    listings.reset();
    for (const s of ["DRAFT", "ACTIVE", "EXPIRED", "SOLD", "ARCHIVED"]) listings.set({ status: s }, 0);
    for (const g of byStatus) listings.set({ status: g.status }, g._count._all);
    expiring.set(undefined, exp);
    leadsOpen.set({ kind: "inquiry" }, inqNew);
    leadsOpen.set({ kind: "submission" }, subNew);
    leads24h.set({ kind: "inquiry" }, inq24);
    leads24h.set({ kind: "submission" }, sub24);
    jobs.reset();
    for (const s of ["QUEUED", "RUNNING", "FAILED"]) jobs.set({ status: s }, 0);
    for (const r of jobRows) jobs.set({ status: r.status }, Number(r.n));
    oldestQueued.set(undefined, oldest[0]?.age ?? 0);
    mediaProcessing.set(undefined, media);
    sessions.set(undefined, sess);
    dbUp.set(undefined, 1);
  } catch {
    dbUp.set(undefined, 0);
  }
}

registry.onCollect(async () => {
  if (Date.now() - last < CACHE_MS) return running ?? undefined;
  last = Date.now();
  running = refresh().finally(() => (running = null));
  return running;
});
