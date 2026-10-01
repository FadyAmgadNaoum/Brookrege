import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { expireListings } from "../src/jobs/expireListings";
import { app, createUser, loginAs, PASSWORD, region, resetDb } from "./setup";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const aptForSale = (regionId: string) => ({
  title: "3-bedroom apartment in Retaj",
  type: "APARTMENT",
  transaction: "SALE",
  sellerType: "DEVELOPER",
  price: 1850000,
  areaSqm: 140,
  bedrooms: 3,
  bathrooms: 2,
  regionId,
  publish: true,
});

describe("health", () => {
  it("reports database status and which instance answered", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.db.primary).toBe("ok");
    expect(res.body.replica).toEqual({ configured: false });
    expect(res.body.version).toBe("dev"); // the release; deploy.sh checks it after switching (APP_VERSION)
    expect(res.headers["x-instance"]).toBeTruthy();
  });

  it("serves liveness without touching the database, and readiness through /api", async () => {
    expect((await request(app).get("/health/live")).body.status).toBe("ok");
    expect((await request(app).get("/api/health")).body.db.primary).toBe("ok");
  });
});

describe("sitemap", () => {
  it("lists visible listings and published compounds with change dates, nothing else", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const live = (await agent.post("/api/admin/properties").send(aptForSale(r.id))).body.data;
    const draft = (await agent.post("/api/admin/properties").send({ ...aptForSale(r.id), publish: false })).body.data;
    await prisma.compound.create({ data: { name: "Retaj", slug: "retaj", regionId: r.id, isPublished: true } });
    await prisma.compound.create({ data: { name: "Hidden", slug: "hidden", regionId: r.id, isPublished: false } });
    const res = await request(app).get("/api/sitemap");
    expect(res.status).toBe(200);
    const ids = res.body.data.properties.map((p: { id: string }) => p.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);
    expect(res.body.data.compounds.map((c: { slug: string }) => c.slug)).toEqual(["retaj"]);
    expect(Date.parse(res.body.data.properties[0].updatedAt)).not.toBeNaN();
  });
});

describe("admin auth", () => {
  it("rejects wrong password with a generic message", async () => {
    await loginAs("CONTENT_ADMIN");
    const res = await request(app).post("/api/admin/auth/login").send({ email: "content_admin@test.local", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });

  it("blocks admin routes without a session", async () => {
    const res = await request(app).get("/api/admin/properties");
    expect(res.status).toBe(401);
  });

  it("rotates refresh tokens and kills the family when an old token is replayed", async () => {
    const user = await createUser("CONTENT_ADMIN");
    const agent = request.agent(app);
    const login = await agent.post("/api/admin/auth/login").send({ email: user.email, password: PASSWORD });
    const cookies = ([] as string[]).concat(login.headers["set-cookie"] ?? []);
    const oldRefresh = cookies.find((c) => c.startsWith("bk_rt="))!.split(";")[0]!;

    const rotated = await agent.post("/api/admin/auth/refresh");
    expect(rotated.status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);

    // Attacker replays the stolen, already-rotated token.
    const replay = await request(app).post("/api/admin/auth/refresh").set("Cookie", oldRefresh);
    expect(replay.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);

    // The legitimate session is also ended.
    expect((await agent.post("/api/admin/auth/refresh")).status).toBe(401);
  });
});

describe("listing rules and visibility", () => {
  it("creates and publishes a listing that expires in 3 months", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const res = await agent.post("/api/admin/properties").send(aptForSale(r.id));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("ACTIVE");
    const days = (new Date(res.body.data.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);

    const audit = await prisma.auditLog.findFirst({ where: { action: "property.create" } });
    expect(audit?.entityId).toBe(res.body.data.id);
  });

  it("refuses to list a villa for rent", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const res = await agent.post("/api/admin/properties").send({ ...aptForSale(r.id), type: "VILLA", transaction: "RENT", sellerType: null });
    expect(res.status).toBe(400);
    expect(res.body.error.details.type).toBeDefined();
  });

  it("hides expired listings from the public but keeps them for admins", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const created = await agent.post("/api/admin/properties").send(aptForSale(r.id));
    const id = created.body.data.id as string;

    expect((await request(app).get(`/api/properties/${id}`)).status).toBe(200);

    // Simulate time passing: expiry date in the past, status still ACTIVE (job not yet run).
    await prisma.property.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await request(app).get(`/api/properties/${id}`)).status).toBe(404);

    expect(await expireListings()).toBe(1);
    const admin = await agent.get(`/api/admin/properties?status=EXPIRED`);
    expect(admin.body.data.map((p: { id: string }) => p.id)).toContain(id);

    const renewed = await agent.post(`/api/admin/properties/${id}/lifecycle`).send({ action: "renew" });
    expect(renewed.body.data.status).toBe("ACTIVE");
    expect((await request(app).get(`/api/properties/${id}`)).status).toBe(200);
  });

  it("summarises by type with starting-from price and unit count", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    await agent.post("/api/admin/properties").send(aptForSale(r.id));
    await agent.post("/api/admin/properties").send({ ...aptForSale(r.id), price: 1200000 });
    await agent.post("/api/admin/properties").send({ ...aptForSale(r.id), publish: false }); // draft: not counted
    const res = await request(app).get("/api/properties/summary?transaction=SALE");
    expect(res.body.data).toEqual([{ type: "APARTMENT", startingFrom: 1200000, availableUnits: 2 }]);
  });
});

describe("permissions", () => {
  it("moderators cannot delete listings or manage the team", async () => {
    const { agent } = await loginAs("MODERATOR");
    expect((await agent.delete("/api/admin/properties/any-id")).status).toBe(403);
    expect((await agent.get("/api/admin/team")).status).toBe(403);
  });

  it("the last super admin cannot be suspended", async () => {
    const { agent, user } = await loginAs("SUPER_ADMIN");
    const res = await agent.patch(`/api/admin/team/${user.id}`).send({ status: "SUSPENDED" });
    expect(res.status).toBe(400);
  });
});

describe("public lead capture", () => {
  it("accepts an 'add your property' request with an Egyptian mobile number", async () => {
    const res = await request(app).post("/api/submissions").send({ ownerName: "Ahmed", phone: "010 1234 5678", propertyType: "APARTMENT", transaction: "SALE" });
    expect(res.status).toBe(201);
    const row = await prisma.propertySubmission.findFirstOrThrow();
    expect(row.phone).toBe("01012345678");
  });

  it("rejects invalid phone numbers", async () => {
    const res = await request(app).post("/api/submissions").send({ ownerName: "Ahmed", phone: "123" });
    expect(res.status).toBe(400);
  });
});
