import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import { env } from "./config/env";
import { checkReplica, prisma } from "./lib/prisma";
import { cacheStats } from "./lib/appCache";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLog } from "./middleware/requestLog";
import { httpMetrics } from "./middleware/httpMetrics";
import { rejectNullBytes } from "./middleware/rejectNullBytes";
import { adminOrigins } from "./middleware/adminGuards";
import { publicRouter } from "./modules/public/public.routes";
import { adminRouter } from "./modules/admin";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Nginx: req.ip = real client IP

  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  // Admin API: only the admin app's origin, with cookies. Public API: listed origins, never with cookies.
  app.use(
    cors((req, cb) => {
      const isAdmin = req.url?.startsWith("/api/admin");
      const allowed = isAdmin ? adminOrigins() : env.corsOrigins;
      cb(null, { origin: (origin, done) => done(null, !origin || allowed.includes(origin)), credentials: Boolean(isAdmin) });
    }),
  );
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.use(rejectNullBytes);
  app.use(requestLog);
  app.use(httpMetrics);

  // Identify which app server answered (load-balancer tests, debugging). Contains no secrets.
  app.use((_req, res, next) => {
    res.setHeader("X-Instance", env.INSTANCE_ID);
    next();
  });

  /** Liveness: the process is up. Never touches the database. */
  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok", instance: env.INSTANCE_ID, version: env.APP_VERSION, uptime: Math.round(process.uptime()) });
  });

  /** Readiness: can serve traffic (primary reachable). Used by Docker and the load balancer. */
  const ready = async (_req: express.Request, res: express.Response) => {
    const started = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const replica = await checkReplica();
      res.json({ status: "ok", instance: env.INSTANCE_ID, version: env.APP_VERSION, uptime: Math.round(process.uptime()), db: { primary: "ok", latencyMs: Date.now() - started }, replica, cache: cacheStats() });
    } catch {
      res.status(503).json({ status: "degraded", instance: env.INSTANCE_ID, db: { primary: "down" } });
    }
  };
  app.get("/health", ready);
  app.get("/health/ready", ready);
  // Same check reachable through the public load balancer (which only forwards /api/*).
  app.get("/api/health", ready);

  // In production Nginx serves /uploads directly from the shared volume; this is the dev fallback.
  app.use("/uploads", express.static(path.resolve(env.UPLOAD_DIR), { maxAge: "30d", immutable: true }));

  app.use("/api/admin", adminRouter);
  app.use("/api", publicRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
