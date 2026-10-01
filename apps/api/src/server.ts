import { env } from "./config/env";
import { createApp } from "./app";
import { logger } from "./lib/logger";
import { disconnectAll, startReplicaMonitor } from "./lib/prisma";
import { startScheduler } from "./jobs/scheduler";
import { startWorker, stopWorker } from "./modules/jobs/worker";
import { ensureDefaultTemplates } from "./modules/notifications/defaultTemplates";
import { startMetricsServer } from "./metrics/server";
import "./metrics/collectors";
import { startCache } from "./lib/appCache";

const server = createApp().listen(env.PORT, () => logger.info("api_listening", { port: env.PORT, env: env.NODE_ENV, instance: env.INSTANCE_ID }));
startScheduler();
startCache();
startMetricsServer({ role: "api", port: env.METRICS_PORT, host: env.METRICS_HOST, token: env.METRICS_TOKEN, instance: env.INSTANCE_ID, version: env.APP_VERSION });
startReplicaMonitor();
void ensureDefaultTemplates().catch((e) => logger.error("templates_seed_failed", { message: e.message }));
if (env.JOBS_WORKER === "true") startWorker();

// Graceful shutdown: finish in-flight requests, then close DB pool.
function shutdown(signal: string) {
  logger.info("shutdown", { signal });
  server.close(() => {
    stopWorker()
      .then(() => disconnectAll())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 20_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
