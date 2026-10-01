import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { authEvents, httpRequests, leadsCreated, registry } from "../src/metrics/registry";
import "../src/metrics/collectors";
import { app, resetDb } from "./setup";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("metrics", () => {
  it("labels requests by route pattern, including errors raised inside routers", async () => {
    const before = httpRequests.get({ method: "GET", route: "/api/properties/:id", status: "404" });
    await request(app).get("/api/properties/does-not-exist").expect(404);
    await request(app).get("/api/properties/another-id").expect(404);
    expect(httpRequests.get({ method: "GET", route: "/api/properties/:id", status: "404" })).toBe(before + 2);
    const unmatched = httpRequests.get({ method: "GET", route: "unmatched", status: "404" });
    await request(app).get("/wp-login.php").expect(404);
    expect(httpRequests.get({ method: "GET", route: "unmatched", status: "404" })).toBe(unmatched + 1);
  });

  it("counts failed sign-ins and new leads", async () => {
    const failed = authEvents.get({ event: "login_failed" });
    await request(app).post("/api/admin/auth/login").send({ email: "nobody@test.local", password: "wrong-password-123" }).expect(401);
    expect(authEvents.get({ event: "login_failed" })).toBe(failed + 1);
    const leads = leadsCreated.get({ kind: "submission" });
    await request(app).post("/api/submissions").send({ ownerName: "Ali", phone: "01012345678" }).expect(201);
    expect(leadsCreated.get({ kind: "submission" })).toBe(leads + 1);
  });

  it("exposes business gauges read from the database", async () => {
    await prisma.inquiry.create({ data: { name: "A", phone: "01012345678" } });
    const out = await registry.render();
    expect(out).toMatch(/brookrege_db_up 1/);
    expect(out).toMatch(/brookrege_leads_open\{kind="inquiry"\} \d+/);
    expect(out).toMatch(/brookrege_jobs\{status="QUEUED"\} \d+/);
    expect(out).not.toMatch(/01012345678/); // never personal data in metrics
  });
});
