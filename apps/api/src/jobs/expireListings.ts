import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { audit } from "../lib/audit";
import { invalidatePublic } from "../lib/appCache";

const LOCK_KEY = 874_210_001; // arbitrary constant, unique to this job

/**
 * Flips ACTIVE listings past expiresAt to EXPIRED.
 *
 * Concurrency: uses a TRANSACTION-scoped advisory lock (pg_try_advisory_xact_lock).
 * Session-scoped locks are unsafe with a connection pool (lock and unlock can land on
 * different connections). The xact lock lives on the transaction's connection and is
 * released automatically on commit/rollback. When Phase 2 runs two app servers, only
 * one executes the job.
 */
export async function expireListings(now = new Date()): Promise<number> {
  const count = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
      if (!rows[0]?.locked) {
        logger.info("expire_listings_skipped_lock_held");
        return 0;
      }
      const due = await tx.property.findMany({ where: { status: "ACTIVE", deletedAt: null, expiresAt: { lte: now } }, select: { id: true } });
      if (!due.length) return 0;
      const ids = due.map((d) => d.id);
      const { count } = await tx.property.updateMany({ where: { id: { in: ids }, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      await audit(null, { action: "property.auto_expire", entityType: "Property", after: { count, ids } }, tx);
      logger.info("expire_listings_done", { count });
      return count;
    },
    { timeout: 60_000 },
  );
  if (count > 0) await invalidatePublic("listings expired");
  return count;
}
