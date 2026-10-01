import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";
import { claim, enqueue, fail } from "../src/modules/jobs/queue";
import { deliverEmail } from "../src/modules/notifications/notify.service";
import { ensureDefaultTemplates } from "../src/modules/notifications/defaultTemplates";
import { app, loginAs, region, resetDb } from "./setup";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const listing = (regionId: string) => ({ title: "شقة ٣ غرف", type: "APARTMENT", transaction: "SALE", sellerType: "RESALE", price: 1500000, areaSqm: 120, bedrooms: 3, bathrooms: 2, regionId, publish: true });

describe("job queue", () => {
  it("never hands the same job to two workers", async () => {
    for (let i = 0; i < 10; i++) await enqueue("media_cleanup", { i });
    const [a, b] = await Promise.all([claim("w1", 10), claim("w2", 10)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("retries with backoff, then gives up", async () => {
    await enqueue("media_cleanup", {}, { maxAttempts: 2 });
    let [job] = await claim("w", 1);
    expect(await fail(job!, new Error("boom"))).toBe(true);
    const queued = await prisma.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(queued.status).toBe("QUEUED");
    expect(queued.runAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.job.update({ where: { id: job!.id }, data: { runAt: new Date() } });
    [job] = await claim("w", 1);
    expect(await fail(job!, new Error("boom again"))).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("FAILED");
  });
});

describe("media", () => {
  it("bulk upload: good image processed and attached, bad file reported, listing shows srcset data", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const p = await agent.post("/api/admin/properties").send(listing(r.id));
    const jpg = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#789" } }).jpeg().toBuffer();
    const res = await agent.post(`/api/admin/media/upload?propertyId=${p.body.data.id}`)
      .attach("files", jpg, "living-room.jpg")
      .attach("files", Buffer.from("not an image at all, just text"), "notes.txt");
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0].variants)).toEqual(["480", "960", "1600"]);
    expect(res.body.errors[0].file).toBe("notes.txt");
    const pub = await request(app).get(`/api/properties/${p.body.data.id}`);
    expect(pub.body.data.media[0].asset.variants["960"]).toMatch(/960\.webp$/);
  });

  it("deleting a file in use needs confirmation", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const p = await agent.post("/api/admin/properties").send(listing(r.id));
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#123" } }).png().toBuffer();
    const up = await agent.post(`/api/admin/media/upload?propertyId=${p.body.data.id}`).attach("files", png, "a.png");
    const id = up.body.data[0].id;
    expect((await agent.delete(`/api/admin/media/${id}`)).status).toBe(409);
    expect((await agent.delete(`/api/admin/media/${id}?force=true`)).status).toBe(204);
    expect(await prisma.propertyMedia.count()).toBe(0);
  });
});

describe("analytics & reports", () => {
  it("counts views and inquiries into the dashboard KPIs", async () => {
    const r = await region();
    const { agent } = await loginAs("SUPER_ADMIN");
    const p = await agent.post("/api/admin/properties").send(listing(r.id));
    // Views are counted by the page's beacon (POST …/view), not by reading the listing (which is cached).
    expect((await request(app).post(`/api/properties/${p.body.data.id}/view`).set("User-Agent", "Mozilla/5.0")).status).toBe(204);
    await request(app).post(`/api/properties/${p.body.data.id}/view`).set("User-Agent", "Mozilla/5.0"); // same visitor again: not counted
    await request(app).post(`/api/properties/${p.body.data.id}/view`).set("User-Agent", "Googlebot/2.1"); // bot: not counted
    await request(app).get(`/api/properties/${p.body.data.id}`).set("User-Agent", "Mozilla/5.0"); // reading doesn't count
    await request(app).post("/api/inquiries").send({ propertyId: p.body.data.id, name: "Mona", phone: "01012345678" });
    await new Promise((res) => setTimeout(res, 200)); // view counter is fire-and-forget
    const d = await agent.get("/api/admin/analytics/dashboard");
    expect(d.status).toBe(200);
    expect(d.body.data.kpis.views.value).toBe(1);
    expect(d.body.data.kpis.inquiries.value).toBe(1);
    expect(d.body.data.kpis.conversionRate.value).toBe(100);
    expect(d.body.data.series.views).toHaveLength(30);
  });

  it("exports Excel and CSV; rejects bad ranges", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    const x = await agent.post("/api/admin/reports/generate").send({ report: "overview", format: "xlsx" }).buffer(true);
    expect(x.headers["content-type"]).toMatch(/spreadsheetml/);
    expect(x.body.subarray(0, 2).toString()).toBe("PK"); // xlsx is a zip
    const c = await agent.post("/api/admin/reports/generate").send({ report: "team", format: "csv" });
    expect(c.text.startsWith("\uFEFFName,Role")).toBe(true);
    expect((await agent.post("/api/admin/reports/generate").send({ report: "team", format: "csv", from: "2026-09-30", to: "2026-09-01" })).status).toBe(400);
  });

  it("moderators cannot see analytics", async () => {
    const { agent } = await loginAs("MODERATOR");
    expect((await agent.get("/api/admin/analytics/dashboard")).status).toBe(403);
  });
});

describe("notifications", () => {
  it("an inquiry queues a staff email and a customer SMS; disabled channels are logged as SKIPPED", async () => {
    await ensureDefaultTemplates();
    await request(app).post("/api/inquiries").send({ name: "Omar", phone: "01112345678", locale: "ar" });
    await new Promise((res) => setTimeout(res, 200));
    const jobs = await prisma.job.findMany({ orderBy: { createdAt: "asc" } });
    expect(jobs.map((j) => j.type).sort()).toEqual(["send_email", "send_sms"]);
    await deliverEmail(jobs.find((j) => j.type === "send_email")!.payload as never);
    const log = await prisma.notificationLog.findFirstOrThrow();
    expect(log.status).toBe("SKIPPED");
  });

  it("secrets are never returned by the config endpoint", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    const save = await agent.post("/api/admin/email-config").send({ enabled: false, provider: "log", fromEmail: "no-reply@b.com", fromName: "B", staffRecipients: ["ops@b.com"] });
    expect(save.status).toBe(200);
    expect(JSON.stringify(save.body)).not.toMatch(/Sealed/);
    const { agent: content } = await loginAs("CONTENT_ADMIN");
    expect((await content.get("/api/admin/email-config")).status).toBe(403);
  });
});
