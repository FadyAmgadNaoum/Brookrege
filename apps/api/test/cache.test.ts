import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Other test files run with the cache off; this one checks it end to end (memory level, no Redis).
vi.hoisted(() => { process.env.CACHE_ENABLED = "true"; });

import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { invalidatePublic } from "../src/lib/appCache";
import { app, loginAs, region, resetDb } from "./setup";

beforeEach(async () => { await resetDb(); await invalidatePublic("test reset"); });
afterAll(() => prisma.$disconnect());

const listing = (regionId: string, title: string) => ({ title, type: "APARTMENT", transaction: "SALE", sellerType: "RESALE", price: 1500000, areaSqm: 120, bedrooms: 3, regionId, publish: true });

describe("public cache", () => {
  it("serves repeat reads from cache, and an admin change shows up immediately", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const first = await agent.post("/api/admin/properties").send(listing(r.id, "شقة أولى للبيع"));
    expect(first.status).toBe(201);

    expect((await request(app).get("/api/properties")).body.meta.total).toBe(1);

    // A change made behind the API's back (directly in the database) is NOT visible: proof the cache is used.
    await prisma.property.update({ where: { id: first.body.data.id }, data: { title: "changed directly" } });
    const cached = await request(app).get(`/api/properties/${first.body.data.id}`);
    const again = await request(app).get(`/api/properties/${first.body.data.id}`);
    expect(again.body.data.title).toBe(cached.body.data.title);

    // A change through the admin clears the cache at once.
    const second = await agent.post("/api/admin/properties").send(listing(r.id, "شقة ثانية للبيع"));
    expect(second.status).toBe(201);
    expect((await request(app).get("/api/properties")).body.meta.total).toBe(2);
    expect((await request(app).get(`/api/properties/${first.body.data.id}`)).body.data.title).toBe("changed directly");
  });

  it("different filters are cached separately", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    await agent.post("/api/admin/properties").send(listing(r.id, "شقة للبيع"));
    expect((await request(app).get("/api/properties?transaction=SALE")).body.meta.total).toBe(1);
    expect((await request(app).get("/api/properties?transaction=RENT")).body.meta.total).toBe(0);
  });

  it("the health check reports the cache status", async () => {
    const health = await request(app).get("/api/health");
    expect(health.body.cache).toMatchObject({ l2: "off" });
  });
});
