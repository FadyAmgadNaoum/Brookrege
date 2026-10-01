import type { Job } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { claim, complete, fail, recoverStuck } from "./queue";
import { handlers } from "./handlers";
import { jobDuration, jobsProcessed } from "../../metrics/registry";

const JOB_TIMEOUT_MS = 10 * 60_000;
let running = false;
let active = 0;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Job timed out after ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function run(job: Job) {
  const handler = handlers[job.type];
  const started = Date.now();
  try {
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    await withTimeout(handler(job.payload as Record<string, unknown>, job), JOB_TIMEOUT_MS);
    await complete(job.id);
    jobsProcessed.inc({ type: job.type, outcome: "done" });
    logger.info("job_done", { id: job.id, type: job.type, ms: Date.now() - started });
  } catch (err) {
    const retrying = await fail(job, err);
    jobsProcessed.inc({ type: job.type, outcome: retrying ? "retry" : "failed" });
    logger[retrying ? "warn" : "error"]("job_failed", { id: job.id, type: job.type, attempt: job.attempts, retrying, message: (err as Error).message });
  } finally {
    jobDuration.observe({ type: job.type }, (Date.now() - started) / 1000);
  }
}

/** Polls every 2 s (and immediately after a busy batch). Several servers can run this safely. */
export function startWorker() {
  if (running) return;
  running = true;
  const workerId = `${env.INSTANCE_ID}:${process.pid}`;
  const loop = async () => {
    while (running) {
      let claimed = 0;
      try {
        const free = env.JOBS_CONCURRENCY - active;
        if (free > 0) {
          const jobs = await claim(workerId, free);
          claimed = jobs.length;
          for (const j of jobs) {
            active++;
            void run(j).finally(() => active--);
          }
        }
      } catch (err) {
        logger.error("worker_poll_failed", { message: (err as Error).message });
      }
      await new Promise((r) => setTimeout(r, claimed ? 200 : 2000));
    }
  };
  void loop();
  setInterval(() => void recoverStuck().catch(() => undefined), 5 * 60_000).unref();
  logger.info("worker_started", { workerId, concurrency: env.JOBS_CONCURRENCY });
}

export async function stopWorker(graceMs = 15_000) {
  running = false;
  const until = Date.now() + graceMs;
  while (active > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
}
