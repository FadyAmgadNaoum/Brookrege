import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Runs `fn` on at most one app server at a time (Postgres transaction-scoped advisory lock).
 * Safe behind pgBouncer transaction pooling, unlike session locks. Returns null if another server holds it.
 */
export async function runExclusive<T>(lockKey: number, name: string, fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs = 120_000): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`;
    if (!rows[0]?.locked) {
      logger.debug("exclusive_skipped", { name });
      return null;
    }
    return fn(tx);
  }, { timeout: timeoutMs });
}
