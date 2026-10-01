import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "./logger";

const log: ("error" | "warn")[] = env.isProd ? ["error"] : ["error", "warn"];

/** Primary database: every write, every admin read, anything that must see its own writes. */
export const prisma = new PrismaClient({ log });

/**
 * Read replica (Phase 2). Used only for public, read-only endpoints where a
 * sub-second replication delay is harmless. If the replica is unreachable,
 * reads fall back to the primary automatically — the site keeps working.
 */
const replica = env.DATABASE_REPLICA_URL ? new PrismaClient({ datasourceUrl: env.DATABASE_REPLICA_URL, log }) : null;

let replicaHealthy = replica !== null;
let replicaState: { inRecovery: boolean | null; secondsSinceLastReplay: number | null; checkedAt: string | null; error: string | null } = {
  inRecovery: null,
  secondsSinceLastReplay: null,
  checkedAt: null,
  error: null,
};

export function readDb(): PrismaClient {
  return replica && replicaHealthy ? replica : prisma;
}

export async function checkReplica() {
  if (!replica) return { configured: false as const };
  try {
    const rows = await replica.$queryRaw<{ in_recovery: boolean; since_replay: number | null }[]>`
      SELECT pg_is_in_recovery() AS in_recovery,
             EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float8 AS since_replay`;
    if (!replicaHealthy) logger.info("replica_recovered");
    replicaHealthy = true;
    replicaState = { inRecovery: rows[0]?.in_recovery ?? null, secondsSinceLastReplay: rows[0]?.since_replay ?? null, checkedAt: new Date().toISOString(), error: null };
  } catch (err) {
    if (replicaHealthy) logger.warn("replica_unreachable_falling_back_to_primary", { message: (err as Error).message });
    replicaHealthy = false;
    replicaState = { ...replicaState, checkedAt: new Date().toISOString(), error: (err as Error).message.slice(0, 200) };
  }
  // Note: secondsSinceLastReplay grows while nobody writes; it is not the same as lag.
  // True lag is measured with WAL positions by scripts/cluster/test-replication-lag.sh.
  return { configured: true as const, healthy: replicaHealthy, ...replicaState };
}

/** Last known replica state, for metrics (no query). null when no replica is configured. */
export function replicaStatus() {
  return replica ? { healthy: replicaHealthy, secondsSinceLastReplay: replicaState.secondsSinceLastReplay } : null;
}

export function startReplicaMonitor() {
  if (!replica) return;
  void checkReplica();
  setInterval(() => void checkReplica(), 10_000).unref();
}

export async function disconnectAll() {
  await Promise.allSettled([prisma.$disconnect(), replica?.$disconnect()]);
}
