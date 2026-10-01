/** Dedicated background worker (Phase 2: runs on VPS3 as its own container). Same code as the API's built-in worker. */
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { disconnectAll } from "./lib/prisma";
import { startWorker, stopWorker } from "./modules/jobs/worker";
import { ensureDefaultTemplates } from "./modules/notifications/defaultTemplates";
import { startMetricsServer } from "./metrics/server";
import "./metrics/collectors";
import { startCache } from "./lib/appCache";

void ensureDefaultTemplates().catch((e) => logger.error("templates_seed_failed", { message: e.message }));
startWorker();
startCache(); // the worker invalidates (expired listings, video posters) — it must reach Redis too
startMetricsServer({ role: "worker", port: env.METRICS_PORT, host: env.METRICS_HOST, token: env.METRICS_TOKEN, instance: env.INSTANCE_ID, version: env.APP_VERSION });
logger.info("worker_process_started", { instance: env.INSTANCE_ID });

async function shutdown(signal: string) {
  logger.info("worker_shutdown", { signal });
  await stopWorker();
  await disconnectAll();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
