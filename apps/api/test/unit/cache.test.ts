import { test } from "node:test";
import assert from "node:assert/strict";
import { TwoLevelCache, type L2Store } from "../../src/lib/cache";

/** In-memory stand-in for Redis shared by several "servers", with pub/sub and failure injection. */
class FakeRedis {
  data = new Map<string, { v: string; exp: number }>();
  subs = new Map<string, ((m: string) => void)[]>();
  failing = false;
  now = () => Date.now();
  store(): L2Store {
    const chk = () => { if (this.failing) throw new Error("redis down"); };
    return {
      get: async (k) => { chk(); const e = this.data.get(k); return e && e.exp > this.now() ? e.v : null; },
      set: async (k, v, ttl) => { chk(); this.data.set(k, { v, exp: this.now() + ttl * 1000 }); },
      incr: async (k) => { chk(); const n = Number(this.data.get(k)?.v ?? 0) + 1; this.data.set(k, { v: String(n), exp: Infinity }); return n; },
      publish: async (c, m) => { chk(); for (const f of this.subs.get(c) ?? []) f(m); },
      subscribe: async (c, f) => { chk(); this.subs.set(c, [...(this.subs.get(c) ?? []), f]); },
    };
  }
}

const counter = () => { let n = 0; const load = async () => ({ n: ++n }); return { load, calls: () => n }; };

test("L1 serves repeat reads; the loader runs once", async () => {
  const c = new TwoLevelCache();
  const { load, calls } = counter();
  assert.deepEqual(await c.wrap("public", "k", 60, load), { n: 1 });
  assert.deepEqual(await c.wrap("public", "k", 60, load), { n: 1 });
  assert.equal(calls(), 1);
});

test("a second server reads the first server's result from Redis (L2)", async () => {
  const r = new FakeRedis();
  const events: string[] = [];
  const ev = { hit: (l: string) => events.push(`hit:${l}`), miss: (l: string) => events.push(`miss:${l}`), error: () => events.push("error") };
  const a = new TwoLevelCache({ l2: r.store(), events: ev }), b = new TwoLevelCache({ l2: r.store(), events: ev });
  const { load, calls } = counter();
  await a.wrap("public", "k", 60, load);
  assert.deepEqual(await b.wrap("public", "k", 60, load), { n: 1 });
  assert.equal(calls(), 1);
  assert.deepEqual(events, ["miss:l1", "miss:l2", "miss:l1", "hit:l2"]);
});

test("invalidation on one server reaches the other immediately (pub/sub)", async () => {
  const r = new FakeRedis();
  const a = new TwoLevelCache({ l2: r.store() }), b = new TwoLevelCache({ l2: r.store() });
  await a.start(); await b.start();
  let version = 1;
  const load = async () => ({ version });
  assert.deepEqual(await b.wrap("public", "k", 1800, load), { version: 1 });
  version = 2;
  await a.invalidate("public");
  assert.deepEqual(await b.wrap("public", "k", 1800, load), { version: 2 }, "B must not serve its old L1 entry");
  assert.deepEqual(await a.wrap("public", "k", 1800, load), { version: 2 });
  assert.equal(b.stats().generations.public, 1);
});

test("concurrent misses share one database load", async () => {
  const c = new TwoLevelCache();
  let calls = 0;
  const load = () => new Promise<number>((res) => setTimeout(() => res(++calls), 20));
  const results = await Promise.all(Array.from({ length: 10 }, () => c.wrap("public", "k", 60, load)));
  assert.deepEqual(new Set(results), new Set([1]));
  assert.equal(calls, 1);
});

test("Redis failing never fails a request, and is skipped for 30 s", async () => {
  const r = new FakeRedis();
  let t = 1_000_000;
  const errors: string[] = [];
  const c = new TwoLevelCache({ l2: r.store(), now: () => t, events: { hit() {}, miss() {}, error: (op) => errors.push(op) } });
  r.failing = true;
  const { load } = counter();
  assert.deepEqual(await c.wrap("public", "a", 60, load), { n: 1 });
  assert.equal(c.stats().l2, "backing-off");
  const before = errors.length;
  await c.wrap("public", "b", 60, load);
  assert.equal(errors.length, before, "no Redis calls while backing off");
  r.failing = false; t += 31_000;
  assert.equal(c.stats().l2, "up");
  await c.invalidate("public"); // works again
  assert.equal(c.stats().generations.public, 1);
});

test("without Redis, invalidate clears this server's entries", async () => {
  const c = new TwoLevelCache();
  let v = 1;
  await c.wrap("public", "k", 60, async () => v);
  v = 2;
  await c.invalidate("public");
  assert.equal(await c.wrap("public", "k", 60, async () => v), 2);
});

test("after Redis restarts (generation forgotten) servers agree again", async () => {
  const r = new FakeRedis();
  const a = new TwoLevelCache({ l2: r.store() }), b = new TwoLevelCache({ l2: r.store() });
  await a.start(); await b.start();
  await a.invalidate("public"); await a.invalidate("public"); // gen 2 everywhere
  r.data.clear(); // restart without persistence
  let v = "fresh";
  assert.equal(await b.wrap("public", "x", 60, async () => v), "fresh");
  v = "newer";
  await a.invalidate("public"); // gen 1 again — still must reach B
  assert.equal(await b.wrap("public", "x", 60, async () => v), "newer");
});

test("L1 entries expire after the L1 TTL; L1 is size-bounded (LRU)", async () => {
  let t = 0;
  const c = new TwoLevelCache({ now: () => t, l1TtlSeconds: 30, l1MaxEntries: 3 });
  const { load, calls } = counter();
  await c.wrap("public", "k", 600, load);
  t += 29_000; await c.wrap("public", "k", 600, load);
  assert.equal(calls(), 1);
  t += 2_000; await c.wrap("public", "k", 600, load);
  assert.equal(calls(), 2);
  for (const k of ["a", "b", "c", "d"]) await c.wrap("public", k, 600, async () => k);
  assert.equal(c.stats().l1Entries, 3);
});

test("a value loaded while an invalidation happened is not cached", async () => {
  const r = new FakeRedis();
  const a = new TwoLevelCache({ l2: r.store() }), b = new TwoLevelCache({ l2: r.store() });
  await a.start(); await b.start();
  let release!: () => void;
  const slow = a.wrap("public", "k", 60, () => new Promise<string>((res) => { release = () => res("old"); }));
  await new Promise((r2) => setTimeout(r2, 5));
  await b.invalidate("public"); // a change lands while A is still reading the old data
  release();
  assert.equal(await slow, "old"); // this request gets what it read…
  assert.equal(await a.wrap("public", "k", 60, async () => "new"), "new"); // …but it was not cached
});

test("keys are stable for equal inputs and differ otherwise", () => {
  assert.equal(TwoLevelCache.key({ a: 1, b: [2] }), TwoLevelCache.key({ a: 1, b: [2] }));
  assert.notEqual(TwoLevelCache.key({ a: 1 }), TwoLevelCache.key({ a: 2 }));
});
