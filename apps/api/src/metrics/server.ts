import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { CONTENT_TYPE } from "../lib/metrics";
import { logger } from "../lib/logger";
import { appInfo, registry } from "./registry";

/**
 * Serves GET /metrics on its own port (default 9464), never through the public API or Nginx.
 * The port is published only on the private network (10.0.0.x) or 127.0.0.1 — see infra/monitoring.
 * Optional bearer token (METRICS_TOKEN) as a second lock.
 */
export function startMetricsServer(opts: { role: "api" | "worker"; port: number; host: string; token?: string; instance: string; version: string }): Server | null {
  if (!opts.port) return null;
  appInfo.set({ role: opts.role, instance: opts.instance, version: opts.version }, 1);
  const expected = opts.token ? Buffer.from(`Bearer ${opts.token}`) : null;
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || (req.url ?? "").split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (expected) {
      const got = Buffer.from(req.headers.authorization ?? "");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
        res.writeHead(401).end();
        return;
      }
    }
    try {
      const body = await registry.render();
      res.writeHead(200, { "Content-Type": CONTENT_TYPE, "Cache-Control": "no-store" }).end(body);
    } catch (e) {
      logger.error("metrics_render_failed", { message: (e as Error).message });
      res.writeHead(500).end();
    }
  });
  server.on("error", (e) => logger.error("metrics_server_error", { message: e.message }));
  server.listen(opts.port, opts.host, () => logger.info("metrics_listening", { port: opts.port, host: opts.host, role: opts.role }));
  server.unref();
  return server;
}
