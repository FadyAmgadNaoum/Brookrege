import { afterAll, describe, expect, it } from "vitest";
import { TwoLevelCache } from "../src/lib/cache";
import { redisStore } from "../src/lib/redisStore";

// Runs against a real Redis when TEST_REDIS_URL is set (CI provides one); skipped otherwise.
const url = process.env.TEST_REDIS_URL;
const stores: ReturnType<typeof redisStore>[] = [];
afterAll(async () => { await Promise.all(stores.map((s) => s.quit())); });

describe.skipIf(!url)("Redis (L2) with the real client", () => {
  const make = () => { const s = redisStore(url!); stores.push(s); return s; };

  it("get / set with expiry / incr", async () => {
    const s = make();
    const key = `test:${Date.now()}`;
    await new Promise((r) => setTimeout(r, 200)); // connect
    expect(await s.get(key)).toBeNull();
    await s.set(key, "v", 1);
    expect(await s.get(key)).toBe("v");
    expect(await s.incr(`${key}:n`)).toBe(1);
    expect(await s.incr(`${key}:n`)).toBe(2);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await s.get(key)).toBeNull();
  });

  it("two servers share entries and invalidations", async () => {
    const prefix = `bk:test:${Date.now()}`;
    const a = new TwoLevelCache({ l2: make(), prefix }), b = new TwoLevelCache({ l2: make(), prefix });
    await a.start(); await b.start();
    await new Promise((r) => setTimeout(r, 200));
    let v = 1, loads = 0;
    const load = async () => { loads++; return v; };
    expect(await a.wrap("public", "k", 60, load)).toBe(1);
    await new Promise((r) => setTimeout(r, 50)); // L2 write is asynchronous
    expect(await b.wrap("public", "k", 60, load)).toBe(1);
    expect(loads).toBe(1);
    v = 2;
    await a.invalidate("public");
    await new Promise((r) => setTimeout(r, 100)); // pub/sub delivery
    expect(await b.wrap("public", "k", 60, load)).toBe(2);
  });
});
