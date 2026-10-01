import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { TwoLevelCache } from "./cache";
import { logger } from "./logger";
import { redisStore } from "./redisStore";
import { cacheRequests } from "../metrics/registry";

/**
 * The API's cache for public catalog data (listings, search, compounds, projects, regions).
 * Namespace "public" is invalidated by any successful admin change to listings, media or the catalog,
 * and by the listing-expiry job (see invalidatePublicOnWrite below).
 */
export const PUBLIC_NS = "public";

const store = env.CACHE_ENABLED && env.REDIS_URL ? redisStore(env.REDIS_URL) : null;

export const appCache = new TwoLevelCache({
  l2: store,
  l1TtlSeconds: env.CACHE_L1_TTL_SECONDS,
  l1MaxEntries: 1000,
  events: {
    hit: (level) => cacheRequests.inc({ level, result: "hit" }),
    miss: (level) => cacheRequests.inc({ level, result: "miss" }),
    error: (op, err) => logger.warn("cache_l2_error", { op, message: (err as Error)?.message }),
  },
});

let started = false;
export function startCache() {
  if (started) return;
  started = true;
  void appCache.start();
}

/** Cached read of public data. With CACHE_ENABLED=false it just runs the loader. */
export function cachedPublic<T>(keyParts: unknown, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  if (!env.CACHE_ENABLED) return load();
  return appCache.wrap(PUBLIC_NS, TwoLevelCache.key(keyParts), ttlSeconds, load);
}

export function invalidatePublic(reason: string) {
  if (!env.CACHE_ENABLED) return Promise.resolve();
  logger.debug("cache_invalidate", { ns: PUBLIC_NS, reason });
  return appCache.invalidate(PUBLIC_NS).catch((e) => logger.warn("cache_invalidate_failed", { message: (e as Error).message }));
}

/**
 * Admin middleware: after any successful change (POST/PUT/PATCH/DELETE answered 2xx) under the listing,
 * media or catalog routes, drop the public cache. Coarse on purpose — admin edits are rare, and it is
 * impossible to forget a route.
 */
export function invalidatePublicOnWrite(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.on("finish", () => {
      if (res.statusCode < 400) void invalidatePublic(`${req.method} ${req.baseUrl}${req.path}`);
    });
  }
  next();
}

export function cacheStats() {
  return env.CACHE_ENABLED ? appCache.stats() : { disabled: true };
}
