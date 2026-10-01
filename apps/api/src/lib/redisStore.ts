import { createClient } from "redis";
import type { L2Store } from "./cache";
import { logger } from "./logger";

/**
 * Redis adapter for the L2 cache (node-redis v4). Two connections: one for commands, one for the
 * invalidation subscription (a subscribed connection can't run other commands).
 * Commands fail fast while disconnected so a Redis outage never slows requests down.
 */
export function redisStore(url: string): L2Store & { quit(): Promise<void> } {
  const opts = {
    url,
    disableOfflineQueue: true, // don't queue commands while disconnected: fail fast, fall back to the DB
    socket: { connectTimeout: 2_000, reconnectStrategy: (retries: number) => Math.min(retries * 500, 5_000) },
  };
  const client = createClient(opts);
  const sub = createClient(opts);
  let warned = false;
  for (const c of [client, sub]) {
    c.on("error", (e: Error) => {
      if (!warned) logger.warn("redis_unavailable", { message: e.message });
      warned = true;
    });
    c.on("ready", () => {
      if (warned) logger.info("redis_recovered");
      warned = false;
    });
  }
  const connected = Promise.allSettled([client.connect(), sub.connect()]);

  return {
    async get(key) {
      return client.get(key);
    },
    async set(key, value, ttlSeconds) {
      await client.set(key, value, { EX: Math.max(1, Math.round(ttlSeconds)) });
    },
    async incr(key) {
      return client.incr(key);
    },
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    async subscribe(channel, onMessage) {
      await connected;
      await sub.subscribe(channel, (message: string) => onMessage(message));
    },
    async quit() {
      await Promise.allSettled([client.quit(), sub.quit()]);
    },
  };
}
