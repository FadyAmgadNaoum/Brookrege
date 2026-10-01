import { createHash } from "node:crypto";

/**
 * Two-level cache for public, read-only API responses (Phase 4 · Week 14).
 *
 *   L1 — memory of each API process: fastest, small (LRU), short TTL.
 *   L2 — Redis, shared by all API servers (optional; without it the cache is L1-only).
 *
 * Invalidation uses a *generation* number per namespace: every key includes it, so bumping it makes all old
 * entries unreachable at once (no key scans). A change on one server bumps the generation in Redis and
 * publishes it; every server hears the message and drops its L1 immediately. If Redis is down, each server
 * still drops its own L1, and other servers catch up within the L1 TTL.
 *
 * Correctness first: a cache failure never fails a request — it falls through to the database.
 */

export interface L2Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Atomically increments and returns the new value. */
  incr(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<void>;
  /** Registers a handler for invalidation messages from other servers. */
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
}

export interface CacheEvents {
  hit(level: "l1" | "l2"): void;
  miss(level: "l1" | "l2"): void;
  error(op: string, err: unknown): void;
}

interface L1Entry { value: string; expires: number; gen: number }

export const INVALIDATE_CHANNEL = "brookrege:cache:invalidate";

export class TwoLevelCache {
  private l1 = new Map<string, L1Entry>();
  private gens = new Map<string, number>();
  private inflight = new Map<string, Promise<unknown>>();
  private l2Down = 0; // timestamp until which L2 is skipped after an error

  constructor(
    private readonly opts: {
      l2?: L2Store | null;
      l1MaxEntries?: number;
      l1TtlSeconds?: number;
      events?: CacheEvents;
      now?: () => number;
      prefix?: string;
    } = {},
  ) {}

  private get now() { return this.opts.now?.() ?? Date.now(); }
  private get prefix() { return this.opts.prefix ?? "bk:v1"; }
  private get l2() { return this.opts.l2 && this.now >= this.l2Down ? this.opts.l2 : null; }

  private l2Failed(op: string, err: unknown) {
    this.opts.events?.error(op, err);
    this.l2Down = this.now + 30_000; // back off; the database carries the load meanwhile
  }

  /** Subscribe to invalidations from other servers (call once at start-up). */
  async start() {
    const l2 = this.opts.l2;
    if (!l2) return;
    try {
      await l2.subscribe(INVALIDATE_CHANNEL, (msg) => {
        // Any message means "something changed": adopt its generation and drop L1 for that namespace.
        const [ns, genStr] = msg.split(":");
        const gen = Number(genStr);
        if (ns && Number.isFinite(gen)) { this.gens.delete(ns); this.applyGeneration(ns, gen); }
      });
    } catch (e) {
      this.l2Failed("subscribe", e);
    }
  }

  /** Adopts a generation (from Redis or a message) and drops this server's L1 entries of the namespace. */
  private applyGeneration(ns: string, gen: number) {
    if (this.gens.get(ns) === gen) return;
    this.gens.set(ns, gen);
    for (const k of this.l1.keys()) if (k.startsWith(`${ns}|`)) this.l1.delete(k);
  }

  /**
   * Redis holds the authoritative generation, so all servers build the same L2 keys (even after Redis
   * restarts and forgets it: every server then reads 0 and agrees again).
   */
  private async generation(ns: string): Promise<number> {
    const l2 = this.l2;
    if (l2) {
      try {
        this.applyGeneration(ns, Number((await l2.get(`${this.prefix}:gen:${ns}`)) ?? 0));
      } catch (e) {
        this.l2Failed("get-gen", e);
      }
    }
    return this.gens.get(ns) ?? 0;
  }

  /** Stable key from arbitrary parts (e.g. route + validated query). */
  static key(parts: unknown): string {
    return createHash("sha1").update(JSON.stringify(parts)).digest("base64url");
  }

  /**
   * Returns the cached value for (ns, key), or runs `load`, stores and returns its result.
   * Concurrent misses for the same key share one `load` call (no stampede on the database).
   */
  async wrap<T>(ns: string, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const l1Key = `${ns}|${key}`;
    const localGen = this.gens.get(ns) ?? 0;
    const hit = this.l1.get(l1Key);
    if (hit && hit.expires > this.now && hit.gen === localGen) {
      this.l1.delete(l1Key); // refresh LRU position
      this.l1.set(l1Key, hit);
      this.opts.events?.hit("l1");
      return JSON.parse(hit.value) as T;
    }
    this.opts.events?.miss("l1");

    const running = this.inflight.get(l1Key);
    if (running) return running as Promise<T>;

    const task = (async () => {
      const gen = await this.generation(ns);
      const l2Key = `${this.prefix}:${ns}:${gen}:${key}`;
      const l2 = this.l2;
      if (l2) {
        try {
          const raw = await l2.get(l2Key);
          if (raw !== null) {
            this.opts.events?.hit("l2");
            this.storeL1(l1Key, raw, gen, ttlSeconds);
            return JSON.parse(raw) as T;
          }
          this.opts.events?.miss("l2");
        } catch (e) {
          this.l2Failed("get", e);
        }
      }
      const value = await load();
      const raw = JSON.stringify(value);
      // Don't cache if an invalidation happened while we were loading: the value may already be stale.
      if ((this.gens.get(ns) ?? 0) === gen) {
        this.storeL1(l1Key, raw, gen, ttlSeconds);
        const l2w = this.l2;
        if (l2w) l2w.set(l2Key, raw, ttlSeconds).catch((e) => this.l2Failed("set", e));
      }
      return value;
    })();
    this.inflight.set(l1Key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(l1Key);
    }
  }

  private storeL1(key: string, value: string, gen: number, ttlSeconds: number) {
    const ttl = Math.min(ttlSeconds, this.opts.l1TtlSeconds ?? 30) * 1000;
    this.l1.set(key, { value, gen, expires: this.now + ttl });
    const max = this.opts.l1MaxEntries ?? 500;
    while (this.l1.size > max) this.l1.delete(this.l1.keys().next().value as string);
  }

  /** Makes every cached entry of the namespace unreachable, on all servers. */
  async invalidate(ns: string) {
    const l2 = this.opts.l2;
    if (l2) {
      try {
        const gen = await l2.incr(`${this.prefix}:gen:${ns}`);
        this.gens.delete(ns);
        this.applyGeneration(ns, gen);
        await l2.publish(INVALIDATE_CHANNEL, `${ns}:${gen}`);
        return;
      } catch (e) {
        this.l2Failed("invalidate", e);
      }
    }
    // No Redis (or it failed): this server drops its entries now; others expire within the L1 TTL.
    const next = (this.gens.get(ns) ?? 0) + 1;
    this.applyGeneration(ns, next);
  }

  /** For tests and the health endpoint. */
  stats() {
    return { l1Entries: this.l1.size, generations: Object.fromEntries(this.gens), l2: this.opts.l2 ? (this.now >= this.l2Down ? "up" : "backing-off") : "off" };
  }
}
