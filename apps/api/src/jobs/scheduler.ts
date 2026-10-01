import cron from "node-cron";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { runExclusive } from "../lib/exclusive";
import { expireListings } from "./expireListings";
import { enqueue } from "../modules/jobs/queue";
import { queueDueReports } from "../modules/jobs/handlers";

const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((err) => logger.error(`${name}_failed`, { message: err?.message }));

/**
 * Cron runs on every app server; each task is made exclusive so it executes once:
 *  - listing expiry: its own advisory lock
 *  - daily/weekly enqueues: advisory lock (only one server enqueues)
 *  - scheduled reports: FOR UPDATE SKIP LOCKED on the schedule rows
 */
export function startScheduler() {
  const tz = { timezone: env.TZ_NAME };
  const run = safe("expire_listings", () => expireListings());
  cron.schedule(env.EXPIRY_CRON, run, tz);
  setTimeout(run, 10_000); // catch up on boot

  cron.schedule("*/15 * * * *", safe("queue_due_reports", () => queueDueReports()), tz);
  cron.schedule("30 3 * * *", safe("media_cleanup", () => runExclusive(874_210_002, "media_cleanup", (tx) => enqueue("media_cleanup", {}, { db: tx }))), tz);
  cron.schedule("10 4 * * *", safe("privacy_retention", () => runExclusive(874_210_004, "privacy_retention", (tx) => enqueue("privacy_retention", {}, { db: tx }))), tz);
  cron.schedule("0 9 * * 0", safe("expiring_digest", () => runExclusive(874_210_003, "expiring_digest", (tx) => enqueue("expiring_digest", {}, { db: tx }))), tz);
  logger.info("scheduler_started", { tz: env.TZ_NAME });
}
