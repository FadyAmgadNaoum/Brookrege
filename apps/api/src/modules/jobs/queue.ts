import { Prisma, type Job } from "@prisma/client";
import { backoffMs, shouldRetry, type JobType } from "@brookrege/domain";
import { prisma } from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** Add a job. Pass `db` (a transaction) to enqueue atomically with the change that caused it. */
export async function enqueue(type: JobType, payload: Prisma.InputJsonObject, opts: { runAt?: Date; maxAttempts?: number; db?: Db } = {}) {
  return (opts.db ?? prisma).job.create({ data: { type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 }, select: { id: true } });
}

/**
 * Claims up to `limit` due jobs in ONE statement. FOR UPDATE SKIP LOCKED means two workers
 * (VPS2 and VPS3) never receive the same job, with no Redis or leader election.
 */
export async function claim(workerId: string, limit: number): Promise<Job[]> {
  return prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Job" WHERE status = 'QUEUED' AND "runAt" <= now()
      ORDER BY "runAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING *`;
}

export async function complete(id: string) {
  await prisma.job.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), lockedAt: null, lastError: null } });
}

/** Failed attempt: retry later with exponential backoff, or give up after maxAttempts. */
export async function fail(job: Job, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const retry = shouldRetry(job.attempts, job.maxAttempts);
  await prisma.job.update({
    where: { id: job.id },
    data: retry
      ? { status: "QUEUED", runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedAt: null, lockedBy: null, lastError: message }
      : { status: "FAILED", finishedAt: new Date(), lockedAt: null, lastError: message },
  });
  return retry;
}

/** A worker that crashed mid-job leaves it RUNNING; requeue anything locked for over 15 minutes. */
export async function recoverStuck() {
  const { count } = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "QUEUED", lockedAt: null, lockedBy: null, lastError: "Recovered after worker stopped mid-job" },
  });
  return count;
}

/** Keep the table small: finished jobs older than 30 days are removed. */
export async function pruneFinished() {
  const { count } = await prisma.job.deleteMany({ where: { status: { in: ["DONE", "FAILED"] }, finishedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  return count;
}
